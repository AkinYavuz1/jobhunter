import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { env } from './env.js';
import { generateForJob, mergeIntoScoredJob } from './generator.js';
import { renderCV } from './renderer.js';
import { saveJob, saveDocument, uploadFile, getSignedUrl } from './storage.js';
import { fetchFullDescription, needsFullDescription } from './fetch-detail.js';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalConfig = yaml.load(readFileSync(join(__dirname, '..', 'config', 'global.yaml'), 'utf-8')) as Record<string, unknown>;
const cvBaseYaml = readFileSync(join(__dirname, '..', 'config', 'cv-base.yaml'), 'utf-8');

const PORT = 3001;
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const app = express();
app.use(express.json());

// ── Dashboard ─────────────────────────────────────────────────────────────────

app.get('/', async (_req, res) => {
  const { data: jobs, error } = await supabase
    .from('jh_jobs')
    .select('*, jh_documents(cover_letter, folder_path, page_count)')
    .order('obtainability', { ascending: false, nullsFirst: false });

  if (error) { res.status(500).send(error.message); return; }

  const rows: string[] = [];
  for (const job of jobs ?? []) {
    const doc = (job.jh_documents as Record<string, unknown> | null) ?? null;

    const salaryStr = job.salary_min && job.salary_max
      ? `£${Math.round(job.salary_min / 1000)}k – £${Math.round(job.salary_max / 1000)}k`
      : job.salary_max ? `Up to £${Math.round(job.salary_max / 1000)}k`
      : job.salary_min ? `£${Math.round(job.salary_min / 1000)}k+` : 'Salary TBC';

    const badge = job.obtainability >= 75 ? `<span class="badge green">${job.obtainability}/100</span>`
      : job.obtainability >= 50 ? `<span class="badge amber">${job.obtainability}/100</span>`
      : job.obtainability > 0 ? `<span class="badge grey">${job.obtainability}/100</span>`
      : `<span class="badge grey">Unscored</span>`;

    const postedStr = job.posted_at
      ? new Date(job.posted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Recently';

    const safeId = (job.id as string).replace(/[^a-zA-Z0-9_-]/g, '_');

    let docsArea = '';
    if (doc?.folder_path) {
      try {
        const fp = doc.folder_path as string;
        const [docxUrl, pdfUrl, txtUrl] = await Promise.all([
          getSignedUrl(`${fp}akinyavuz_cv.docx`),
          getSignedUrl(`${fp}akinyavuz_cv.pdf`),
          getSignedUrl(`${fp}akinyavuz_cover_letter.txt`),
        ]);
        docsArea = `
          <div class="doc-links" id="docs_${safeId}">
            <a href="${docxUrl}" target="_blank" class="btn-doc">📄 CV (.docx)</a>
            <a href="${pdfUrl}" target="_blank" class="btn-doc">📋 CV (.pdf)</a>
            <a href="${txtUrl}" target="_blank" class="btn-doc">✉️ Cover letter</a>
          </div>
          ${doc.cover_letter ? `<div class="cover-letter" id="cl_${safeId}"><strong>Cover letter:</strong><br/><br/>${doc.cover_letter as string}</div>` : ''}
        `;
      } catch {
        docsArea = `<div class="doc-links" id="docs_${safeId}"></div>`;
      }
    } else {
      docsArea = `
        <div class="doc-links" id="docs_${safeId}"></div>
        <div class="no-docs" id="nodocs_${safeId}">No CV yet</div>
      `;
    }

    const reasonHtml = job.obtainability_reason
      ? `<div class="reason">${job.obtainability_reason}</div>` : '';

    const appliedClass = job.applied ? ' card-applied' : '';
    const regenBtn = `<button class="btn-action btn-regen" id="genbtn_${safeId}" onclick="generateCV('${job.id}','${safeId}')">↻ Regenerate CV</button>`;
    const actionButtons = job.applied
      ? `<span class="applied-badge">✓ Applied</span>`
      : `<a href="${job.url}" target="_blank" class="btn-apply">Apply Now →</a>
         ${!doc?.folder_path
           ? `<button class="btn-action btn-generate" id="genbtn_${safeId}" onclick="generateCV('${job.id}','${safeId}')">⚡ Generate CV</button>`
           : regenBtn}
         <button class="btn-action btn-applied" onclick="markApplied('${job.id}','${safeId}')">✓ Applied for this</button>
         <button class="btn-action btn-dismiss" onclick="dismiss('${safeId}')">✕ Not Interested</button>`;

    rows.push(`
      <div class="job-card${appliedClass}" id="card_${safeId}" data-id="${job.id}">
        <div class="job-header">
          <div class="job-title-row">
            ${badge}
            <h2><a href="${job.url}" target="_blank">${job.title}</a></h2>
          </div>
          <div class="job-meta">
            <span class="company">${job.company ?? 'Company not listed'}</span>
            <span class="sep">·</span><span class="salary">${salaryStr}</span>
            <span class="sep">·</span><span class="location">${job.location ?? 'Remote UK'}</span>
            <span class="sep">·</span><span class="source">${job.source}</span>
            <span class="sep">·</span><span class="posted">Posted ${postedStr}</span>
          </div>
        </div>
        ${reasonHtml}
        ${docsArea}
        <div class="job-actions">${actionButtons}</div>
      </div>`);
  }

  const total = jobs?.length ?? 0;
  res.send(buildPage(rows.join('\n'), total));
});

// ── Generate CV on demand ─────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { id } = req.body as { id: string };
  if (!id) { res.status(400).json({ error: 'Missing job id' }); return; }

  const { data: row } = await supabase.from('jh_jobs').select('*').eq('id', id).maybeSingle();
  if (!row) { res.status(404).json({ error: 'Job not found' }); return; }

  try {
    const job = {
      id: row.id, source: row.source, title: row.title, company: row.company,
      location: row.location, salaryMin: row.salary_min, salaryMax: row.salary_max,
      salaryCurrency: row.salary_currency ?? 'GBP', salaryPeriod: row.salary_period ?? 'annual',
      employmentType: row.employment_type ?? 'permanent',
      description: row.description, descriptionFull: row.description_full ?? false,
      url: row.url, urlCanonical: row.url_canonical ?? row.url,
      postedAt: row.posted_at ? new Date(row.posted_at) : null, raw: row.raw,
    };

    // Fetch full description if needed
    if (needsFullDescription(job.description)) {
      const full = await fetchFullDescription(job.url, job.description);
      if (full) { job.description = full; job.descriptionFull = true; }
    }

    // Generate with Groq
    const output = await generateForJob(job, cvBaseYaml, globalConfig);
    const scored = mergeIntoScoredJob(job, output);
    await saveJob(scored);

    // Render
    const cvForRender = { ...output.cv, keyProjects: output.keyProjects ?? [] };
    const { docxBuffer, pdfBuffer, pageCount } = await renderCV(cvForRender, 'Akin Yavuz');

    // Save to Downloads folder — Company - Job Title
    const folderName = sanitiseFolderName(`${row.company ?? 'Unknown'} - ${row.title}`);
    const localDir = join(homedir(), 'Downloads', folderName);
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, 'akinyavuz_cv.docx'), docxBuffer);
    if (pdfBuffer) writeFileSync(join(localDir, 'akinyavuz_cv.pdf'), pdfBuffer);
    writeFileSync(join(localDir, 'akinyavuz_cover_letter.txt'), output.coverLetter, 'utf-8');
    console.log(`Files saved → ${localDir}`);

    // Upload to Supabase Storage
    const fp = `jobs/${id}/`;
    await uploadFile(`${fp}akinyavuz_cv.docx`, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (pdfBuffer) await uploadFile(`${fp}akinyavuz_cv.pdf`, pdfBuffer, 'application/pdf');
    await uploadFile(`${fp}akinyavuz_cover_letter.txt`, output.coverLetter, 'text/plain');

    await saveDocument(id, { coverLetter: output.coverLetter, cvTailored: output.cv, folderPath: fp, pageCount });

    const [docxUrl, pdfUrl, txtUrl] = await Promise.all([
      getSignedUrl(`${fp}akinyavuz_cv.docx`),
      getSignedUrl(`${fp}akinyavuz_cv.pdf`),
      getSignedUrl(`${fp}akinyavuz_cover_letter.txt`),
    ]);

    res.json({ docxUrl, pdfUrl, txtUrl, coverLetter: output.coverLetter, obtainability: output.obtainability, localDir });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Dashboard: ${url}`);
  exec(`start ${url}`);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitiseFolderName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '')   // strip Windows-invalid chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);                   // keep paths reasonable
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildPage(jobRows: string, total: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Job Hunter — ${total} jobs</title>
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
    .doc-links { margin: 12px 0; display: flex; gap: 8px; flex-wrap: wrap; min-height: 0; }
    .btn-doc { display: inline-block; padding: 6px 14px; background: #f0f7f4; border: 1px solid #a7d7c5; color: #1B4332; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; }
    .btn-doc:hover { background: #d1fae5; }
    .no-docs { font-size: 13px; color: #bbb; margin: 4px 0 8px; font-style: italic; }
    .cover-letter { margin: 12px 0; padding: 14px 16px; background: #fafafa; border: 1px solid #e8e8e8; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #444; }
    .job-actions { margin-top: 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .btn-apply { display: inline-block; background: #1B4332; color: white; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; }
    .btn-apply:hover { background: #155127; }
    .btn-action { border: none; cursor: pointer; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; }
    .btn-generate { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .btn-generate:hover:not(:disabled) { background: #dbeafe; }
    .btn-generate:disabled { opacity: 0.6; cursor: wait; }
    .btn-regen { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; font-size: 12px; padding: 6px 12px; }
    .btn-regen:hover:not(:disabled) { background: #e5e7eb; }
    .btn-regen:disabled { opacity: 0.6; cursor: wait; }
    .btn-applied { background: #d1fae5; color: #065f46; }
    .btn-applied:hover { background: #a7f3d0; }
    .btn-dismiss { background: #fee2e2; color: #991b1b; }
    .btn-dismiss:hover { background: #fecaca; }
    .applied-badge { font-size: 13px; color: #059669; font-weight: 700; }
    .card-applied { border-color: #6ee7b7; background: #f0fdf4; }
    .card-dismissed { opacity: 0.45; border-style: dashed; }
    .hidden { display: none !important; }
    .no-results { text-align: center; color: #999; padding: 48px; font-size: 15px; }
  </style>
</head>
<body>
  <header>
    <h1>💼 Job Hunter Dashboard</h1>
    <div class="meta">${total} jobs · sorted by obtainability · <a href="/" style="color:rgba(255,255,255,0.7)">refresh</a></div>
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
    <label><input type="checkbox" id="showDismissed" onchange="filterJobs()"/> Show dismissed</label>
    <span class="count" id="countLabel">${total} jobs</span>
  </div>
  <main id="jobList">
    ${jobRows}
    <div class="no-results hidden" id="noResults">No jobs match your filters.</div>
  </main>
  <script>
    const SUPABASE_URL = '${env.SUPABASE_URL}';
    const SUPABASE_KEY = '${env.SUPABASE_SERVICE_KEY}';

    async function generateCV(jobId, safeId) {
      const btn = document.getElementById('genbtn_' + safeId);
      if (!btn) return;
      const isRegen = btn.classList.contains('btn-regen');
      btn.textContent = isRegen ? '⏳ Regenerating (~10s)...' : '⏳ Generating (~10s)...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: jobId }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        const data = await res.json();

        // Show download links
        const docsDiv = document.getElementById('docs_' + safeId);
        if (docsDiv) {
          docsDiv.innerHTML =
            '<a href="' + data.docxUrl + '" target="_blank" class="btn-doc">📄 CV (.docx)</a>' +
            (data.pdfUrl ? '<a href="' + data.pdfUrl + '" target="_blank" class="btn-doc">📋 CV (.pdf)</a>' : '') +
            '<a href="' + data.txtUrl + '" target="_blank" class="btn-doc">✉️ Cover letter</a>' +
            (data.localDir ? '<span style="font-size:12px;color:#6b7280;margin-left:8px">📁 Saved to Downloads/' + data.localDir.split(/[\\/]/).pop() + '</span>' : '');
        }
        const nodocsDiv = document.getElementById('nodocs_' + safeId);
        if (nodocsDiv) nodocsDiv.remove();

        // Show cover letter inline
        if (data.coverLetter) {
          const existing = document.getElementById('cl_' + safeId);
          if (!existing) {
            const cl = document.createElement('div');
            cl.className = 'cover-letter';
            cl.id = 'cl_' + safeId;
            cl.innerHTML = '<strong>Cover letter:</strong><br/><br/>' + data.coverLetter;
            docsDiv?.after(cl);
          }
        }

        // Keep as regenerate button for future use
        btn.className = 'btn-action btn-regen';
        btn.textContent = '↻ Regenerate CV';
        btn.disabled = false;
      } catch (e) {
        btn.textContent = isRegen ? '↻ Regenerate CV' : '⚡ Generate CV';
        btn.disabled = false;
        alert('Generation failed: ' + e.message);
      }
    }

    function getDismissed() { return new Set(JSON.parse(localStorage.getItem('jh_dismissed') || '[]')); }
    function saveDismissed(s) { localStorage.setItem('jh_dismissed', JSON.stringify([...s])); }

    function dismiss(safeId) {
      const card = document.getElementById('card_' + safeId);
      if (!card) return;
      const dismissed = getDismissed(); dismissed.add(card.dataset.id); saveDismissed(dismissed);
      card.classList.add('card-dismissed'); filterJobs();
    }

    async function markApplied(jobId, safeId) {
      const card = document.getElementById('card_' + safeId);
      if (!card) return;
      const res = await fetch(SUPABASE_URL + '/rest/v1/jh_jobs?id=eq.' + encodeURIComponent(jobId), {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ applied: true, applied_at: new Date().toISOString() }),
      });
      if (res.ok || res.status === 204) {
        card.classList.add('card-applied');
        card.querySelector('.job-actions').innerHTML = '<span class="applied-badge">✓ Applied</span>';
      }
    }

    function filterJobs() {
      const q = document.getElementById('search').value.toLowerCase();
      const minScore = parseInt(document.getElementById('minScore').value);
      const docsOnly = document.getElementById('docsOnly').checked;
      const showDismissed = document.getElementById('showDismissed').checked;
      const dismissed = getDismissed();
      let count = 0;
      document.querySelectorAll('.job-card').forEach(card => {
        const isDismissed = dismissed.has(card.dataset.id);
        const score = parseInt(card.querySelector('.badge')?.textContent) || 0;
        const hasDocs = card.querySelector('.btn-doc') !== null;
        const show = (!q || card.textContent.toLowerCase().includes(q)) && score >= minScore && (!docsOnly || hasDocs) && (!isDismissed || showDismissed);
        card.classList.toggle('hidden', !show);
        if (isDismissed) card.classList.add('card-dismissed');
        if (show) count++;
      });
      document.getElementById('countLabel').textContent = count + ' jobs';
      document.getElementById('noResults').classList.toggle('hidden', count > 0);
    }

    document.addEventListener('DOMContentLoaded', () => {
      getDismissed().forEach(id => { const c = document.querySelector('[data-id="' + id + '"]'); if (c) c.classList.add('card-dismissed'); });
      filterJobs();
    });
  </script>
</body>
</html>`;
}
