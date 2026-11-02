import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
// svg-to-pdfkit ships CommonJS without types.
const SVGtoPDF = require('svg-to-pdfkit') as (doc: PDFKit.PDFDocument, svg: string, x: number, y: number, opts?: { width?: number; height?: number; preserveAspectRatio?: string; fontCallback?: () => string }) => void;
const fontDir = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');

export interface PdfQuestion {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
  /** SVG sources of the question figures. */
  images: string[];
}

export interface PdfPaper {
  title: string;
  subtitle: string;
  meta: string;
  questions: PdfQuestion[];
}

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function svgSize(svg: string) {
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 400, h: 300 };
}

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 }, info: { Producer: 'Civil Sansad', Creator: 'Civil Sansad' } });
    doc.registerFont('Body', path.join(fontDir, 'DejaVuSans.ttf'));
    doc.registerFont('Bold', path.join(fontDir, 'DejaVuSans-Bold.ttf'));
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Body').fontSize(8).fillColor('#64748b').text(`Civil Sansad • Page ${i + 1} of ${range.count}`, 50, doc.page.height - 35, { width: doc.page.width - 100, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, paper: PdfPaper, label: string) {
  const width = doc.page.width - 100;
  doc.rect(50, 40, width, 4).fill('#1e6fd0');
  doc.moveDown(0.5);
  doc.font('Bold').fontSize(9).fillColor('#f26b1d').text(`CIVIL SANSAD • ${label.toUpperCase()}`, 50, 54);
  doc.font('Bold').fontSize(17).fillColor('#0f172a').text(paper.title, { width });
  doc.font('Body').fontSize(10).fillColor('#475569').text(paper.subtitle, { width });
  doc.moveDown(0.3).fontSize(9).text(paper.meta, { width });
  doc.moveDown(0.6);
  const y = doc.y;
  doc.moveTo(50, y).lineTo(50 + width, y).lineWidth(1).strokeColor('#0f172a').stroke();
  doc.moveDown(0.8);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

export function questionPaperPdf(paper: PdfPaper): Promise<Buffer> {
  return render((doc) => {
    header(doc, paper, 'Question Paper');
    const width = doc.page.width - 100;
    doc.font('Body').fontSize(9).fillColor('#334155').text('Instructions: Each question has one correct answer. Mark the most appropriate option. Answer key is given in the separate solutions PDF.', { width });
    doc.moveDown(1);
    paper.questions.forEach((q, i) => {
      ensureSpace(doc, 90);
      const top = doc.y;
      doc.font('Bold').fontSize(10.5).fillColor('#0f172a').text(`${i + 1}.`, 50, top, { width: 24 });
      doc.font('Body').fontSize(10.5).text(q.text, 76, top, { width: width - 26 });
      for (const svg of q.images) {
        const { w, h } = svgSize(svg);
        const drawW = Math.min(240, w);
        const drawH = (h / w) * drawW;
        ensureSpace(doc, drawH + 10);
        const y = doc.y + 4;
        SVGtoPDF(doc, svg, 76, y, { width: drawW, height: drawH, fontCallback: () => 'Body' });
        doc.y = y + drawH + 6;
      }
      doc.moveDown(0.2);
      q.options.forEach((opt, k) => {
        doc.font('Body').fontSize(10).fillColor('#1e293b').text(`(${LETTERS[k]}) ${opt}`, 86, doc.y, { width: width - 36 });
      });
      doc.moveDown(0.8);
    });
  });
}

export function solutionsPdf(paper: PdfPaper): Promise<Buffer> {
  return render((doc) => {
    header(doc, paper, 'Answer Key & Solutions');
    const width = doc.page.width - 100;
    // Answer key grid
    doc.font('Bold').fontSize(12).fillColor('#0f172a').text('Answer key');
    doc.moveDown(0.4);
    const cols = 5;
    const cellW = width / cols;
    let y = doc.y;
    paper.questions.forEach((q, i) => {
      const col = i % cols;
      if (col === 0 && i > 0) y += 20;
      if (y + 20 > doc.page.height - 60) {
        doc.addPage();
        y = doc.y;
      }
      doc.rect(50 + col * cellW, y, cellW - 4, 17).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.font('Body').fontSize(9.5).fillColor('#0f172a').text(`${i + 1}.  (${LETTERS[q.correct]})`, 56 + col * cellW, y + 4, { width: cellW - 12, lineBreak: false });
    });
    doc.y = y + 32;
    doc.x = 50;
    doc.font('Bold').fontSize(12).fillColor('#0f172a').text('Detailed solutions', 50, doc.y);
    doc.moveDown(0.5);
    paper.questions.forEach((q, i) => {
      ensureSpace(doc, 60);
      doc.font('Bold').fontSize(10).fillColor('#0f172a').text(`${i + 1}. Answer (${LETTERS[q.correct]}) ${q.options[q.correct]}`, 50, doc.y, { width });
      if (q.explanation) doc.font('Body').fontSize(9.5).fillColor('#334155').text(q.explanation, 64, doc.y, { width: width - 14 });
      doc.moveDown(0.6);
    });
  });
}

export function readSvgIfLocal(url: string, uploadDir: string, publicBase: string): string | null {
  if (!url.startsWith(publicBase) || !url.endsWith('.svg')) return null;
  const file = path.resolve(uploadDir, url.slice(publicBase.length).replace(/^\//, ''));
  if (!file.startsWith(path.resolve(uploadDir))) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
