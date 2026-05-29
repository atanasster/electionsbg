// Text fetcher for the `*.obshtini.bg` Angular SPA platform.
//
// The user-facing URL `https://{slug}.obshtini.bg/doc/{docId}` returns a
// 968-byte HTML shell that hydrates an Angular app; the app pulls the
// actual document body from `https://web-api.apis.bg/api/obshtina-{slug}/`.
// We bypass the SPA entirely by calling the JSON endpoint directly — no
// Playwright session required.
//
// Endpoint shape (verified for Sofia + Plovdiv, both run on this platform):
//   GET /api/obshtina-{slug}/DocTextJson/?uniqueId={docId}&dbIndex=0&searchText=null
//   → { paragraphs: [{ pId, type, fieldType, text /* HTML */ }, ...] }
//
// We concatenate the paragraph HTML, strip tags + entities, and return
// the plain text plus a SHA-256 fingerprint of the JSON bytes (the
// fingerprint is what the watch source compares to detect upstream
// changes).
//
// Why this exists: Sofia's TAX naredba (НОРМД, carrying property tax on
// individuals + tourist + dog tax) and Plovdiv's FEES naredba are both
// only published on this platform; the standard fetch-PDF path can't
// reach them.

import { createHash } from "node:crypto";
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

type ObshtiniParagraph = { text: string };
type ObshtiniDocTextJson = { paragraphs: ObshtiniParagraph[] };

const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    );

const stripHtmlTags = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n");

export type ObshtiniFetchResult = {
  text: string;
  hash: string;
  byteLength: number;
  cachePath: string;
};

/** Fetch and parse one document from the *.obshtini.bg platform.
 *  `slug` is the município slug (e.g. "sofia", "plovdiv"); `docId` is
 *  the numeric path segment after /doc/ in the user-facing URL. */
export const fetchObshtiniBgDocText = async (
  slug: string,
  docId: number,
  cacheSlug: string,
  opts: { force?: boolean } = {},
): Promise<ObshtiniFetchResult> => {
  fs.mkdirSync(NAREDBA_RAW_DIR, { recursive: true });
  const cachePath = path.join(NAREDBA_RAW_DIR, `${cacheSlug}.json`);

  let bytes: Buffer;
  if (!opts.force && fs.existsSync(cachePath)) {
    bytes = fs.readFileSync(cachePath);
  } else {
    const apiUrl =
      `https://web-api.apis.bg/api/obshtina-${slug}/DocTextJson/` +
      `?uniqueId=${docId}&dbIndex=0&searchText=null`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: `https://${slug}.obshtini.bg/doc/${docId}`,
      },
    });
    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} fetching obshtini.bg doc ${slug}/${docId}`,
      );
    }
    bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachePath, bytes);
  }

  const json = JSON.parse(bytes.toString("utf-8")) as ObshtiniDocTextJson;
  if (!Array.isArray(json.paragraphs)) {
    throw new Error(
      `unexpected DocTextJson shape from ${slug}/${docId} — missing paragraphs[]`,
    );
  }
  const text = json.paragraphs
    .map((p) => stripHtmlTags(decodeHtmlEntities(p.text ?? "")))
    .join("\n");

  return {
    text,
    hash: sha256Hex(bytes),
    byteLength: bytes.length,
    cachePath,
  };
};
