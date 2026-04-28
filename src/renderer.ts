import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  BorderStyle, WidthType, ShadingType, AlignmentType, convertInchesToTwip,
} from 'docx';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import type { TailoredCV } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cvBase = yaml.load(readFileSync(join(__dirname, '..', 'config', 'cv-base.yaml'), 'utf-8')) as Record<string, unknown>;
const PHONE = cvBase.phone as string;
const EMAIL = cvBase.email as string;
const PORTFOLIO_URL = cvBase.portfolio as string;
const PORTFOLIO_PROJECTS = cvBase.portfolio_projects as { name: string; description: string }[];
const METHODOLOGIES = ((cvBase.skills as Record<string, unknown>).methodologies as string[]);
const TOOLS = ((cvBase.skills as Record<string, unknown>).tools as string[]);
const DOMAIN_KNOWLEDGE = cvBase.domain_knowledge as string[];

const SKILL_CAT: Record<string, string> = {
  'SQL': 'Data Engineering', 'Power BI': 'Data Engineering',
  'DAX / Power Query': 'Data Engineering', 'DAX': 'Data Engineering',
  'Power Query': 'Data Engineering', 'Excel (Advanced)': 'Data Engineering',
  'Excel': 'Data Engineering', 'ETL / ELT Pipelines': 'Data Engineering',
  'ETL': 'Data Engineering', 'Data Modelling': 'Data Engineering',
  'Data Cleansing & Validation': 'Data Engineering', 'Data Cleansing': 'Data Engineering',
  'Tableau': 'Data Engineering', 'Azure Data Factory': 'Data Engineering',
  'PostgreSQL': 'Data Engineering', 'Data Warehouse (DWH)': 'Data Engineering',
  'Data Warehouse': 'Data Engineering', 'SSRS': 'Data Engineering',
  'Python': 'Data Engineering', 'dbt': 'Data Engineering',
  'Databricks': 'Data Engineering', 'Snowflake': 'Data Engineering',
  'Azure Synapse': 'Data Engineering', 'Lakehouse': 'Data Engineering',
  'PySpark': 'Data Engineering', 'Spark': 'Data Engineering',
  'Microsoft Fabric': 'Systems & Platforms', 'Source Control / Git': 'Systems & Platforms',
  'Git': 'Systems & Platforms', 'Azure Portal': 'Systems & Platforms',
  'SSMS': 'Systems & Platforms', 'VS Code': 'Systems & Platforms',
  'Power BI Service': 'Systems & Platforms', 'Power BI Gateway': 'Systems & Platforms',
  'Agile / Scrum': 'Delivery & Tooling', 'Agile': 'Delivery & Tooling',
  'Scrum': 'Delivery & Tooling', 'Microsoft DevOps': 'Delivery & Tooling',
};

function categoriseSkills(skills: string[]): { category: string; items: string[] }[] {
  const cats: Record<string, string[]> = {
    'Data Engineering': [],
    'Systems & Platforms': [],
    'Delivery & Tooling': [],
    'Other': [],
  };
  for (const s of skills) cats[SKILL_CAT[s] ?? 'Other'].push(s);
  return Object.entries(cats).filter(([, v]) => v.length > 0).map(([category, items]) => ({ category, items }));
}

export interface RenderedCV {
  docxBuffer: Buffer;
  pdfBuffer: Buffer | null;
  pageCount: number;
}

export async function renderCV(cv: TailoredCV, name: string): Promise<RenderedCV> {
  const docxBuffer = await Packer.toBuffer(buildDocx(cv, name));
  let pdfBuffer: Buffer | null = null;
  let pageCount = 2;
  try {
    pdfBuffer = await renderHtmlToPdf(cv, name);
    if (pdfBuffer) {
      const doc = await PDFDocument.load(pdfBuffer);
      pageCount = doc.getPageCount();
    }
  } catch { /* PDF generation failed - DOCX only */ }
  return { docxBuffer, pdfBuffer, pageCount };
}

