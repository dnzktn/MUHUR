import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { extractDocxText } from "../../src/services/extraction.service";

async function buildDocxFixture(text: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  });
  return Packer.toBuffer(doc);
}

describe("extractDocxText", () => {
  it("extracts plain text from a docx buffer", async () => {
    const buffer = await buildDocxFixture("Nüfus cüzdanı örneğidir.");
    const text = await extractDocxText(buffer);
    expect(text).toBe("Nüfus cüzdanı örneğidir.");
  });

  it("trims surrounding whitespace", async () => {
    const buffer = await buildDocxFixture("  Doğum belgesi  ");
    const text = await extractDocxText(buffer);
    expect(text).toBe("Doğum belgesi");
  });
});
