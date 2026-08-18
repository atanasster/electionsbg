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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractDocxText,
  extractOdtText,
  extractWordText,
  isMalformedArchiveError,
  MalformedArchiveError,
} from "./docx";

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

// The malformed-container half, which is a WATERMARK gate rather than a
// text-extraction one. `extractDocxText` throwing is not in question — the
// question is what it throws, because every parser's catch maps that to a
// `MuniScrapeError.kind` and the two answers behave oppositely: a `fetch`
// caps the município's `sinceDate` strictly below that protocol so the next
// run retries it, a `content` lets the watermark past and files it on the
// deferred ledger. Bytes already in hand can only be the second — retrying
// an identical download reproduces the failure exactly.
//
// PER32 is the worked example. Протокол №13/19-10-2025's href serves a Word
// 97-2003 .doc, this parser fed it to the OOXML reader, the failure was
// stamped `fetch`, and Перник sat pinned at sinceDate 2025-10-16 re-writing
// 271 unchanged resolutions on every run.

/** Build a zip from a {name: contents} map, optionally with junk prepended. */
const makeZip = async (
  files: Record<string, string>,
  prependBytes = 0,
): Promise<Buffer> => {
  const dir = await mkdtemp(join(tmpdir(), "zip-test-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      const full = join(dir, name);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body, "utf8");
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "zip",
        ["-q", "-r", "out.zip", ...Object.keys(files)],
        {
          cwd: dir,
          stdio: "ignore",
        },
      );
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`zip exited ${code}`)),
      );
    });
    const zip = await readFile(join(dir, "out.zip"));
    return prependBytes > 0
      ? Buffer.concat([Buffer.alloc(prependBytes, 0x41), zip])
      : zip;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const OLE2_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