async function renderHtmlToPdf(cv: TailoredCV, name: string): Promise<Buffer> {
  const html = buildHtml(cv, name);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(cv: TailoredCV, name: string): string {
  const skillCats = categoriseSkills(cv.skills);

  const sidebarSkills = skillCats.map((cat) => `
    <div class="s-cat">${esc(cat.category)}</div>
    ${cat.items.map((item) => `<div class="s-item">${esc(item)}</div>`).join('')}
  `).join('');

  const portfolioProjects = (PORTFOLIO_PROJECTS ?? []).map((p) => `
    <div class="s-proj-name">${esc(p.name)}</div>
    <div class="s-proj-desc">${esc(p.description)}</div>
  `).join('');

  const employmentHtml = cv.employment.map((role) => `
    <div class="role-line">${esc(role.title)}, ${esc(role.company)}</div>
    <div class="role-period">${esc(role.period)}</div>
    ${role.bullets.map((b) => `<div class="role-bullet">– ${esc(b)}</div>`).join('')}
  `).join('');

  const cvBase2 = yaml.load(readFileSync(join(__dirname, '..', 'config', 'cv-base.yaml'), 'utf-8')) as Record<string, unknown>;
  const education = (cvBase2.education as { degree: string; institution: string; period: string; subject: string }[])[0];
  const achievements = cvBase2.achievements as string[];

  const achievementsHtml = achievements.map((a) => `<div class="achieve-item">• ${esc(a)}</div>`).join('');

  const keyProjects = cv.keyProjects ?? [];
  const keyProjectsHtml = keyProjects.map((kp) =>
    `<div class="kp-item">• <span class="kp-name">${esc(kp.name)}</span> — ${esc(kp.description)}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; background: white; }

.sidebar-bg {
  position: fixed; left:0; top:0; width:32.5%; height:100%;
  background:#1B4332; z-index:0;
}
.layout { display:flex; position:relative; }
.sidebar {
  width:32.5%; min-height:297mm; color:white; padding:13mm 8mm 10mm;
  position:relative; z-index:1;
}
.main {
  width:67.5%; padding:13mm 11mm 10mm 12mm;
  background:white; position:relative; z-index:1;
}

.s-name { font-size:24pt; font-weight:800; color:white; line-height:1.1; margin-bottom:4px; }
.s-title { font-size:7.5pt; font-weight:700; color:rgba(255,255,255,0.85); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:14px; line-height:1.3; }
.s-header { font-size:11.5pt; font-weight:700; color:white; border-bottom:1.5px solid rgba(255,255,255,0.45); padding-bottom:3px; margin:11px 0 6px; }
.s-cat { font-size:8.5pt; font-weight:700; color:white; margin:8px 0 3px; }
.s-item { font-size:8.5pt; color:rgba(255,255,255,0.92); margin:1.5px 0; line-height:1.45; }
.s-proj-name { font-size:8.5pt; font-weight:700; color:white; margin:5px 0 1px; }
.s-proj-url { font-size:8pt; color:rgba(255,255,255,0.8); margin-bottom:3px; }
.s-proj-desc { font-size:7.5pt; color:rgba(255,255,255,0.8); line-height:1.4; margin-bottom:4px; }

.m-header { font-size:17pt; font-weight:700; color:#1B4332; border-bottom:2.5px solid #1B4332; padding-bottom:4px; margin:13px 0 8px; line-height:1; }
.m-header:first-child { margin-top:0; }
.role-line { font-size:10.5pt; font-weight:700; color:#1a1a1a; margin-top:9px; margin-bottom:1px; }
.role-period { font-size:8pt; color:#555; margin-bottom:5px; }
.role-bullet { font-size:8.5pt; color:#333; line-height:1.45; padding-left:12px; text-indent:-12px; margin:2px 0; }
.profile-text { font-size:9.5pt; color:#333; line-height:1.58; margin-bottom:4px; }
.edu-degree { font-size:10pt; font-weight:700; color:#1a1a1a; margin-bottom:2px; }
.edu-period { font-size:8pt; color:#555; margin-bottom:2px; }
.edu-subject { font-size:8.5pt; color:#333; }
.achieve-item { font-size:9pt; color:#333; margin:3px 0; }
.kp-name { font-weight:700; }
.kp-item { font-size:8.5pt; color:#333; line-height:1.45; margin:5px 0; padding-left:12px; text-indent:-12px; }
</style>
</head>
<body>
<div class="sidebar-bg"></div>
<div class="layout">
  <div class="sidebar">
    <div class="s-name">${esc(name)}</div>
    <div class="s-title">Microsoft Certified BI Developer and Data Analyst</div>

    <div class="s-header">Details</div>
    <div class="s-item">${esc(cv.location)}</div>
    <div class="s-item">${esc(PHONE ?? '')}</div>
    <div class="s-item">${esc(EMAIL ?? '')}</div>

    <div class="s-header">Skills</div>
    ${sidebarSkills}

    <div class="s-header">Certificates</div>
    ${cv.certifications.map((c) => `<div class="s-item">${esc(c)}</div>`).join('')}

    <div class="s-header">Domain Knowledge</div>
    ${(DOMAIN_KNOWLEDGE ?? []).map((d) => `<div class="s-item">${esc(d)}</div>`).join('')}

    <div class="s-header">Portfolio</div>
    <div class="s-proj-url">${esc(PORTFOLIO_URL ?? '')}</div>
    ${portfolioProjects}

    <div class="s-header">Methodologies</div>
    ${(METHODOLOGIES ?? []).map((m) => `<div class="s-item">${esc(m)}</div>`).join('')}

    <div class="s-header">Tools</div>
    ${(TOOLS ?? []).map((t) => `<div class="s-item">${esc(t)}</div>`).join('')}
  </div>
  <div class="main">
    <div class="m-header" style="margin-top:0">Profile</div>
    <div class="profile-text">${esc(cv.profile)}</div>

    <div class="m-header">Employment History</div>
    ${employmentHtml}

    <div class="m-header">Education</div>
    <div class="edu-degree">${esc(education?.degree ?? '')}, ${esc(education?.institution ?? '')}</div>
    <div class="edu-period">${esc(education?.period ?? '')}</div>
    <div class="edu-subject">${esc(education?.subject ?? '')}</div>

    <div class="m-header">Achievements</div>
    ${achievementsHtml}

    ${keyProjects.length > 0 ? `<div class="m-header">Key Projects</div>${keyProjectsHtml}` : ''}
  </div>
</div>
</body>
</html>`;
}

// ─── DOCX helpers ────────────────────────────────────────────────────────────

const FONT = 'Calibri';

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
const NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};
const CELL_NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  start: NO_BORDER,
  end: NO_BORDER,
};

