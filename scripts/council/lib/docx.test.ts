// Extraction tests for the office zip-container readers.
//
// The ODT case is the one worth pinning: ODF encodes runs of spaces as
// <text:s/> ELEMENTS rather than literal whitespace, so a naive "strip all
// tags" pass welds tokens together. That is not a cosmetic difference — it
// produced "Р Е Ш Е Н И Е№295" from Разград's protokol 22, and a marker or
// tally regex failing on that reads like upstream reformatting rather than
// like a bug on our side.

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractOdtText } from "./docx";

/** Build a minimal .odt (a zip whose root content.xml holds the body). */
const makeOdt = async (contentXml: string): Promise<Buffer> => {
  const dir = await mkdtemp(join(tmpdir(), "odt-test-"));
  try {
    await writeFile(join(dir, "content.xml"), contentXml, "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("zip", ["-q", "out.odt", "content.xml"], {
        cwd: dir,
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`zip exited ${code}`)),
      );
    });
    return await readFile(join(dir, "out.odt"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document-content ` +
  `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
  `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">` +
  `<office:body><office:text>${body}</office:text></office:body>` +
  `</office:document-content>`;

describe("extractOdtText", () => {
  it("turns <text:s/> into a space instead of dropping it", async () => {
    // The exact shape Разград ships: the space before № is a <text:s/>.
    const odt = await makeOdt(
      wrap("<text:p>Р Е Ш Е Н И Е<text:s/>№ 295</text:p>"),
    );
    const text = await extractOdtText(odt);

    expect(text).toContain("Р Е Ш Е Н И Е №");
    expect(text).not.toContain("Е№");
    // And the parser's own marker regex must find it.
    expect(/Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е\s*№\s*(\d{1,5})/u.exec(text)?.[1]).toBe(
      "295",
    );
  });

  it('expands <text:s text:c="N"/> to N spaces', async () => {
    const odt = await makeOdt(wrap('<text:p>a<text:s text:c="4"/>b</text:p>'));
    expect(await extractOdtText(odt)).toContain("a    b");
  });

  it("breaks paragraphs and headings onto their own lines", async () => {
    const odt = await makeOdt(
      wrap(
        "<text:h>Заглавие</text:h><text:p>едно</text:p><text:p>две</text:p>",
      ),
    );
    const lines = (await extractOdtText(odt))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines).toEqual(["Заглавие", "едно", "две"]);
  });

  it("unescapes entities without double-decoding &amp;lt;", async () => {
    const odt = await makeOdt(
      wrap("<text:p>a &amp;lt; b &quot;c&quot;</text:p>"),
    );
    const text = await extractOdtText(odt);
    expect(text).toContain('a &lt; b "c"');
  });
});