const docxWith = (body: string) =>
  makeZip({
    "word/document.xml":
      `<?xml version="1.0"?><w:document ` +
      `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  });

describe("extractDocxText", () => {
  it("extracts the body of a well-formed .docx", async () => {
    const docx = await docxWith(
      "<w:p><w:r><w:t>Р Е Ш Е Н И Е № 295</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>второ</w:t></w:r></w:p>",
    );
    const text = await extractDocxText(docx);
    expect(text).toContain("Р Е Ш Е Н И Е № 295");
    // </w:p> becomes a newline, so the two paragraphs stay apart.
    expect(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ).toEqual(["Р Е Ш Е Н И Е № 295", "второ"]);
  });

  it("raises MalformedArchiveError on a legacy .doc served as .docx", async () => {
    // The Перник case, by magic bytes: an OLE2 compound file. unzip reports
    // it as `exited 9`, or — when Word embedded a themeData zip inside the
    // stream, which is what protokol №13 actually ships — as the far more
    // confusing `exited 11: caution: filename not matched`.
    const doc = Buffer.concat([OLE2_HEADER, Buffer.alloc(2048, 0x20)]);
    await expect(extractDocxText(doc)).rejects.toThrow(MalformedArchiveError);
    await expect(extractDocxText(doc)).rejects.toThrow(
      /legacy Word 97-2003 \.doc/,
    );
  });

  it("raises MalformedArchiveError on a zip with no word/document.xml", async () => {
    // The unzip-exit-11 arm, reached without the magic sniff: a real zip,
    // with prepended bytes, holding only the theme parts. Byte-for-byte the
    // shape of the stderr on PER32's deferred ledger.
    const notADocx = await makeZip(
      { "theme/theme/theme1.xml": "<a/>", "_rels/.rels": "<b/>" },
      68164,
    );
    const err = await extractDocxText(notADocx).catch((e) => e);
    expect(isMalformedArchiveError(err)).toBe(true);
    expect((err as MalformedArchiveError).exitCode).toBe(11);
    // No mkdtemp path in the message — it lands on a durable ledger, and a
    // fresh temp dir per run would rewrite that string on every attempt.
    expect(err.message).not.toMatch(/\/(var|tmp)\//);
  });

  it("raises MalformedArchiveError on bytes that are not an archive at all", async () => {
    // A 200 that served an HTML error page under the .docx href.
    const html = Buffer.from("<!DOCTYPE html><html><body>404</body></html>");
    await expect(extractDocxText(html)).rejects.toThrow(MalformedArchiveError);
    // …and on plain garbage, which only unzip can settle (exit 9).
    const junk = Buffer.alloc(4096, 0x7a);
    const err = await extractDocxText(junk).catch((e) => e);
    expect(isMalformedArchiveError(err)).toBe(true);
    expect((err as MalformedArchiveError).exitCode).toBe(9);
  });

  it("gives the ODT reader the same answer — RAZ26 ships both", async () => {
    const doc = Buffer.concat([OLE2_HEADER, Buffer.alloc(1024, 0x20)]);
    await expect(extractOdtText(doc)).rejects.toThrow(MalformedArchiveError);
    const notAnOdt = await makeZip({ "styles.xml": "<a/>" });
    expect(
      isMalformedArchiveError(await extractOdtText(notAnOdt).catch((e) => e)),
    ).toBe(true);
  });

  it("does NOT claim a transport failure is malformed content", async () => {
    // The other half of the discrimination, and the one that costs data if
    // it goes wrong: a timeout classified `content` lets the watermark past
    // a protocol that would have downloaded fine tomorrow.
    expect(isMalformedArchiveError(new Error("socket hang up"))).toBe(false);
    expect(
      isMalformedArchiveError(new Error("https://x/p.docx → HTTP 503")),
    ).toBe(false);
    expect(isMalformedArchiveError(undefined)).toBe(false);
  });
});

/**
 * A REAL Word 97-2003 file, minted by the same binary that reads it back.
 * That is weaker than a fixture captured from a município — it cannot catch
 * textutil disagreeing with Word about a format — but it is the routing
 * that is under test here, and a committed binary fixture for a format we
 * can generate on demand is a worse trade.
 *
 * Returns null when textutil is absent (i.e. not macOS), so the suite skips
 * rather than fails on a Linux checkout.
 */
const makeDoc = async (text: string): Promise<Buffer | null> => {
  const dir = await mkdtemp(join(tmpdir(), "doc-test-"));
  try {
    await writeFile(join(dir, "in.txt"), text, "utf8");
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        "textutil",
        ["-convert", "doc", "-output", "out.doc", "in.txt"],
        { cwd: dir, stdio: "ignore" },
      );
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
    return ok ? await readFile(join(dir, "out.doc")) : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const hasTextutil = await makeDoc("x").then((b) => b !== null);

describe("extractWordText", () => {
  it("reads OOXML through the zip reader", async () => {
    const docx = await docxWith(
      "<w:p><w:r><w:t>решение № 802</w:t></w:r></w:p>",
    );
    expect(await extractWordText(docx)).toContain("решение № 802");
  });

  it.skipIf(!hasTextutil)(
    "reads a legacy .doc through textutil — the PER32 protokol №13 case",
    async () => {
      // The line that matters downstream is the chair's tally announcement,
      // so the fixture is one: PER32's own marker + tally must survive the
      // conversion, or wiring the format in buys nothing.
      const doc = await makeDoc(
        "Общинският съвет гласува и със „за“–30, „против“–0, " +
          "„въздържали се“–0:\nприе\nРЕШЕНИЕ №  802\n",
      );
      const text = await extractWordText(doc!);
      expect(text).toContain("РЕШЕНИЕ");
      expect(/Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е\s*№\s*(\d{1,5})/u.exec(text)?.[1]).toBe(
        "802",
      );
      expect(text).toContain("„за“–30");
    },
  );

  it.skipIf(!hasTextutil)(
    "routes on the signature, not on any extension the caller believes",
    async () => {
      // Both directions of the mislabelling. Перник serves OLE2 under a
      // `.doc` href its parser matched with `/\.docx?$/`; Word's "save as"
      // produces the mirror image often enough to be worth covering.
      const doc = await makeDoc("едно");
      expect(await extractWordText(doc!)).toContain("едно");
      const docx = await docxWith("<w:p><w:r><w:t>две</w:t></w:r></w:p>");
      expect(await extractWordText(docx)).toContain("две");
    },
  );

  it("still refuses what is neither, with the diagnosis", async () => {
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4"),
      Buffer.alloc(512, 0x20),
    ]);
    await expect(extractWordText(pdf)).rejects.toThrow(MalformedArchiveError);
    await expect(extractWordText(pdf)).rejects.toThrow(/is a PDF/);
  });

  it("keeps the zip readers closed to OLE2 — the router is the only door", async () => {
    // extractDocxText must NOT quietly gain a textutil fallback: a function
    // named for one format that shells out to another is how a caller stops
    // being able to reason about what it invoked.
    const doc = await makeDoc("едно");
    if (!doc) return;
    await expect(extractDocxText(doc)).rejects.toThrow(MalformedArchiveError);
  });
});
