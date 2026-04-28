import {
  Document, Packer, Paragraph, TextRun,
  BorderStyle, convertInchesToTwip,
} from 'docx';
import { PDFDocument } from 'pdf-lib';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

  // Convert to PDF via docx2pdf (Word COM on Windows, LibreOffice on Linux)
  let pdfBuffer: Buffer | null = null;
  let pageCount = 2; // assume 2 if we can't measure

  const tmpDocx = join(tmpdir(), `akinyavuz_cv_${Date.now()}.docx`);
  const tmpPdf = tmpDocx.replace('.docx', '.pdf');

  try {
    writeFileSync(tmpDocx, docxBuffer);
    pdfBuffer = convertToPdf(tmpDocx, tmpPdf);
    if (pdfBuffer) {
      pageCount = await countPdfPages(pdfBuffer);
    }
  } finally {
    try { if (existsSync(tmpDocx)) require('fs').unlinkSync(tmpDocx); } catch {}
    try { if (existsSync(tmpPdf)) require('fs').unlinkSync(tmpPdf); } catch {}
  }

  return { docxBuffer, pdfBuffer, pageCount };
}

function convertToPdf(docxPath: string, pdfPath: string): Buffer | null {
  // Try Word COM automation first (Windows with Word installed)
  try {
    execSync(
      `powershell -Command "` +
      `$word = New-Object -ComObject Word.Application; ` +
      `$word.Visible = $false; ` +
      `$doc = $word.Documents.Open('${docxPath.replace(/\\/g, '\\\\')}'); ` +
      `$doc.SaveAs([ref]'${pdfPath.replace(/\\/g, '\\\\')}', [ref]17); ` +
      `$doc.Close(); ` +
      `$word.Quit()"`,
      { timeout: 30000 }
    );
    if (existsSync(pdfPath)) return readFileSync(pdfPath);
  } catch {}

  // Fallback: LibreOffice headless
  try {
    const outDir = tmpdir();
    execSync(`soffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`, { timeout: 30000 });
    if (existsSync(pdfPath)) return readFileSync(pdfPath);
  } catch {}

  return null;
}

async function countPdfPages(pdfBuffer: Buffer): Promise<number> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  return pdfDoc.getPageCount();
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
