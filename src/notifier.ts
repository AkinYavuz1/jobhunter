import { env } from './env.js';
import type { ScoredJob } from './types.js';

export async function sendBatchSummary(jobs: ScoredJob[], totalNew: number): Promise<void> {
  if (totalNew === 0) return;

  const top3 = [...jobs].sort((a, b) => b.obtainability - a.obtainability).slice(0, 3);
  const lines = top3.map(
    (j) => `${j.title} @ ${j.company ?? 'Unknown'} · ${formatSalary(j.salaryMin, j.salaryMax)} · ${j.obtainability}/100`
  );

  const body = [
    `${totalNew} new remote job${totalNew > 1 ? 's' : ''} found. See digest email for CVs and cover letters.`,
    '',
    ...lines,
  ].join('\n');

  const response = await fetch(`https://ntfy.sh/${env.NTFY_JOB_TOPIC}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: env.NTFY_JOB_TOPIC,
      title: `💼 ${totalNew} new remote job${totalNew > 1 ? 's' : ''} (top: ${top3[0]?.obtainability ?? 0}/100)`,
      message: body,
      priority: 'default',
      tags: ['briefcase'],
    }),
  });

  if (!response.ok) {
    throw new Error(`ntfy push failed: ${response.status} ${response.statusText}`);
  }
}

function formatSalary(min: number | null, max: number | null): string {
  if (!min && !max) return 'salary TBC';
  if (min && max) return `£${Math.round(min / 1000)}k–£${Math.round(max / 1000)}k`;
  if (max) return `up to £${Math.round(max / 1000)}k`;
  return `£${Math.round(min! / 1000)}k+`;
}
