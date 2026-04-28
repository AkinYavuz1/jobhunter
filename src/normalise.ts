import type { EmploymentType } from './types.js';

const CONTRACT_KEYWORDS = ['contract', 'fixed-term', 'fixed term', 'interim', 'day rate', 'outside ir35', 'inside ir35', 'freelance'];
const PERMANENT_KEYWORDS = ['permanent', 'perm', 'full-time', 'fulltime'];

export function normaliseEmploymentType(apiField: string, description: string): EmploymentType {
  const combined = `${apiField} ${description}`.toLowerCase();
  if (CONTRACT_KEYWORDS.some((kw) => combined.includes(kw))) return 'contract';
  if (PERMANENT_KEYWORDS.some((kw) => combined.includes(kw))) return 'permanent';
  return 'unknown';
}

const WORKING_DAYS_PER_YEAR = 230;
const HOURS_PER_YEAR = 1840;

export function normaliseSalary(
  rawMin: number | null,
  rawMax: number | null,
  period: 'annual' | 'day' | 'hour'
): { min: number | null; max: number | null; period: string } {
  if (rawMin === null && rawMax === null) return { min: null, max: null, period: 'annual' };
  const mult = period === 'day' ? WORKING_DAYS_PER_YEAR : period === 'hour' ? HOURS_PER_YEAR : 1;
  return {
    min: rawMin !== null ? Math.round(rawMin * mult) : null,
    max: rawMax !== null ? Math.round(rawMax * mult) : null,
    period: 'annual',
  };
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'src', 'from'].forEach((p) => u.searchParams.delete(p));
    return u.origin + u.pathname + (u.search ? u.search : '');
  } catch {
    return url.toLowerCase().trim();
  }
}

export function passesHardFilters(
  employmentType: EmploymentType,
  salaryMin: number | null,
  salaryMax: number | null,
  minSalary: number
): boolean {
  if (employmentType === 'contract') return false;
  // Drop unknown employment type (safer to miss than waste Gemini quota)
  if (employmentType === 'unknown') return false;
  // Drop if no salary info
  if (salaryMin === null && salaryMax === null) return false;
  // Use max if available, otherwise min — passes if either end ≥ threshold
  const salaryCheck = salaryMax ?? salaryMin!;
  return salaryCheck >= minSalary;
}
