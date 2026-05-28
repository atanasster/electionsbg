// Velико Търново (VTR01) — full-protocol PDF parser.
//
// Source surface:
//   - Year index:  /bg/protokoli/protokoli-ot-zasedaniya-{YYYY}-godina
//   - Protocol PDF: /uploads/posts/{YYYY}/{YYYY_MM_DD}_pr_{N}.pdf
//   - Resolution extracts: /uploads/posts/{YYYY}/{YYYY_MM_DD}_{resolutionId}.pdf
//   - Year-grouped decision titles: /bg/resheniya-{YYYY}-godina/...
//
// We pull the full protocol PDF (rich: per-councillor named-vote list +
// aggregate summary line per vote) rather than the per-resolution extract
// PDFs (which omit the tally). Aggregate tally extraction in Phase 1; the
// per-councillor block is fed forward to Phase 2 unchanged.
//
// Pairing: a protocol contains many resolutions. We anchor on each
// `РЕШЕНИЕ № N` marker and pair it with the IMMEDIATELY PRECEDING
// aggregate summary line ("беше прието с N „за"..."), since the voting
// happens BEFORE the resolution text is recorded.

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import {
  classifyResult,
  findAllTallies,
  findResolutionMarkers,
} from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "VTR01";
const BASE = "https://savet.veliko-tarnovo.bg/";

/** Year-index URLs we sweep when sinceYear is set. */
const yearIndexUrl = (year: number) =>
  `${BASE}bg/protokoli/protokoli-ot-zasedaniya-${year}-godina`;

/** Parse one year-index page into a list of (date, protocolNumber, pdfUrl). */
const discoverProtocols = async (
  year: number,
): Promise<Array<{ date: string; session: string; pdfUrl: string }>> => {
  let html: string;
  try {
    html = await fetchHtml(yearIndexUrl(year));
  } catch (err) {
    // 404 on a future year is fine — return empty.
    if (err instanceof Error && /HTTP 404/.test(err.message)) return [];
    throw err;
  }
  const $ = cheerio.load(html);
  const out: Array<{ date: string; session: string; pdfUrl: string }> = [];
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    // Match the full-protocol pattern only: {YYYY}_{MM}_{DD}_pr_{N}.pdf.
    // The same uploads dir also has *_protokoli.pdf (committee bundles)
    // and *_protokoli-pk.pdf (постоянни комисии); skip those — they
    // collide on dates and don't contain the named-vote blocks.
    const m = href.match(
      /uploads\/posts\/(\d{4})\/(\d{4})_(\d{2})_(\d{2})_pr_(\d+)\.pdf/,
    );
    if (!m) return;
    const yyyy = m[2];
    const mm = m[3];
    const dd = m[4];
    const sess = m[5];
    // hrefs like "uploads/posts/2025/2025_02_06_pr_20.pdf" are emitted
    // by the council CMS as site-root-relative even though there's no
    // leading slash. Resolve against BASE explicitly — using the year
    // index URL as the base mangles it to /bg/protokoli/uploads/...
    out.push({
      date: `${yyyy}-${mm}-${dd}`,
      session: sess,
      pdfUrl: resolveUrl(href.replace(/^\/+/, ""), BASE),
    });
  });
  // Dedupe by pdfUrl (same protocol can appear multiple times on the page).
  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p.pdfUrl)) return false;
    seen.add(p.pdfUrl);
    return true;
  });
};

/** Build council resolutions from one protocol PDF's text. */
const parseProtocolText = (
  text: string,
  meta: { date: string; session: string; pdfUrl: string },
): CouncilResolution[] => {
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);
  for (const marker of markers) {
    // Find the latest tally whose offset precedes this resolution marker.
    let best: (typeof tallies)[number] | undefined;
    for (const t of tallies) {
      if (t.offset < marker.offset) best = t;
      else break;
    }
    const tally = best?.tally;
    const result = best ? classifyResult(text, best.offset) : "unknown";
    const id = `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`;
    out.push({
      id,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title: marker.title || "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.pdfUrl,
    });
  }
  return out;
};

export const scrapeVTR = async (
  _recipe: MuniRecipe,
  opts: { sinceYear?: number; sinceDate?: string; maxProtocols?: number },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;

  // Walk year indexes. Default: current + previous year.
  const currentYear = new Date().getUTCFullYear();
  const startYear = opts.sinceYear ?? currentYear - 1;
  const endYear = currentYear;

  let all: Array<{ date: string; session: string; pdfUrl: string }> = [];
  for (let year = startYear; year <= endYear; year++) {
    try {
      const list = await discoverProtocols(year);
      all = all.concat(list);
    } catch (err) {
      errors.push({
        url: yearIndexUrl(year),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (opts.sinceDate) {
    all = all.filter((p) => p.date > opts.sinceDate!);
  }
  // Newest first.
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (opts.maxProtocols) all = all.slice(0, opts.maxProtocols);

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new protocols (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
      errors,
    };
  }

  console.log(`  [${OBSHTINA}] fetching ${all.length} protocol(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-vtr-"));
  try {
    for (const p of all) {
      const pdfPath = join(dir, `pr_${p.session}.pdf`);
      try {
        await fetchToFile(p.pdfUrl, pdfPath);
        const buf = await readFile(pdfPath);
        const text = await extractPdfText(buf);
        if (looksLikeScannedPdf(text)) {
          errors.push({
            url: p.pdfUrl,
            message: "looks like a scanned PDF — skipped (route to Phase 3)",
          });
          continue;
        }
        const recs = parseProtocolText(text, p);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${p.session} (${p.date}): ${recs.length} resolution(s)`,
        );
      } catch (err) {
        errors.push({
          url: p.pdfUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
