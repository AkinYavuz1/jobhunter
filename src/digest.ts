import { env } from './env.js';
import type { ScoredJob } from './types.js';
import { getSignedUrl } from './storage.js';

interface JobWithDocs extends ScoredJob {
  folderPath: string;
  coverLetter: string;
  pageCount: number;
}

export async function sendDigest(jobs: JobWithDocs[], runId: string): Promise<void> {
  if (!jobs.length) return;

  const sorted = [...jobs].sort((a, b) => b.obtainability - a.obtainability);
  const rows = await Promise.all(sorted.map(buildJobRow));
  const html = buildHtml(rows, runId, sorted.length);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
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

async function buildJobRow(job: JobWithDocs): Promise<string> {
  const badge = job.obtainability >= 75 ? '🟢' : job.obtainability >= 50 ? '🟡' : '⚪';
  const salaryStr = job.salaryMin && job.salaryMax
    ? `£${job.salaryMin.toLocaleString('en-GB')} – £${job.salaryMax.toLocaleString('en-GB')}`
    : 'Salary not specified';

  let downloadLinks = '';
  try {
    const [docxUrl, pdfUrl, txtUrl] = await Promise.all([
      getSignedUrl(`${job.folderPath}akinyavuz_cv.docx`),
      getSignedUrl(`${job.folderPath}akinyavuz_cv.pdf`),
      getSignedUrl(`${job.folderPath}akinyavuz_cover_letter.txt`),
    ]);
    downloadLinks = `
      <a href="${docxUrl}" style="margin-right:12px">📄 CV (.docx)</a>
      <a href="${pdfUrl}" style="margin-right:12px">📋 CV (.pdf)</a>
      <a href="${txtUrl}">✉️ Cover letter</a>
    `;
  } catch {
    downloadLinks = '<em>Documents generating — check next digest</em>';
  }

  return `
    <div style="border:1px solid #ddd;border-radius:8px;padding:20px;margin-bottom:24px;font-family:Calibri,sans-serif">
      <div style="margin-bottom:8px">
        <span style="font-size:18px;font-weight:bold">${badge} ${job.obtainability}/100 — ${job.title}</span>
      </div>
      <div style="color:#555;margin-bottom:4px">${job.company ?? 'Company not listed'} · ${salaryStr} · ${job.location ?? 'Remote UK'}</div>
      <div style="color:#777;font-size:13px;margin-bottom:12px">Source: ${job.source} · Posted: ${job.postedAt ? job.postedAt.toLocaleDateString('en-GB') : 'recently'}</div>
      <div style="background:#f9f9f9;border-left:3px solid #1B4332;padding:10px 14px;margin-bottom:12px;font-style:italic;color:#444">${job.obtainabilityReason}</div>
      <div style="background:#f0f7f4;padding:12px 14px;margin-bottom:14px;border-radius:4px"><strong>Cover letter:</strong><br/><br/>${job.coverLetter}</div>
      <div style="margin-bottom:12px">${downloadLinks}</div>
      <a href="${job.url}" style="display:inline-block;background:#1B4332;color:white;padding:8px 18px;border-radius:4px;text-decoration:none;font-weight:bold;margin-right:10px">Apply Now</a>
    </div>
  `;
}

function buildHtml(rows: string[], runId: string, total: number): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body style="font-family:Calibri,sans-serif;max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:#1B4332;border-bottom:2px solid #1B4332;padding-bottom:8px">
        💼 ${total} new remote job${total > 1 ? 's' : ''} — sorted by obtainability
      </h1>
      <p style="color:#666;font-size:13px">Run: ${runId} · CVs and cover letters tailored for each role · Download links expire in 7 days</p>
      ${rows.join('\n')}
      <p style="color:#aaa;font-size:11px;margin-top:30px">Powered by jobhunter — jobs auto-expire after 30 days unless marked applied</p>
    </body>
    </html>
  `;
}
