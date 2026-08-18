// Office document text extraction without npm deps, in three formats.
//
// OOXML (.docx) and ODF (.odt) are zips: the DOCX body lives in
// `word/document.xml` as <w:t> nodes, the ODT body in a root `content.xml`
// as <text:p> nodes. We shell out to `unzip -p` for the XML stream and strip
// the markup. This is good enough for tally regex (we don't need styling or
// paragraphs to remain attached to their numbered list parents).
//
// Word 97-2003 (.doc) is none of those — an OLE2 compound file, which no
// amount of unzipping reaches. That goes through macOS `textutil`.
//
// `extractWordText` is the entry point a parser should use, and it picks by
// MAGIC BYTES rather than by the href's extension. That is the whole lesson
// of the PER32 defect: обс-Перник links протокол №13 as `.doc` and the
// parser matched it with `/\.docx?$/`, so a legacy binary went to the OOXML
// reader. The extension is a claim by the município's CMS; the first eight
// bytes are the document itself. Routing on the latter also fixes the
// mirror-image case — Word "save as" leaves plenty of OLE2 files named
// `.docx` — and neither costs a read we were not already doing.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
 * The bytes are in hand and are not a readable office container: a legacy
 * OLE2 `.doc` served under a `.docx` href, a PDF or an HTML error page with
 * the wrong extension, a truncated upload, a zip missing the one member the
 * body lives in.
 *
 * Distinct from a transport failure ON PURPOSE, and the distinction is what
 * the watermark rests on. Re-fetching the same URL yields the same bytes and
 * the same failure, so this is `kind: "content"` at every call site —
 * deferred-ledger, watermark allowed past — while a timeout or a 5xx is
 * `kind: "fetch"`, which caps the watermark below that protocol so the next
 * run retries it. Classified as `fetch`, one permanently broken document
 * pins a município's `sinceDate` until the attempts valve gives up five runs
 * later, and every run in between re-writes its whole window unchanged.
 * Перник sat at 2025-10-16 re-writing 271 resolutions a run for exactly this
 * reason (protokol №13, whose href serves a Word 97-2003 .doc).
 */
export class MalformedArchiveError extends Error {
  override readonly name = "MalformedArchiveError";
  constructor(
    message: string,
    /** unzip's exit status, absent when the magic bytes settled it first. */
    readonly exitCode?: number,
  ) {
    super(message);
  }
}

/**
 * Cross-realm-safe check — vitest can load this module twice, and an
 * `instanceof` that quietly returns false would send the caller back to
 * `fetch` with nothing red.
 */
export const isMalformedArchiveError = (
  err: unknown,
): err is MalformedArchiveError =>
  err instanceof MalformedArchiveError ||
  (err instanceof Error && err.name === "MalformedArchiveError");

/**
 * unzip exit statuses that mean "this is not a readable archive": 2/3 are
 * zipfile-format errors, 9 is "no zipfiles found" (not a zip at all), 11 is
 * "no matching files" (a zip, but without the member the body lives in).
 *
 * Everything else — the 4-8 memory failures, a missing binary — is left to
 * the generic Error, i.e. retryable, which is the safe direction: a
 * misclassified-as-content protocol is dropped from the ingest for good,
 * while a misclassified-as-fetch one only costs the attempts valve.
 */
const MALFORMED_EXIT_CODES = new Set([2, 3, 9, 11]);

/**
 * Formats we have actually been served under a `.doc(x)`/`.odt` href, each
 * identified by its own magic bytes. unzip would reject all of them anyway,
 * but it reports them as `exited 9` (or, when Word embedded a themeData zip
 * inside the OLE2 stream — the Перник case — the far more confusing
 * `exited 11: caution: filename not matched`). The ledger keeps this string
 * until an operator reads it, so it is worth it being the diagnosis rather
 * than a dump of unzip's stderr.
 *
 * OLE2 stays on this list even though `extractWordText` now READS that
 * format: this is what the zip readers may not be handed, and one of them
 * being handed an OLE2 file is precisely the bug. A parser reaches the
 * reader through the router, or it gets the diagnosis.
 */
/**
 * The OLE2 signature — the one byte-level fact this module routes on, so it
 * is written once and read by both the rejection list below and the router
 * at the foot of the file. Two copies is how the two stop agreeing.
 */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const looksLikeOle2 = (buf: Buffer): boolean =>
  buf.length >= OLE2_MAGIC.length && OLE2_MAGIC.every((b, i) => buf[i] === b);

const MAGIC: Array<{ bytes: number[]; what: string }> = [
  {
    bytes: OLE2_MAGIC,
    what: "a legacy Word 97-2003 .doc (OLE2 compound file)",
  },
  { bytes: [0x25, 0x50, 0x44, 0x46], what: "a PDF" },
  {
    bytes: [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45],
    what: "an HTML page",
  },
  { bytes: [0x3c, 0x68, 0x74, 0x6d, 0x6c], what: "an HTML page" },
];

const sniff = (buf: Buffer): string | null => {
  for (const { bytes, what } of MAGIC) {
    if (buf.length < bytes.length) continue;
    if (bytes.every((b, i) => buf[i] === b)) return what;
  }
  return null;
};

