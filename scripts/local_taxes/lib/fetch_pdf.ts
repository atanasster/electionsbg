// Fetch a PDF naredba into raw_data/local_taxes/naredba/{slug}.pdf,
// extract its text via the shared pdftotext wrapper, and return both
// the text and a SHA-256 fingerprint of the source bytes.
//
// The fingerprint is what the watch source compares — if the upstream
// PDF byte-for-byte matches the cached copy, no re-parse is needed.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  extractPdfText,
  looksLikeScannedPdf,
} from "../../council/lib/pdf_text";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);
export const NAREDBA_RAW_DIR = path.join(
  PROJECT_ROOT,
  "raw_data/local_taxes/naredba",
);

const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export type FetchPdfResult = {
  text: string;
  hash: string;
  byteLength: number;
  scanned: boolean;
  cachePath: string;
};

/** Download (or re-use the cached) PDF for one município's naredba.
 *  When `force` is set, the cache is bypassed. */
export const fetchNaredbaPdf = async (
  url: string,
  slug: string,
  opts: { force?: boolean } = {},
): Promise<FetchPdfResult> => {
  fs.mkdirSync(NAREDBA_RAW_DIR, { recursive: true });
  const cachePath = path.join(NAREDBA_RAW_DIR, `${slug}.pdf`);

  let bytes: Buffer;
  if (!opts.force && fs.existsSync(cachePath)) {
    bytes = fs.readFileSync(cachePath);
  } else {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; electionsbg-localtaxes/1.0; +https://electionsbg.com)",
        Accept: "application/pdf, */*;q=0.5",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachePath, buf);
    bytes = buf;
  }

  const text = await extractPdfText(bytes);
  return {
    text,
    hash: sha256Hex(bytes),
    byteLength: bytes.length,
    scanned: looksLikeScannedPdf(text),
    cachePath,
  };
};
