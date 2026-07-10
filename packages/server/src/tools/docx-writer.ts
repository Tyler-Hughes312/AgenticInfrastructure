import { Document, Packer, Paragraph, TextRun } from "docx";

/** Build a .docx buffer from plain text or markdown-ish content. */
export async function textToDocxBuffer(text: string): Promise<Buffer> {
  const blocks = text.split(/\n\n+/).filter(Boolean);
  const paragraphs =
    blocks.length > 0
      ? blocks.map(
          (block) =>
            new Paragraph({
              children: [new TextRun(block.replace(/\n/g, " "))],
            })
        )
      : [new Paragraph({ children: [new TextRun("")] })];

  const doc = new Document({
    sections: [{ children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}
