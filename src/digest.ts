import { env } from './env.js';
import type { ScoredJob } from './types.js';

export async function sendDigest(jobs: ScoredJob[], runId: string): Promise<void> {
  if (!jobs.length) return;

  const rows = jobs.map(buildJobRow);
  const html = buildHtml(rows, runId, jobs.length);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [env.DIGEST_EMAIL],
      subject: `💼 ${jobs.length} new remote job${jobs.length > 1 ? 's' : ''} — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Digest email failed: ${res.status} ${body}`);
  }
}

function buildJobRow(job: ScoredJob): string {
  const salaryStr = job.salaryMin && job.salaryMax
    ? `£${Math.round(job.salaryMin / 1000)}k – £${Math.round(job.salaryMax / 1000)}k`
    : job.salaryMax ? `Up to £${Math.round(job.salaryMax / 1000)}k`
    : job.salaryMin ? `£${Math.round(job.salaryMin / 1000)}k+` : 'Salary TBC';

  return `
    <div style="border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:16px;font-family:Calibri,sans-serif">
      <div style="font-size:15px;font-weight:bold;margin-bottom:4px">
        <a href="${job.url}" style="color:#1B4332;text-decoration:none">${job.title}</a>
      </div>
      <div style="color:#555;font-size:13px;margin-bottom:8px">
        ${job.company ?? 'Company TBC'} · <strong style="color:#1B4332">${salaryStr}</strong> · ${job.location ?? 'Remote UK'} · ${job.source}
      </div>
      <a href="${job.url}" style="display:inline-block;background:#1B4332;color:white;padding:6px 16px;border-radius:5px;text-decoration:none;font-size:13px;font-weight:600">Apply Now →</a>
    </div>`;
}

function buildHtml(rows: string[], runId: string, total: number): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="font-family:Calibri,sans-serif;max-width:650px;margin:0 auto;padding:20px">
  <h1 style="color:#1B4332;border-bottom:2px solid #1B4332;padding-bottom:8px;margin-bottom:4px">
    💼 ${total} new remote job${total > 1 ? 's' : ''} found
  </h1>
  <p style="color:#666;font-size:13px;margin-bottom:20px">
    Run ID: ${runId} · Open <strong>pnpm serve</strong> in the jobhunter directory to generate tailored CVs on demand.
  </p>
  ${rows.join('\n')}
  <p style="color:#aaa;font-size:11px;margin-top:24px">Jobs auto-expire after 30 days unless marked applied.</p>
</body></html>`;
}
