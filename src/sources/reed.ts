import { env } from '../env.js';
import type { RawJob } from '../types.js';
import { normaliseEmploymentType, normaliseSalary, canonicalUrl } from '../normalise.js';

const BASE = 'https://www.reed.co.uk/api/1.0/search';

export async function searchReed(term: string): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let skip = 0;

  while (skip < 150) {
    const params = new URLSearchParams({
      keywords: term,
      locationName: 'United Kingdom',
      distanceFromLocation: '0',
      fullTime: 'true',
      permanent: 'true',
      resultsToSkip: String(skip),
      resultsToTake: '100',
    });

    const res = await fetch(`${BASE}?${params}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.REED_API_KEY}:`).toString('base64')}`,
      },
    });

    if (!res.ok) break;
    const data = await res.json() as ReedResponse;
    if (!data.results?.length) break;

    for (const r of data.results) {
      const descLower = (r.jobDescription ?? '').toLowerCase();
      const titleLower = r.jobTitle.toLowerCase();
      if (!descLower.includes('remote') && !titleLower.includes('remote')) continue;

      const { min: salaryMin, max: salaryMax } = normaliseSalary(
        r.minimumSalary ?? null,
        r.maximumSalary ?? null,
        'annual'
      );

      const employmentType = normaliseEmploymentType('permanent', r.jobDescription ?? '');

      jobs.push({
        id: `reed:${r.jobId}`,
        source: 'reed',
        title: r.jobTitle,
        company: r.employerName ?? null,
        location: r.locationName ?? null,
        salaryMin,
        salaryMax,
        salaryCurrency: 'GBP',
        salaryPeriod: 'annual',
        employmentType,
        description: r.jobDescription ?? null,
        descriptionFull: false,
        url: `https://www.reed.co.uk/jobs/${r.jobId}`,
        urlCanonical: canonicalUrl(`https://www.reed.co.uk/jobs/${r.jobId}`),
        postedAt: r.date ? new Date(r.date) : null,
        raw: r,
      });
    }

    if (data.results.length < 100) break;
    skip += 100;
  }

  return jobs;
}

interface ReedResponse {
  results: ReedJob[];
}

interface ReedJob {
  jobId: number;
  jobTitle: string;
  employerName?: string;
  locationName?: string;
  minimumSalary?: number;
  maximumSalary?: number;
  jobDescription?: string;
  date?: string;
}
