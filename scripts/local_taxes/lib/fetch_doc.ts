// Fetch a legacy binary .doc naredba and convert it to plain text via
// macOS's built-in `textutil`. Mirrors lib/fetch_pdf.ts: caches the raw
// .doc bytes under raw_data/local_taxes/naredba/{slug}.doc, returns
// `text` + a SHA-256 fingerprint of the source bytes for the watch
// source's fingerprint logic.
//
// textutil ships with every macOS (path /usr/bin/textutil). On Linux
// we'd swap in antiword (apt-get install antiword) — single binary,
// same input/output contract.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);
const NAREDBA_RAW_DIR = path.join(PROJECT_ROOT, "raw_data/local_taxes/naredba");

const UA =
  "Mozilla/5.0 (compatible; electionsbg-localtaxes/1.0; +https://electionsbg.com)";

const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export type FetchDocResult = {
  text: string;
  hash: string;
  byteLength: number;
  cachePath: string;
};

/** Download (or re-use the cached) .doc for one município's naredba.
 *  Converts to plain text via `textutil -convert txt`. */
export const fetchNaredbaDoc = async (
  url: string,
  slug: string,
  opts: { force?: boolean } = {},
): Promise<FetchDocResult> => {
  fs.mkdirSync(NAREDBA_RAW_DIR, { recursive: true });
  const docPath = path.join(NAREDBA_RAW_DIR, `${slug}.doc`);
  const txtPath = path.join(NAREDBA_RAW_DIR, `${slug}.txt`);

  let bytes: Buffer;
  if (!opts.force && fs.existsSync(docPath)) {
    bytes = fs.readFileSync(docPath);
  } else {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/msword, */*;q=0.5" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(docPath, bytes);
  }

  // textutil converts in-place: it writes the output next to the input
  // (or to -output). Use a stable txt path under the cache dir.
  execFileSync("/usr/bin/textutil", [
    "-convert",
    "txt",
    docPath,
    "-output",
    txtPath,
  ]);
  const text = fs.readFileSync(txtPath, "utf-8");

  return {
    text,
    hash: sha256Hex(bytes),
    byteLength: bytes.length,
    cachePath: docPath,
  };
};
