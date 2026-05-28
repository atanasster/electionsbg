// Fetch a DOCX naredba into raw_data/local_taxes/naredba/{slug}.docx,
// extract its text via the shared council DOCX helper, and return both
// the text and a SHA-256 fingerprint of the source bytes.
//
// Used for municípios that publish the naredba as a Word document on
// their own portal (Burgas: burgascouncil.org/sites/default/files/...).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractDocxText } from "../../council/lib/docx";
import { NAREDBA_RAW_DIR } from "./fetch_pdf";

const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export type FetchDocxResult = {
  text: string;
  hash: string;
  byteLength: number;
  cachePath: string;
};

export const fetchNaredbaDocx = async (
  url: string,
  slug: string,
  opts: { force?: boolean } = {},
): Promise<FetchDocxResult> => {
  fs.mkdirSync(NAREDBA_RAW_DIR, { recursive: true });
  const cachePath = path.join(NAREDBA_RAW_DIR, `${slug}.docx`);

  let bytes: Buffer;
  if (!opts.force && fs.existsSync(cachePath)) {
    bytes = fs.readFileSync(cachePath);
  } else {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; electionsbg-localtaxes/1.0; +https://electionsbg.com)",
        Accept:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/octet-stream, */*;q=0.5",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachePath, buf);
    bytes = buf;
  }

  const text = await extractDocxText(bytes);
  return {
    text,
    hash: sha256Hex(bytes),
    byteLength: bytes.length,
    cachePath,
  };
};
