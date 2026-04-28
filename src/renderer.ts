import {
  Document, Packer, Paragraph, TextRun,
  BorderStyle, convertInchesToTwip,
} from 'docx';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import type { TailoredCV } from './types.js';

const FONT = 'Calibri';
const FONT_SIZE_BODY = 22;   // half-points: 22 = 11pt
const FONT_SIZE_HEADING1 = 26; // 13pt
const FONT_SIZE_NAME = 36;   // 18pt

export interface RenderedCV {
  docxBuffer: Buffer;
  pdfBuffer: Buffer | null;
  pageCount: number;
}

export async function renderCV(cv: TailoredCV, name: string): Promise<RenderedCV> {
  const doc = buildDocument(cv, name);
  const docxBuffer = await Packer.toBuffer(doc);

  let pdfBuffer: Buffer | null = null;
  let pageCount = 2;

  try {
    pdfBuffer = await renderHtmlToPdf(cv, name);
    if (pdfBuffer) {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      pageCount = pdfDoc.getPageCount();
    }
  } catch {
    // PDF generation failed — DOCX only
  }

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
      margin: { top: '15mm', right: '18mm', bottom: '15mm', left: '18mm' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function buildHtml(cv: TailoredCV, name: string): string {
  const roles = cv.employment.map((role) => `
    <div class="role">
      <div class="role-header">
        <span class="role-title">${role.title}</span>, <span class="role-company">${role.company}</span>
        <span class="role-period">${role.period}</span>
      </div>
      <ul>${role.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #222; line-height: 1.35; }
  h1 { font-size: 18pt; color: #1B4332; margin-bottom: 2px; }
  .headline { font-size: 11pt; font-weight: bold; color: #1B4332; margin-bottom: 2px; }
  .location { color: #666; margin-bottom: 12px; font-size: 10pt; }
  h2 { font-size: 12pt; color: #1B4332; border-bottom: 1.5px solid #1B4332; margin: 12px 0 5px; padding-bottom: 2px; }
  p { margin-bottom: 6px; }
  ul { margin: 4px 0 4px 16px; }
  li { margin-bottom: 3px; font-size: 10.5pt; }
  .skills { font-size: 10.5pt; }
  .role { margin-bottom: 8px; }
  .role-header { display: flex; justify-content: space-between; flex-wrap: wrap; margin-bottom: 2px; }
  .role-title { font-weight: bold; font-size: 11pt; }
  .role-company { font-size: 11pt; }
  .role-period { color: #666; font-style: italic; font-size: 10pt; }
  .certs { font-size: 10.5pt; }
</style>
</head>
<body>
  <h1>${name}</h1>
  <div class="headline">Microsoft Certified BI Developer and Data Analyst</div>
  <div class="location">${cv.location}</div>

  <h2>Profile</h2>
  <p>${cv.profile}</p>

  <h2>Key Skills</h2>
  <div class="skills">${cv.skills.join(' · ')}</div>

  <h2>Employment History</h2>
  ${roles}

  <h2>Certifications</h2>
  <div class="certs">${cv.certifications.join(' · ')}</div>

  <h2>Education</h2>
  <p>BA (Hons) Business Information Systems, Northumbria University (2011–2014)</p>

  <h2>Achievements</h2>
  <p>4x Gold Medallist — Powerlifting Commonwealth Games · Delivered report training internationally</p>
</body>
</html>`;
}

function buildDocument(cv: TailoredCV, candidateName: string): Document {
  const sections = [
    // Name + headline
    new Paragraph({
      children: [new TextRun({ text: candidateName, font: FONT, size: FONT_SIZE_NAME, bold: true, color: '1B4332' })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Microsoft Certified BI Developer and Data Analyst', font: FONT, size: FONT_SIZE_BODY, bold: true, color: '1B4332' })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: cv.location, font: FONT, size: FONT_SIZE_BODY, color: '444444' })],
      spacing: { after: 160 },
    }),

    // Profile
    sectionHeading('Profile'),
    new Paragraph({
      children: [new TextRun({ text: cv.profile, font: FONT, size: FONT_SIZE_BODY })],
      spacing: { after: 160 },
    }),

    // Skills (comma-separated, ATS-friendly)
    sectionHeading('Key Skills'),
    new Paragraph({
      children: [new TextRun({ text: cv.skills.join(' · '), font: FONT, size: FONT_SIZE_BODY })],
      spacing: { after: 160 },
    }),

    // Employment
    sectionHeading('Employment History'),
    ...cv.employment.flatMap((role) => [
      new Paragraph({
        children: [
          new TextRun({ text: role.title, font: FONT, size: FONT_SIZE_BODY + 2, bold: true }),
          new TextRun({ text: `, ${role.company}`, font: FONT, size: FONT_SIZE_BODY + 2 }),
        ],
        spacing: { before: 120, after: 20 },
      }),
      new Paragraph({
        children: [new TextRun({ text: role.period, font: FONT, size: FONT_SIZE_BODY, color: '666666', italics: true })],
        spacing: { after: 60 },
      }),
      ...role.bullets.map((bullet) =>
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: bullet, font: FONT, size: FONT_SIZE_BODY })],
          spacing: { after: 40 },
        })
      ),
    ]),

    // Certifications
    sectionHeading('Certifications'),
    new Paragraph({
      children: [new TextRun({ text: cv.certifications.join(' · '), font: FONT, size: FONT_SIZE_BODY })],
      spacing: { after: 160 },
    }),

    // Education
    sectionHeading('Education'),
    new Paragraph({
      children: [new TextRun({ text: 'BA (Hons) Business Information Systems, Northumbria University', font: FONT, size: FONT_SIZE_BODY })],
      spacing: { after: 160 },
    }),

    // Achievements (at bottom — ATS doesn't score it but humans like it)
    sectionHeading('Achievements'),
    new Paragraph({
      children: [new TextRun({ text: '4x Gold Medallist — Powerlifting Commonwealth Games · Delivered report training internationally across multiple countries', font: FONT, size: FONT_SIZE_BODY })],
      spacing: { after: 0 },
    }),
  ];

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.75),
              bottom: convertInchesToTwip(0.6),
              left: convertInchesToTwip(0.75),
            },
          },
        },
        children: sections,
      },
    ],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: FONT_SIZE_HEADING1, bold: true, color: '1B4332' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1B4332', space: 4 } },
    spacing: { before: 200, after: 80 },
  });
}
