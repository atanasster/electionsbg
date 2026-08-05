// Office zip-container text extraction without npm deps — OOXML (.docx) and
// ODF (.odt). Both are zips: the DOCX body lives in `word/document.xml` as
// <w:t> nodes, the ODT body in a root `content.xml` as <text:p> nodes. We
// shell out to `unzip -p` for the XML stream and strip the markup. This is
// good enough for tally regex (we don't need styling or paragraphs to remain
// attached to their numbered list parents).

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runUnzip = (
  args: string[],
): Promise<{ stdout: Buffer; stderr: string; code: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn("unzip", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("unzip not found on PATH"));
      } else reject(err);
    });
    child.on("close", (code: number | null) =>
      resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 0 }),
    );
  });

/**
 * Pull text from a .docx buffer. Strips <w:tab/> as spaces, <w:br/> /
 * paragraph breaks as newlines, and replaces XML entities. NOT a full
 * Word renderer — sufficient for tally regex which only needs the
 * sequence of tokens to survive.
 */
export const extractDocxText = async (docxBuffer: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "council-docx-"));
  const docxPath = join(dir, "in.docx");
  try {
    await writeFile(docxPath, docxBuffer);
    const { stdout, stderr, code } = await runUnzip([
      "-p",
      docxPath,
      "word/document.xml",
    ]);
    if (code !== 0) {
      throw new Error(
        `unzip -p ${docxPath} word/document.xml exited ${code}: ${stderr.slice(0, 300)}`,
      );
    }
    const xml = stdout.toString("utf8");

    // Insert a newline marker for paragraph + line breaks so multi-line
    // matches (named-vote list etc) don't end up smushed onto one line.
    const withBreaks = xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n");

    // Strip everything else (xml tags). Then unescape standard entities.
    const stripped = withBreaks
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_: string, n: string) =>
        String.fromCharCode(parseInt(n, 10)),
      );

    return stripped;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** Shared XML-entity unescape, applied after tags are stripped. */
const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_: string, n: string) =>
      String.fromCharCode(parseInt(n, 10)),
    )
    // &amp; LAST, so "&amp;lt;" doesn't become "<".
    .replace(/&amp;/g, "&");

/**
 * Pull text from a .odt buffer (OpenDocument Text).
 *
 * `unzip -p in.odt content.xml` matches the ROOT entry exactly, not the
 * `Object N/content.xml` entries that embedded OLE objects add — which is what
 * we want: the root one is the body, the others are embedded tables/charts.
 *
 * ODF compresses runs of spaces into <text:s/> ELEMENTS rather than literal
 * whitespace, so those must become spaces BEFORE tags are stripped. Dropping
 * them silently welds tokens together ("Р Е Ш Е Н И Е№295" instead of
 * "… Е № 295"), which is exactly the kind of damage a tally/marker regex then
 * fails on for reasons that look like upstream formatting.
 */
export const extractOdtText = async (odtBuffer: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "council-odt-"));
  const odtPath = join(dir, "in.odt");
  try {
    await writeFile(odtPath, odtBuffer);
    const { stdout, stderr, code } = await runUnzip([
      "-p",
      odtPath,
      "content.xml",
    ]);
    if (code !== 0) {
      throw new Error(
        `unzip -p ${odtPath} content.xml exited ${code}: ${stderr.slice(0, 300)}`,
      );
    }
    const xml = stdout.toString("utf8");

    const withBreaks = xml
      // <text:s/> = one space; <text:s text:c="N"/> = N spaces.
      .replace(/<text:s\s+text:c="(\d+)"\s*\/>/g, (_: string, n: string) =>
        " ".repeat(Math.min(parseInt(n, 10), 200)),
      )
      .replace(/<text:s\s*\/>/g, " ")
      .replace(/<text:tab\s*\/>/g, "\t")
      .replace(/<text:line-break\s*\/>/g, "\n")
      // Paragraphs and headings both end a line.
      .replace(/<\/text:(p|h)>/g, "\n");

    return unescapeXml(withBreaks.replace(/<[^>]+>/g, ""));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
