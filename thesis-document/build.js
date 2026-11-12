// Builds Chapters 4 and 5 as a Word document from the measured results.
const fs = require('fs');
const { d, NUMBERING_CONFIGS, FONT } = require('./lib');
const { Document, Packer, Footer, Paragraph, TextRun, AlignmentType, PageNumber } = d;

const body = [...require('./ch4a')(), ...require('./ch4b')(), ...require('./ch4c')(), ...require('./ch5')()];
body.shift(); // drop the page break before the first chapter title

const doc = new Document({
  creator: 'ChainCare EHR study',
  title: 'Chapters Four and Five: System Implementation; Summary, Conclusion and Recommendations',
  styles: {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 28, bold: true }, paragraph: { outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true }, paragraph: { outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true }, paragraph: { outlineLevel: 2 } },
    ],
  },
  numbering: { config: NUMBERING_CONFIGS },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 })] })] }) },
    children: body,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const outPath = process.argv[2] ?? '/root/ehr/doc/Chapters_4_and_5_Blockchain_EHR.docx';
  fs.writeFileSync(outPath, buf);
  console.log('wrote', outPath, (buf.length / 1048576).toFixed(1), 'MB');
});
