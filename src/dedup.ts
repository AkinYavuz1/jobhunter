import type { RawJob, JobSource } from './types.js';

const SOURCE_PRIORITY: Record<JobSource, number> = {
  totaljobs: 1,
  cwjobs: 2,
  reed: 3,
  adzuna: 4,
  indeed: 5,
};

export function deduplicate(jobs: RawJob[]): RawJob[] {
  // Pass 1: exact canonical URL
  const byUrl = new Map<string, RawJob>();
  for (const job of jobs) {
    const existing = byUrl.get(job.urlCanonical);
    if (!existing || SOURCE_PRIORITY[job.source] < SOURCE_PRIORITY[existing.source]) {
      byUrl.set(job.urlCanonical, job);
    }
  }

  // Pass 2: fuzzy (title + company) among survivors
  const uniqueJobs = Array.from(byUrl.values());
  const byFuzzy = new Map<string, RawJob>();
  for (const job of uniqueJobs) {
    const key = fuzzyKey(job.title, job.company);
    const existing = byFuzzy.get(key);
    if (!existing || SOURCE_PRIORITY[job.source] < SOURCE_PRIORITY[existing.source]) {
      byFuzzy.set(key, job);
    }
  }

  return Array.from(byFuzzy.values());
}

function fuzzyKey(title: string, company: string | null): string {
  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const normCompany = (company ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  return `${normTitle}__${normCompany}`;
}