function sbHeader(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 23, bold: true, color: 'FFFFFF' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '7BA898', space: 2 } },
    spacing: { before: 140, after: 80 },
  });
}

function sbCat(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 17, bold: true, color: 'FFFFFF' })],
    spacing: { before: 100, after: 30 },
  });
}

function sbItem(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 17, color: 'E8F5E9' })],
    spacing: { after: 30 },
  });
}

function sbProjName(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 17, bold: true, color: 'FFFFFF' })],
    spacing: { before: 80, after: 20 },
  });
}

function sbProjDesc(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 15, color: 'C8E6C9' })],
    spacing: { after: 50 },
  });
}

function mainHeader(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: '1B4332' })],
    border: { bottom: { style: BorderStyle.THICK, size: 12, color: '1B4332', space: 4 } },
    spacing: { before: 180, after: 100 },
    alignment: AlignmentType.LEFT,
  });
}

function roleTitle(title: string, company: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: title, font: FONT, size: 21, bold: true, color: '1a1a1a' }),
      new TextRun({ text: `, ${company}`, font: FONT, size: 21, color: '1a1a1a' }),
    ],
    spacing: { before: 120, after: 20 },
  });
}

function rolePeriod(period: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: period, font: FONT, size: 16, color: '555555', italics: true })],
    spacing: { after: 60 },
  });
}

function roleBullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `– ${text}`, font: FONT, size: 17, color: '333333' })],
    spacing: { after: 40 },
    indent: { left: 160, hanging: 160 },
  });
}

// ─── DOCX builder ────────────────────────────────────────────────────────────

