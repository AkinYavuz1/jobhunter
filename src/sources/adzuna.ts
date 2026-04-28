import { env } from '../env.js';
import type { RawJob } from '../types.js';
import { normaliseEmploymentType, normaliseSalary, canonicalUrl } from '../normalise.js';

const BASE = 'https://api.adzuna.com/v1/api/jobs/gb/search';

export async function searchAdzuna(term: string): Promise<RawJob[]> {
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID,
    app_key: env.ADZUNA_APP_KEY,
    results_per_page: '50',
    what: term,
    where: 'United Kingdom',
    distance: '0',
    'full_time': '1',
    'permanent': '1',
    sort_by: 'date',
    max_days_old: '7',
  });

  const jobs: RawJob[] = [];
  let page = 1;

  while (page <= 3) {
    const url = `${BASE}/${page}?${params}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json() as AdzunaResponse;
    if (!data.results?.length) break;

    for (const r of data.results) {
      // Skip non-remote (Adzuna doesn't have a strict remote filter at query level)
      const descLower = (r.description ?? '').toLowerCase();
      const titleLower = r.title.toLowerCase();
      if (!descLower.includes('remote') && !titleLower.includes('remote')) continue;

      const { min: salaryMin, max: salaryMax, period: salaryPeriod } = normaliseSalary(
        r.salary_min ?? null,
        r.salary_max ?? null,
        'annual'
      );

      const employmentType = normaliseEmploymentType(r.contract_type ?? '', r.description ?? '');

      jobs.push({
        id: `adzuna:${r.id}`,
        source: 'adzuna',
        title: r.title,
        company: r.company?.display_name ?? null,
        location: r.location?.display_name ?? null,
        salaryMin,
        salaryMax,
        salaryCurrency: 'GBP',
        salaryPeriod,
        employmentType,
        description: r.description ?? null,
        descriptionFull: false,
        url: r.redirect_url,
        urlCanonical: canonicalUrl(r.redirect_url),
        postedAt: r.created ? new Date(r.created) : null,
        raw: r,
      });
    }

    if (data.results.length < 50) break;
    page++;
  }

  return jobs;
}

interface AdzunaResponse {
  results: AdzunaJob[];
}

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  contract_type?: string;
  salary_min?: number;
  salary_max?: number;
  company?: { display_name: string };
  location?: { display_name: string };
}
