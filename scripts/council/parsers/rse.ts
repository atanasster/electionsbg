// Русе (RSE01) — full-protocol DOCX parser.
//
// Source surface:
//   - Document archive: /document-category/протоколи/ (WordPress)
//   - File pattern:     /wp-content/uploads/{YYYY}/{MM}/<filename>.docx
//     where <filename> varies wildly:
//       протокол-33.docx
//       ПРОТОКОЛ_32.docx
//       Протокол-31-обс-Русе.docx
//       29-1.docx           (just the protocol number)
//       протокол_25-_29.09.2025.docx
//   - Occasional PDF variants exist for older protocols.
//
// We extract DOCX text via `lib/docx.ts` (unzip + word/document.xml strip),
// then reuse `lib/tally.ts`'s digit-first regex which already matches
// the Ruse phrasing:
//   "КВОРУМ – 47. С 46 „за", 0 „против" и 1 „въздържал се" се приема..."
//
// Pairing: a protocol contains many resolutions. We anchor on each
// "РЕШЕНИЕ № N" marker and pair it with the IMMEDIATELY PRECEDING
// aggregate summary line.
//
// Per-councillor data: Ruse protocols DO list named votes for some motions
// (chl. 27, al. 5 ZMSMA mandates it for property/budget items), but they
// are embedded as freeform prose ("Г-н Иванов: За") rather than the
// numbered list V. Tarnovo uses, so the existing extractNamedVoteBlock
// won't match. Defer per-councillor for RSE to a future pass.

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractDocxText } from "../lib/docx";
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

const OBSHTINA = "RSE01";
const BASE = "https://obs.ruse-bg.eu/";
const INDEX_URL = `${BASE}document-category/протоколи/`;

type ProtocolRef = {
  url: string;
  filename: string;
  /** Year inferred from the upload-path year segment. */
  year: number;
  /** Best-effort protocol number from the filename — may be null. */
  session: string | null;
};

// /wp-content/uploads/{YYYY}/{MM}/<filename>.{docx,doc,pdf}
const UPLOAD_PATH_RE =
  /\/wp-content\/uploads\/(\d{4})\/(\d{2})\/([^"]+\.(?:docx?|pdf))/u;

// Tease the protocol number out of the filename. Tolerate:
//   протокол-33, ПРОТОКОЛ_32, Протокол-31-обс-Русе, 29-1, протокол_25-_29.09.2025
const SESSION_FROM_FILENAME_RE = /(?:протокол[-_]?)?(\d{1,3})/iu;

const discoverProtocols = async (): Promise<ProtocolRef[]> => {
  const html = await fetchHtml(INDEX_URL);
  const $ = cheerio.load(html);
  const out: ProtocolRef[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(UPLOAD_PATH_RE);
    if (!m) return;
    const url = href.startsWith("http") ? href : resolveUrl(href, BASE);
    if (seen.has(url)) return;
    seen.add(url);
    const filename = decodeURIComponent(m[3]);
    // Skip извлечение- bundles (commission excerpts) and known non-protocol files.
    if (/извлечение|^pk-/i.test(filename)) return;
    const sm = filename.match(SESSION_FROM_FILENAME_RE);
    out.push({
      url,
      filename,
      year: parseInt(m[1], 10),
      session: sm ? sm[1] : null,
    });
  });
  return out;
};

const parseProtocolText = (
  text: string,
  meta: { url: string; year: number; session: string | null },
): CouncilResolution[] => {
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  const out: CouncilResolution[] = [];
  for (const marker of markers) {
    let best: (typeof tallies)[number] | undefined;
    for (const t of tallies) {
      if (t.offset < marker.offset) best = t;
      else break;
    }
    const tally = best?.tally;
    const result = best ? classifyResult(text, best.offset) : "unknown";
    const session = meta.session ?? "?";
    const yearStr = String(meta.year);
    out.push({
      id: `${OBSHTINA}-${yearStr}-prot${session}-r${marker.number}`,
      // Ruse archive doesn't expose the sitting date in a parseable place;
      // fall back to year + protocol number. Per-session date extraction
      // from the DOCX text is a follow-up.
      date: `${yearStr}-01-01`,
      session,
      number: marker.number,
      title: marker.title || "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.url,
    });
  }
  return out;
};

/**
 * Pull the actual sitting date out of the protocol text — the first line
 * usually carries it ("Проведено на 30 април 2026 година"). Returns YYYY-
 * MM-DD or null. Bulgarian month names; we map them inline rather than
 * pulling a library.
 */
const BG_MONTHS: Record<string, string> = {
  януари: "01",
  февруари: "02",
  март: "03",
  април: "04",
  май: "05",
  юни: "06",
  юли: "07",
  август: "08",
  септември: "09",
  октомври: "10",
  ноември: "11",
  декември: "12",
};
const extractSittingDate = (text: string): string | null => {
  const m = text.match(
    /(?:Проведено\s+на\s+)?(\d{1,2})\s+([а-я]+)\s+(\d{4})\s*(?:година|г\.?)/iu,
  );
  if (!m) return null;
  const monthKey = m[2].toLowerCase();
  const mm = BG_MONTHS[monthKey];
  if (!mm) return null;
  const dd = m[1].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
};

export const scrapeRSE = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;

  let refs: ProtocolRef[];
  try {
    refs = await discoverProtocols();
  } catch (err) {
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched: 0,
      errors: [
        {
          url: INDEX_URL,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  if (opts.sinceYear) refs = refs.filter((r) => r.year >= opts.sinceYear!);
  // Newest first.
  refs.sort((a, b) => b.year - a.year);
  if (opts.maxProtocols) refs = refs.slice(0, opts.maxProtocols);

  if (refs.length === 0) {
    console.log(`  [${OBSHTINA}] no new protocols`);
    return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
  }

  console.log(`  [${OBSHTINA}] fetching ${refs.length} protocol(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-rse-"));
  try {
    for (const ref of refs) {
      const localPath = join(dir, ref.filename.replace(/[^a-z0-9_.-]/gi, "_"));
      try {
        await fetchToFile(ref.url, localPath);
        const buf = await readFile(localPath);
        if (/\.pdf$/i.test(ref.filename)) {
          // Older protocols ship as PDF — skip for the DOCX-only parser,
          // surface as a soft error so the operator can wire it later.
          errors.push({
            url: ref.url,
            message: "PDF variant skipped (use --include-pdf when supported)",
          });
          continue;
        }
        if (!/\.docx?$/i.test(ref.filename)) continue;
        const text = await extractDocxText(buf);
        const sittingDate = extractSittingDate(text);
        const dateFiltered =
          opts.sinceDate && sittingDate && sittingDate <= opts.sinceDate;
        if (dateFiltered) continue;
        const recs = parseProtocolText(text, {
          url: ref.url,
          year: ref.year,
          session: ref.session,
        });
        // Backfill the parsed sitting date into every record if found.
        if (sittingDate) for (const r of recs) r.date = sittingDate;
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${ref.session ?? "?"} (${sittingDate ?? `${ref.year}-?`}): ${recs.length} resolution(s)`,
        );
      } catch (err) {
        errors.push({
          url: ref.url,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