/**
 * Read one member out of an office zip container as UTF-8, or throw.
 *
 * Shared by both extractors so the classification is decided once: a parser
 * asks `isMalformedArchiveError(err)` and gets the same answer whether the
 * município ships OOXML or ODF.
 */
const readZipMember = async (
  buffer: Buffer,
  member: string,
  ext: "docx" | "odt",
): Promise<string> => {
  const served = sniff(buffer);
  if (served) {
    throw new MalformedArchiveError(
      `not a .${ext}: the ${buffer.length}-byte body is ${served}, ` +
        `so the href serves a different format than its extension claims`,
    );
  }
  const dir = await mkdtemp(join(tmpdir(), `council-${ext}-`));
  const path = join(dir, `in.${ext}`);
  try {
    await writeFile(path, buffer);
    const { stdout, stderr, code } = await runUnzip(["-p", path, member]);
    if (code !== 0) {
      // The temp path is a fresh mkdtemp every run, and unzip echoes it back
      // inside its own warnings — so it is scrubbed from BOTH halves. This
      // string is stored on the deferred ledger, where a value that differs
      // on every attempt makes two identical failures look like two
      // different ones.
      const detail =
        `unzip -p in.${ext} ${member} exited ${code}: ` +
        stderr.split(path).join(`in.${ext}`).slice(0, 300).trim();
      if (MALFORMED_EXIT_CODES.has(code)) {
        throw new MalformedArchiveError(detail, code);
      }
      throw new Error(detail);
    }
    return stdout.toString("utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Pull text from a .docx buffer. Strips <w:tab/> as spaces, <w:br/> /
 * paragraph breaks as newlines, and replaces XML entities. NOT a full
 * Word renderer — sufficient for tally regex which only needs the
 * sequence of tokens to survive.
 */
export const extractDocxText = async (docxBuffer: Buffer): Promise<string> => {
  const xml = await readZipMember(docxBuffer, "word/document.xml", "docx");

  // Insert a newline marker for paragraph + line breaks so multi-line
  // matches (named-vote list etc) don't end up smushed onto one line.
  const withBreaks = xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");

  // Strip everything else (xml tags). Then unescape standard entities.
  return withBreaks
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_: string, n: string) =>
      String.fromCharCode(parseInt(n, 10)),
    );
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
  const xml = await readZipMember(odtBuffer, "content.xml", "odt");

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
};

/**
 * Word 97-2003 (.doc) → UTF-8 text via macOS `textutil`.
 *
 * Lifted out of the Dimitrovgrad parser, which had the only copy, once
 * Перник turned out to need it too. Six municipalities link `.doc` and
 * `.docx` from the same index and several have migrated between them
 * mid-mandate, so this belongs beside the readers it is chosen against.
 *
 * A MISSING textutil throws a plain Error, deliberately — not a
 * MalformedArchiveError. The bytes are fine and would convert on a machine
 * that has the binary, so it is a `fetch` failure: the watermark holds, the
 * attempts valve gives up after five runs, and the message says which
 * binary. Calling it `content` would let the watermark past a protocol we
 * could read tomorrow, which is the one direction that loses data.
 */
export const convertDocToText = async (docBuffer: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "council-doc-"));
  const docPath = join(dir, "in.doc");
  const txtPath = join(dir, "in.txt");
  try {
    await writeFile(docPath, docBuffer);
    const { code, stderr } = await new Promise<{
      code: number;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        "textutil",
        ["-convert", "txt", "-encoding", "UTF-8", "-output", txtPath, docPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let errBuf = "";
      child.stderr.on("data", (b: Buffer) => (errBuf += b.toString("utf8")));
      child.on("error", (err: Error) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              "textutil not found on PATH — legacy .doc protokols need " +
                "macOS textutil (run the council scrape on macOS).",
            ),
          );
        } else reject(err);
      });
      child.on("close", (c: number | null) =>
        resolve({ code: c ?? 0, stderr: errBuf }),
      );
    });
    if (code !== 0) {
      // textutil rejecting a file it was correctly handed means the bytes
      // are not a readable document — same class as an unreadable archive,
      // and same answer: do not hold the watermark for it.
      throw new MalformedArchiveError(
        `textutil exited ${code}: ${stderr.split(dir).join("").slice(0, 200).trim()}`,
        code,
      );
    }
    return await readFile(txtPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Read a Word protokol — OOXML or legacy binary — deciding from the bytes.
 *
 * This is what a parser should call. Branching on the href's extension is
 * what put an OLE2 file through the OOXML reader for a month; the two
 * signatures are eight bytes apart and never ambiguous, so there is nothing
 * for a caller to get wrong. Anything that is neither raises
 * MalformedArchiveError with its own diagnosis (a PDF, an HTML error page
 * served at 200, a truncated upload).
 *
 * ODF is NOT routed here. Разград is the only município that ships it, it
 * knows which of its own files are `.odt`, and an ODF zip reaching this
 * function fails as "no word/document.xml" — true, and the honest answer.
 */
export const extractWordText = async (buffer: Buffer): Promise<string> =>
  looksLikeOle2(buffer)
    ? await convertDocToText(buffer)
    : await extractDocxText(buffer);
