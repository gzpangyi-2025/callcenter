const { Document, Packer, Paragraph, ImageRun, Table, TableRow, TableCell, BorderStyle, ShadingType, TextRun } = require('docx');
const fs = require('fs');

async function run() {
  const docChildren = [];
  
  docChildren.push(new Table({
    width: { size: 100, type: "auto" },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: "EBF5FF", type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Hello World", size: 20 })],
                spacing: { after: 0, before: 0 }
              })
            ],
          }),
        ],
      }),
    ],
  }));

  const doc = new Document({ sections: [{ children: docChildren }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync('test-bubble.docx', buffer);
  console.log('Done test-bubble.docx');
}
run();
