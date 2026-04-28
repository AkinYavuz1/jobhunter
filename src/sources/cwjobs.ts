import { chromium } from 'playwright';
import type { RawJob } from '../types.js';
import { normaliseEmploymentType, normaliseSalary, canonicalUrl } from '../normalise.js';

export async function searchCWJobs(term: string): Promise<RawJob[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const jobs: RawJob[] = [];

  try {
    for (let page = 1; page <= 3; page++) {
      const encodedTerm = encodeURIComponent(term);
      const url = `https://www.cwjobs.co.uk/jobs/${encodedTerm.replace(/%20/g, '-')}/in-united-kingdom?radius=0&postedWithin=7&contractType=permanent&remote=true&page=${page}`;

      const p = await context.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(2000);

      const extracted = await p.evaluate(() => {
        const cards = document.querySelectorAll('[data-at="job-item"], article.job-item, [class*="jobcard"]');
        return Array.from(cards).map((card) => ({
          title: card.querySelector('[data-at="job-item-title"], .job-title, h2')?.textContent?.trim() ?? '',
          company: card.querySelector('[data-at="job-item-company"], .company-name')?.textContent?.trim() ?? '',
          location: card.querySelector('[data-at="job-item-location"], .job-location')?.textContent?.trim() ?? '',
          salary: card.querySelector('[data-at="job-item-salary"], .salary')?.textContent?.trim() ?? '',
          url: (card.querySelector('a[href*="/job/"]') as HTMLAnchorElement)?.href ?? '',
          snippet: card.querySelector('.job-description, [data-at="job-item-description"]')?.textContent?.trim() ?? '',
        }));
      });

      await p.close();
      if (!extracted.length) break;

      for (const r of extracted) {
        if (!r.url || !r.title) continue;
        const descLower = (r.snippet + ' ' + r.title).toLowerCase();
        if (!descLower.includes('remote')) continue;

        const { min: salaryMin, max: salaryMax } = parseSalaryText(r.salary);

        jobs.push({
          id: `cwjobs:${idFromUrl(r.url)}`,
          source: 'cwjobs',
          title: r.title,
          company: r.company || null,
          location: r.location || null,
          salaryMin,
          salaryMax,
          salaryCurrency: 'GBP',
          salaryPeriod: 'annual',
          employmentType: normaliseEmploymentType('permanent', r.snippet),
          description: r.snippet || null,
          descriptionFull: false,
          url: r.url,
          urlCanonical: canonicalUrl(r.url),
          postedAt: null,
          raw: r,
        });
      }
    }
  } finally {
    await browser.close();
  }

  return jobs;
}

function parseSalaryText(text: string): { min: number | null; max: number | null } {
  const cleaned = text.replace(/,/g, '').replace(/£/g, '');
  const matches = cleaned.match(/(\d+(?:\.\d+)?)[kK]?\s*[-–]\s*(\d+(?:\.\d+)?)[kK]?/);
  if (!matches) {
    const single = cleaned.match(/(\d+(?:\.\d+)?)[kK]?/);
    if (!single) return { min: null, max: null };
    const v = parseFloat(single[1]) * (single[0].toLowerCase().includes('k') ? 1000 : 1);
    return { min: v, max: v };
  }
  const factor = matches[0].toLowerCase().includes('k') ? 1000 : 1;
  return {
    min: Math.round(parseFloat(matches[1]) * factor),
    max: Math.round(parseFloat(matches[2]) * factor),
  };
}

function idFromUrl(url: string): string {
  const match = url.match(/\/job\/(\d+)/);
  return match ? match[1] : Buffer.from(url).toString('base64').slice(0, 16);
}
