// Formatting helpers for the Chapter 4 and 5 Word document.
const fs = require('fs');
const d = require('docx');
const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType,
  ImageRun, HeadingLevel, PageBreak, LevelFormat, TableLayoutType, VerticalAlign } = d;

const FONT = 'Times New Roman';
const BODY = 24;           // 12 pt
const CONTENT_W = 9026;    // A4 width minus 1-inch margins, in DXA
const LINE = 360;          // 1.5 line spacing

let tableNo = 0, figNo = 0;
const reset = (chapter) => { tableNo = 0; figNo = 0; CH = chapter; };
let CH = 4;

/** Inline markup: **bold**, *italic*, `code`. */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: BODY, ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, size: BODY, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', size: BODY - 3, ...base }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, font: FONT, size: BODY, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, size: BODY, ...base }));
  return out;
}

const P = (text, opts = {}) => new Paragraph({
  children: runs(text), alignment: opts.align ?? AlignmentType.JUSTIFIED,
  spacing: { line: LINE, after: opts.after ?? 160, before: opts.before ?? 0 }, indent: opts.indent,
  keepNext: opts.keepNext,
});

const chapterTitle = (num, title) => [
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: `CHAPTER ${num}`, bold: true, font: FONT, size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 },
    children: [new TextRun({ text: title, bold: true, font: FONT, size: 28 })] }),
];

const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 240, after: 160, line: LINE },
  children: [new TextRun({ text, bold: true, font: FONT, size: BODY })] });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, spacing: { before: 200, after: 120, line: LINE },
  children: [new TextRun({ text, bold: true, font: FONT, size: BODY })] });
const H4 = (text) => new Paragraph({ keepNext: true, spacing: { before: 160, after: 100, line: LINE },
  children: [new TextRun({ text, bold: true, italics: true, font: FONT, size: BODY })] });

const bullet = (text, level = 0) => new Paragraph({ children: runs(text), numbering: { reference: 'bullets', level },
  alignment: AlignmentType.JUSTIFIED, spacing: { line: LINE, after: 80 } });
let numRef = 0;
/** A fresh numbered list (restarts at 1). Returns a function that makes items. */
function numbered() {
  const ref = `num${numRef++}`;
  NUMBERING_CONFIGS.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] });
  return (text) => new Paragraph({ children: runs(text), numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { line: LINE, after: 100 } });
}
const NUMBERING_CONFIGS = [{
  reference: 'bullets', levels: [
    { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } },
    { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 300 } } } }],
}];

const border = { style: BorderStyle.SINGLE, size: 4, color: '9AA8A3' };
const borders = { top: border, bottom: border, left: border, right: border };

function caption(kind, text) {
  const n = kind === 'Table' ? ++tableNo : ++figNo;
  return { n: `${CH}.${n}`, para: new Paragraph({ alignment: AlignmentType.CENTER, keepNext: kind === 'Table',
    spacing: { before: kind === 'Table' ? 200 : 80, after: kind === 'Table' ? 100 : 240 },
    children: [new TextRun({ text: `${kind} ${CH}.${n}: `, bold: true, font: FONT, size: 22 }), new TextRun({ text, font: FONT, size: 22 })] }) };
}

/** Table with header row. widths are relative weights; cells may contain **bold** markup. */
function table(title, headers, rows, weights, opts = {}) {
  const total = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map(w => Math.round(CONTENT_W * w / total));
  cols[cols.length - 1] += CONTENT_W - cols.reduce((a, b) => a + b, 0);
  const size = opts.size ?? 20;
  const cell = (text, i, head) => new TableCell({
    width: { size: cols[i], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.TOP,
    shading: head ? { fill: 'E3F1EC', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: String(text).split('\n').map(line => new Paragraph({
      alignment: (opts.alignRight?.includes(i) && !head) ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: runs(line, { size, bold: head || undefined }) })),
  });
  const cap = caption('Table', title);
  const t = new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: cols, layout: TableLayoutType.FIXED,
    rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))] });
  const out = [cap.para, t];
  if (opts.note) out.push(new Paragraph({ spacing: { before: 60, after: 200 }, children: runs(opts.note, { size: 20, italics: true }) }));
  else out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  out.ref = cap.n;
  return out;
}

function pngSize(path) {
  const b = fs.readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Image scaled to widthIn inches (default full text width), caption below. */
function figure(path, title, widthIn = 6.27, maxHeightIn = 8.4) {
  const { w, h } = pngSize(path);
  let wpx = widthIn * 96, hpx = wpx * h / w;
  if (hpx > maxHeightIn * 96) { hpx = maxHeightIn * 96; wpx = hpx * w / h; }
  const cap = caption('Figure', title);
  const out = [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 40 },
    children: [new ImageRun({ type: 'png', data: fs.readFileSync(path), transformation: { width: Math.round(wpx), height: Math.round(hpx) },
      altText: { title, description: title, name: title } })] }), cap.para];
  out.ref = cap.n;
  return out;
}

/** Monospace block for commands and code. */
function code(lines) {
  return lines.split('\n').map((l, i, a) => new Paragraph({
    shading: { fill: 'F2F4F3', type: ShadingType.CLEAR, color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: '0F6B4F', space: 6 } },
    spacing: { before: i === 0 ? 80 : 0, after: i === a.length - 1 ? 180 : 0, line: 260 }, indent: { left: 200 },
    children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 16 })] }));
}

module.exports = { d, P, H2, H3, H4, bullet, numbered, table, figure, code, chapterTitle, caption, runs, reset,
  NUMBERING_CONFIGS, FONT, BODY, CONTENT_W };
