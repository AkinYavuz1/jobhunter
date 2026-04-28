/**
 * Generates dashboard.html — open in any browser to browse found jobs.
 * Run: pnpm dashboard
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: jobs, error } = await supabase
  .from('jh_jobs')
  .select(`*, jh_documents(cover_letter, folder_path, page_count, generated_at)`)
  .order('obtainability', { ascending: false, nullsFirst: false });

if (error) {
  console.error('Failed to fetch jobs:', error.message);
  process.exit(1);
}

if (!jobs?.length) {
  console.log('No jobs in database yet. Run `pnpm hunt` first.');
  process.exit(0);
}

// Generate signed URLs for documents
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function getSignedUrls(folderPath: string): Promise<{ docx: string; pdf: string; txt: string } | null> {
  if (!folderPath) return null;
  try {
    const paths = [
      `${folderPath}akinyavuz_cv.docx`,
      `${folderPath}akinyavuz_cv.pdf`,
      `${folderPath}akinyavuz_cover_letter.txt`,
    ];
    const results = await Promise.all(
      paths.map((p) =>
        supabase.storage.from('jobhuntremote').createSignedUrl(p, 604800)
      )
    );
    if (results.some((r) => r.error)) return null;
    return { docx: results[0].data!.signedUrl, pdf: results[1].data!.signedUrl, txt: results[2].data!.signedUrl };
  } catch {
    return null;
  }
}

console.log(`Building dashboard for ${jobs.length} jobs...`);

const jobRows: string[] = [];

for (const job of jobs) {
  const doc = (job.jh_documents as Record<string, unknown> | null) ?? null;
  const urls = doc?.folder_path ? await getSignedUrls(doc.folder_path as string) : null;

  const salaryStr = job.salary_min && job.salary_max
    ? `£${(job.salary_min / 1000).toFixed(0)}k – £${(job.salary_max / 1000).toFixed(0)}k`
    : job.salary_max
    ? `Up to £${(job.salary_max / 1000).toFixed(0)}k`
    : job.salary_min
    ? `£${(job.salary_min / 1000).toFixed(0)}k+`
    : 'Salary TBC';

  const obtainBadge = job.obtainability >= 75
    ? `<span class="badge green">${job.obtainability}/100</span>`
    : job.obtainability >= 50
    ? `<span class="badge amber">${job.obtainability}/100</span>`
    : (job.obtainability && job.obtainability > 0)
    ? `<span class="badge grey">${job.obtainability}/100</span>`
    : `<span class="badge grey">Unscored</span>`;

  const docsHtml = urls
    ? `<div class="doc-links">
        <a href="${urls.docx}" target="_blank" class="btn-doc">📄 CV (.docx)</a>
        <a href="${urls.pdf}" target="_blank" class="btn-doc">📋 CV (.pdf)</a>
        <a href="${urls.txt}" target="_blank" class="btn-doc">✉️ Cover letter</a>
      </div>`
    : `<div class="no-docs">Documents not yet generated</div>`;

  const coverHtml = doc?.cover_letter
    ? `<div class="cover-letter"><strong>Cover letter:</strong><br/><br/>${doc.cover_letter as string}</div>`
    : '';

  const reasonHtml = job.obtainability_reason
    ? `<div class="reason">${job.obtainability_reason}</div>`
    : '';

  const postedStr = job.posted_at
    ? new Date(job.posted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Recently';

  jobRows.push(`
    <div class="job-card" id="${job.id}">
      <div class="job-header">
        <div class="job-title-row">
          ${obtainBadge}
          <h2><a href="${job.url}" target="_blank">${job.title}</a></h2>
        </div>
        <div class="job-meta">
          <span class="company">${job.company ?? 'Company not listed'}</span>
          <span class="sep">·</span>
          <span class="salary">${salaryStr}</span>
          <span class="sep">·</span>
          <span class="location">${job.location ?? 'Remote UK'}</span>
          <span class="sep">·</span>
          <span class="source">${job.source}</span>
          <span class="sep">·</span>
          <span class="posted">Posted ${postedStr}</span>
        </div>
      </div>
      ${reasonHtml}
      ${docsHtml}
      ${coverHtml}
      <div class="job-actions">
        <a href="${job.url}" target="_blank" class="btn-apply">Apply Now →</a>
        ${job.applied ? '<span class="applied-badge">✓ Applied</span>' : ''}
      </div>
    </div>
  `);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Job Hunter Dashboard — ${jobs.length} jobs</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #222; }
    header { background: #1B4332; color: white; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 20px; font-weight: 600; }
    header .meta { font-size: 13px; opacity: 0.8; }
    .filters { background: white; padding: 14px 32px; border-bottom: 1px solid #e0e0e0; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .filters input { padding: 7px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; width: 220px; }
    .filters select { padding: 7px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; background: white; }
    .filters label { font-size: 13px; color: #555; }
    .count { font-size: 13px; color: #888; margin-left: auto; }
    main { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
    .job-card { background: white; border-radius: 10px; border: 1px solid #e0e0e0; padding: 22px 24px; margin-bottom: 18px; transition: box-shadow 0.15s; }
    .job-card:hover { box-shadow: 0 3px 12px rgba(0,0,0,0.08); }
    .job-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
    .job-title-row h2 { font-size: 16px; font-weight: 600; }
    .job-title-row h2 a { color: #1B4332; text-decoration: none; }
    .job-title-row h2 a:hover { text-decoration: underline; }
    .badge { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
    .badge.green { background: #d1fae5; color: #065f46; }
    .badge.amber { background: #fef3c7; color: #92400e; }
    .badge.grey { background: #f3f4f6; color: #6b7280; }
    .job-meta { font-size: 13px; color: #666; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .sep { color: #bbb; }
    .company { font-weight: 500; color: #444; }
    .salary { color: #1B4332; font-weight: 600; }
    .reason { margin: 10px 0; font-size: 13px; color: #555; background: #f0f7f4; border-left: 3px solid #1B4332; padding: 8px 12px; border-radius: 0 4px 4px 0; font-style: italic; }
    .doc-links { margin: 12px 0; display: flex; gap: 8px; flex-wrap: wrap; }
    .btn-doc { display: inline-block; padding: 6px 14px; background: #f0f7f4; border: 1px solid #a7d7c5; color: #1B4332; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; }
    .btn-doc:hover { background: #d1fae5; }
    .no-docs { font-size: 13px; color: #999; margin: 10px 0; font-style: italic; }
    .cover-letter { margin: 12px 0; padding: 14px 16px; background: #fafafa; border: 1px solid #e8e8e8; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #444; }
    .job-actions { margin-top: 14px; display: flex; align-items: center; gap: 12px; }
    .btn-apply { display: inline-block; background: #1B4332; color: white; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; }
    .btn-apply:hover { background: #155127; }
    .applied-badge { font-size: 13px; color: #059669; font-weight: 600; }
    .hidden { display: none !important; }
    .no-results { text-align: center; color: #999; padding: 48px; font-size: 15px; }
  </style>
</head>
<body>
  <header>
    <h1>💼 Job Hunter Dashboard</h1>
    <div class="meta">Generated ${new Date().toLocaleString('en-GB')} · ${jobs.length} jobs · sorted by obtainability</div>
  </header>
  <div class="filters">
    <input type="text" id="search" placeholder="Search title, company..." oninput="filterJobs()"/>
    <label>Min score: <select id="minScore" onchange="filterJobs()">
      <option value="0">Any</option>
      <option value="50">50+</option>
      <option value="60">60+</option>
      <option value="75">75+</option>
      <option value="85">85+</option>
    </select></label>
    <label><input type="checkbox" id="docsOnly" onchange="filterJobs()"/> CVs ready only</label>
    <span class="count" id="countLabel">${jobs.length} jobs</span>
  </div>
  <main id="jobList">
    ${jobRows.join('\n')}
    <div class="no-results hidden" id="noResults">No jobs match your filters.</div>
  </main>
  <script>
    function filterJobs() {
      const q = document.getElementById('search').value.toLowerCase();
      const minScore = parseInt(document.getElementById('minScore').value);
      const docsOnly = document.getElementById('docsOnly').checked;
      let count = 0;
      document.querySelectorAll('.job-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        const badge = card.querySelector('.badge');
        const score = badge ? parseInt(badge.textContent) || 0 : 0;
        const hasDocs = card.querySelector('.btn-doc') !== null;
        const show = (!q || text.includes(q)) && score >= minScore && (!docsOnly || hasDocs);
        card.classList.toggle('hidden', !show);
        if (show) count++;
      });
      document.getElementById('countLabel').textContent = count + ' jobs';
      document.getElementById('noResults').classList.toggle('hidden', count > 0);
    }
  </script>
</body>
</html>`;

const outPath = join(__dirname, '..', 'dashboard.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`Dashboard written to: ${outPath}`);
console.log(`Jobs: ${jobs.length} | With documents: ${jobs.filter((j: Record<string, unknown>) => j.jh_documents != null).length}`);
