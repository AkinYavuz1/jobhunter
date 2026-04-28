import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import type { RawJob, ScoredJob, RunSummary } from './types.js';
import { searchAdzuna } from './sources/adzuna.js';
import { searchReed } from './sources/reed.js';
// TotalJobs + CWJobs block headless Chromium even on residential IP (Stepstone CDN bot detection)
// Adzuna aggregates their listings anyway so coverage is maintained
import { deduplicate } from './dedup.js';
import { passesHardFilters } from './normalise.js';
import { fetchFullDescription, needsFullDescription } from './fetch-detail.js';
import { saveJob, hasBeenNotified, markNotified } from './storage.js';
import { sendBatchSummary } from './notifier.js';
import { sendDigest } from './digest.js';
import { runCleanup } from './cleanup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

const DRY_RUN = process.argv.includes('--dry-run');
const runId = new Date().toISOString();
const startedAt = runId;

const logger = {
  info: (msg: string, meta?: object) => console.log(JSON.stringify({ level: 'info', msg, timestamp: new Date().toISOString(), ...meta })),
  warn: (msg: string, meta?: object) => console.warn(JSON.stringify({ level: 'warn', msg, timestamp: new Date().toISOString(), ...meta })),
  error: (msg: string, meta?: object) => console.error(JSON.stringify({ level: 'error', msg, timestamp: new Date().toISOString(), ...meta })),
};

async function main() {
  logger.info('Run started', { runId, dryRun: DRY_RUN });
  const errors: string[] = [];

  // 1. Load config
  const globalConfig = yaml.load(readFileSync(join(CONFIG_DIR, 'global.yaml'), 'utf-8')) as Record<string, unknown>;
  const cvBaseYaml = readFileSync(join(CONFIG_DIR, 'cv-base.yaml'), 'utf-8');
  const searchTerms = (globalConfig.search as Record<string, unknown>).terms as string[];
  const minSalary = (globalConfig.filters as Record<string, unknown>).salary_min as number;
  const retentionDays = (globalConfig.retention as Record<string, unknown>).days as number;

  // 2. Collect from all sources in parallel (per search term)
  logger.info('Collecting jobs from all sources', { terms: searchTerms.length });
  const allJobs: RawJob[] = [];

  // Read CCR-staged Indeed jobs first
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const { env } = await import('./env.js');
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const { data: indeedRows } = await supabase
      .from('jh_jobs')
      .select('*')
      .eq('source', 'indeed');
    if (indeedRows?.length) {
      logger.info('CCR Indeed jobs staged', { count: indeedRows.length });
    }
  } catch (err) {
    logger.warn('Could not read CCR Indeed jobs', { error: (err as Error).message });
  }

  // Collect from APIs + scrapers per search term
  for (const term of searchTerms) {
    const results = await Promise.allSettled([
      searchAdzuna(term),
      searchReed(term),
    ]);

    for (const [i, result] of results.entries()) {
      const sourceName = ['adzuna', 'reed'][i];
      if (result.status === 'fulfilled') {
        allJobs.push(...result.value);
        logger.info('Source collected', { source: sourceName, term, count: result.value.length });
      } else {
        const msg = `${sourceName} failed for "${term}": ${result.reason?.message}`;
        logger.warn(msg);
        errors.push(msg);
      }
    }
  }

  logger.info('Collection complete', { total: allJobs.length });

  // 3. Deduplicate
  const deduped = deduplicate(allJobs);
  logger.info('After dedup', { count: deduped.length });

  // 4. Apply hard filters
  const filtered = deduped.filter((j) => passesHardFilters(j.employmentType, j.salaryMin, j.salaryMax, minSalary));
  logger.info('After hard filters', { count: filtered.length, dropped: deduped.length - filtered.length });

  // 5. Filter already-notified
  const toProcess: RawJob[] = [];
  for (const job of filtered) {
    const notified = await hasBeenNotified(job.id);
    if (!notified) toProcess.push(job);
  }
  logger.info('New jobs to process', { count: toProcess.length });

  if (DRY_RUN) {
    logger.info('Dry run — stopping before generation', {
      collected: allJobs.length,
      afterFilter: filtered.length,
      new: toProcess.length,
    });
    process.exit(0);
  }

  // 6. Save new jobs to DB and mark notified (no CV generation — done on demand via pnpm serve)
  let savedCount = 0;
  for (const job of toProcess) {
    try {
      if (needsFullDescription(job.description)) {
        const fullDesc = await fetchFullDescription(job.url, job.description);
        if (fullDesc) { job.description = fullDesc; job.descriptionFull = true; }
      }
      await saveJob({ ...job, obtainability: 0, obtainabilityReason: '' });
      await markNotified(job.id);
      savedCount++;
      logger.info('Job saved', { id: job.id, title: job.title });
    } catch (err) {
      const msg = `Failed to save job ${job.id} (${job.title}): ${(err as Error).message}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  // 7. ntfy summary
  if (savedCount > 0) {
    try {
      await sendBatchSummary(toProcess as ScoredJob[], savedCount);
      logger.info('ntfy summary sent', { count: savedCount });
    } catch (err) {
      errors.push(`ntfy failed: ${(err as Error).message}`);
    }
  }

  // 8. Digest email
  if (savedCount > 0) {
    try {
      await sendDigest(toProcess as ScoredJob[], runId);
      logger.info('Digest sent', { count: savedCount });
    } catch (err) {
      errors.push(`Digest failed: ${(err as Error).message}`);
    }
  } else {
    logger.info('No new jobs — digest skipped');
  }

  // 9. Cleanup
  try {
    const deleted = await runCleanup(retentionDays, errors);
    if (deleted > 0) logger.info('Cleanup complete', { deleted });
  } catch (err) {
    errors.push(`Cleanup error: ${(err as Error).message}`);
  }

  // 10. Summary
  const summary: RunSummary = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    jobsCollected: allJobs.length,
    jobsAfterFilter: filtered.length,
    jobsNew: savedCount,
    docsGenerated: 0,
    notificationsSent: savedCount > 0 ? 1 : 0,
    errors,
  };

  logger.info('Run finished', { summary });
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: err.message, stack: err.stack }));
  process.exit(1);
});
