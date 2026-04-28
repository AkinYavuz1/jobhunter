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
import { generateForJob, mergeIntoScoredJob } from './generator.js';
import { renderCV } from './renderer.js';
import { saveJob, saveDocument, hasBeenNotified, markNotified, uploadFile, getJob } from './storage.js';
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

  // 6. Process each new job
  const processedJobs: Array<ScoredJob & { folderPath: string; coverLetter: string; pageCount: number }> = [];

  for (const job of toProcess) {
    try {
      // 6a. Fetch full description if needed
      if (needsFullDescription(job.description)) {
        const fullDesc = await fetchFullDescription(job.url, job.description);
        if (fullDesc) {
          job.description = fullDesc;
          job.descriptionFull = true;
        }
      }

      // 6b. Save raw job to DB first — decoupled from Gemini so jobs persist even if generation fails
      await saveJob({ ...job, obtainability: 0, obtainabilityReason: '' });

      // 6c. Gemini: CV tailoring + cover letter + obtainability
      const output = await generateForJob(job, cvBaseYaml, globalConfig);
      const scoredJob = mergeIntoScoredJob(job, output);

      // Update with obtainability score
      await saveJob(scoredJob);

      // 6e. Render DOCX + PDF — merge top-level keyProjects into cv before passing to renderer
      const cvForRender = { ...output.cv, keyProjects: output.keyProjects ?? [] };
      const { docxBuffer, pdfBuffer, pageCount } = await renderCV(cvForRender, 'Akin Yavuz');
      logger.info('CV rendered', { id: job.id, pages: pageCount });

      // 6f. Upload to Storage
      const folderPath = `jobs/${job.id}/`;
      await uploadFile(`${folderPath}akinyavuz_cv.docx`, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (pdfBuffer) {
        await uploadFile(`${folderPath}akinyavuz_cv.pdf`, pdfBuffer, 'application/pdf');
      }
      await uploadFile(`${folderPath}akinyavuz_cover_letter.txt`, output.coverLetter, 'text/plain');

      // 6g. Save document record
      await saveDocument(job.id, {
        coverLetter: output.coverLetter,
        cvTailored: output.cv,
        folderPath,
        pageCount,
      });

      // 6h. Mark notified
      await markNotified(job.id);

      processedJobs.push({ ...scoredJob, folderPath, coverLetter: output.coverLetter, pageCount });
      logger.info('Job processed', { id: job.id, title: job.title, obtainability: output.obtainability });
    } catch (err) {
      const msg = `Failed to process job ${job.id} (${job.title}): ${(err as Error).message}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  // 7. Batched ntfy summary
  if (processedJobs.length > 0) {
    try {
      await sendBatchSummary(processedJobs, processedJobs.length);
      logger.info('ntfy summary sent', { count: processedJobs.length });
    } catch (err) {
      const msg = `ntfy failed: ${(err as Error).message}`;
      logger.warn(msg);
      errors.push(msg);
    }
  }

  // 8. Digest email
  if (processedJobs.length > 0) {
    try {
      await sendDigest(processedJobs, runId);
      logger.info('Digest sent', { count: processedJobs.length, to: process.env.DIGEST_EMAIL });
    } catch (err) {
      const msg = `Digest failed: ${(err as Error).message}`;
      logger.warn(msg);
      errors.push(msg);
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
    jobsNew: toProcess.length,
    docsGenerated: processedJobs.length,
    notificationsSent: processedJobs.length > 0 ? 1 : 0,
    errors,
  };

  logger.info('Run finished', { summary });
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: err.message, stack: err.stack }));
  process.exit(1);
});