function buildDocx(cv: TailoredCV, name: string): Document {
  const skillCats = categoriseSkills(cv.skills);

  const cvBase2 = yaml.load(readFileSync(join(__dirname, '..', 'config', 'cv-base.yaml'), 'utf-8')) as Record<string, unknown>;
  const education = (cvBase2.education as { degree: string; institution: string; period: string; subject: string }[])[0];
  const achievements = cvBase2.achievements as string[];

  // ── Sidebar paragraphs ──────────────────────────────────────────────────
  const sidebarChildren: Paragraph[] = [
    // Name
    new Paragraph({
      children: [new TextRun({ text: name, font: FONT, size: 48, bold: true, color: 'FFFFFF' })],
      spacing: { after: 60 },
    }),
    // Subtitle
    new Paragraph({
      children: [new TextRun({
        text: 'MICROSOFT CERTIFIED BI DEVELOPER AND DATA ANALYST',
        font: FONT, size: 15, bold: true, color: 'D4E8E0',
      })],
      spacing: { after: 180 },
    }),

    // Details
    sbHeader('Details'),
    sbItem(cv.location),
    sbItem(PHONE ?? ''),
    sbItem(EMAIL ?? ''),

    // Skills
    sbHeader('Skills'),
    ...skillCats.flatMap((cat) => [
      sbCat(cat.category),
      ...cat.items.map((item) => sbItem(item)),
    ]),

    // Certificates
    sbHeader('Certificates'),
    ...cv.certifications.map((c) => sbItem(c)),

    // Domain Knowledge
    sbHeader('Domain Knowledge'),
    ...(DOMAIN_KNOWLEDGE ?? []).map((d) => sbItem(d)),

    // Portfolio
    sbHeader('Portfolio'),
    sbItem(PORTFOLIO_URL ?? ''),
    ...(PORTFOLIO_PROJECTS ?? []).flatMap((p) => [
      sbProjName(p.name),
      sbProjDesc(p.description),
    ]),

    // Methodologies
    sbHeader('Methodologies'),
    ...(METHODOLOGIES ?? []).map((m) => sbItem(m)),

    // Tools
    sbHeader('Tools'),
    ...(TOOLS ?? []).map((t) => sbItem(t)),
  ];

  // ── Main column paragraphs ──────────────────────────────────────────────
  const mainChildren: Paragraph[] = [
    // Profile
    new Paragraph({
      children: [new TextRun({ text: 'Profile', font: FONT, size: 28, bold: true, color: '1B4332' })],
      border: { bottom: { style: BorderStyle.THICK, size: 12, color: '1B4332', space: 4 } },
      spacing: { before: 0, after: 100 },
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph({
      children: [new TextRun({ text: cv.profile, font: FONT, size: 19, color: '333333' })],
      spacing: { after: 120 },
    }),

    // Employment
    mainHeader('Employment History'),
    ...cv.employment.flatMap((role) => [
      roleTitle(role.title, role.company),
      rolePeriod(role.period),
      ...role.bullets.map((b) => roleBullet(b)),
    ]),

    // Education
    mainHeader('Education'),
    new Paragraph({
      children: [
        new TextRun({ text: `${education?.degree ?? ''}, ${education?.institution ?? ''}`, font: FONT, size: 20, bold: true, color: '1a1a1a' }),
      ],
      spacing: { after: 30 },
    }),
    new Paragraph({
      children: [new TextRun({ text: education?.period ?? '', font: FONT, size: 16, color: '555555' })],
      spacing: { after: 30 },
    }),
    new Paragraph({
      children: [new TextRun({ text: education?.subject ?? '', font: FONT, size: 17, color: '333333' })],
      spacing: { after: 100 },
    }),

    // Achievements
    mainHeader('Achievements'),
    ...achievements.map((a) =>
      new Paragraph({
        children: [new TextRun({ text: `• ${a}`, font: FONT, size: 18, color: '333333' })],
        spacing: { after: 50 },
      })
    ),
  ];

  // Key Projects
  const keyProjects = cv.keyProjects ?? [];
  if (keyProjects.length > 0) {
    mainChildren.push(mainHeader('Key Projects'));
    for (const kp of keyProjects) {
      mainChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: '• ', font: FONT, size: 17, color: '333333' }),
            new TextRun({ text: kp.name, font: FONT, size: 17, bold: true, color: '333333' }),
            new TextRun({ text: ` — ${kp.description}`, font: FONT, size: 17, color: '333333' }),
          ],
          spacing: { after: 60 },
          indent: { left: 160, hanging: 160 },
        })
      );
    }
  }

  // ── 2-column table ──────────────────────────────────────────────────────
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          // Left sidebar cell
          new TableCell({
            width: { size: 32, type: WidthType.PERCENTAGE },
            shading: { fill: '1B4332', type: ShadingType.SOLID, color: 'auto' },
            borders: CELL_NO_BORDERS,
            margins: { top: 720, bottom: 720, left: 720, right: 720 },
            children: sidebarChildren,
          }),
          // Right main cell
          new TableCell({
            width: { size: 68, type: WidthType.PERCENTAGE },
            borders: CELL_NO_BORDERS,
            margins: { top: 720, bottom: 720, left: 864, right: 720 },
            children: mainChildren,
          }),
        ],
      }),
    ],
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 0,
              right: 0,
            },
          },
        },
        children: [table],
      },
    ],
  });
}
