import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import type { RawJob, ScoredJob, GeneratedDocs } from './types.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const db = supabase.schema('jobhuntremote');

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function getJob(id: string): Promise<RawJob | null> {
  const { data } = await db.from('jobs').select('*').eq('id', id).maybeSingle();
  return data ? dbRowToJob(data) : null;
}

export async function saveJob(job: ScoredJob): Promise<void> {
  await db.from('jobs').upsert({
    id: job.id,
    source: job.source,
    title: job.title,
    company: job.company,
    location: job.location,
    salary_min: job.salaryMin,
    salary_max: job.salaryMax,
    salary_currency: job.salaryCurrency,
    salary_period: job.salaryPeriod,
    employment_type: job.employmentType,
    description: job.description,
    description_full: job.descriptionFull,
    url: job.url,
    url_canonical: job.urlCanonical,
    posted_at: job.postedAt?.toISOString() ?? null,
    obtainability: job.obtainability,
    obtainability_reason: job.obtainabilityReason,
    raw: job.raw,
  });
}

export async function hasBeenNotified(id: string): Promise<boolean> {
  const { data } = await db.from('notified').select('id').eq('id', id).maybeSingle();
  return data !== null;
}

export async function markNotified(id: string): Promise<void> {
  await db.from('notified').insert({ id });
}

export async function markApplied(id: string): Promise<void> {
  await db.from('jobs').update({ applied: true, applied_at: new Date().toISOString() }).eq('id', id);
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function saveDocument(jobId: string, docs: GeneratedDocs): Promise<void> {
  await db.from('documents').upsert({
    id: jobId,
    cover_letter: docs.coverLetter,
    cv_tailored: docs.cvTailored,
    folder_path: docs.folderPath,
    page_count: docs.pageCount,
  });
}

// ── Storage (files) ───────────────────────────────────────────────────────────

const BUCKET = 'jobhuntremote';

export async function uploadFile(path: string, content: Buffer | string, contentType: string): Promise<void> {
  const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
}

export async function getSignedUrl(path: string, expiresInSeconds = 604800): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`Signed URL failed for ${path}: ${error?.message}`);
  return data.signedUrl;
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const { data: files } = await supabase.storage.from(BUCKET).list(folderPath);
  if (!files?.length) return;
  const paths = files.map((f) => `${folderPath}/${f.name}`);
  await supabase.storage.from(BUCKET).remove(paths);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export async function getExpiredJobIds(olderThanDays: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('jobs')
    .select('id')
    .eq('applied', false)
    .lt('scraped_at', cutoff);
  return (data ?? []).map((r: { id: string }) => r.id);
}

export async function deleteJob(id: string): Promise<void> {
  await db.from('jobs').delete().eq('id', id);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dbRowToJob(row: Record<string, unknown>): RawJob {
  return {
    id: row.id as string,
    source: row.source as RawJob['source'],
    title: row.title as string,
    company: row.company as string | null,
    location: row.location as string | null,
    salaryMin: row.salary_min as number | null,
    salaryMax: row.salary_max as number | null,
    salaryCurrency: (row.salary_currency as string) ?? 'GBP',
    salaryPeriod: (row.salary_period as string) ?? 'annual',
    employmentType: (row.employment_type as RawJob['employmentType']) ?? 'unknown',
    description: row.description as string | null,
    descriptionFull: (row.description_full as boolean) ?? false,
    url: row.url as string,
    urlCanonical: row.url_canonical as string,
    postedAt: row.posted_at ? new Date(row.posted_at as string) : null,
    raw: row.raw,
  };
}
