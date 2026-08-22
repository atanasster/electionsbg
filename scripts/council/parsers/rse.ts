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
import { isMalformedArchiveError, extractWordText } from "../lib/docx";
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

/**
 * Русе's titles come from its контролен-лист lines, not from an "ОТНОСНО:" clause.
 *
 * The protocol never writes ОТНОСНО at all — measured 0 occurrences in ПРОТОКОЛ_32.docx —
 * so `findResolutionMarkers`' own title, which reads only that clause, was empty for all
 * 211 stored rows. What the document does carry is one line per item:
 *
 *     Точка 2
 *     К.л 926 Годишен доклад за наблюдение на изпълнението през 2025 г. …
 *     … debate …
 *     РЕШЕНИЕ № 918
 *
 * ⚠️ EACH К.л APPEARS TWICE — once in the agenda list at the top, once in the body above
 * its own decision — which is why "nearest preceding" is the rule and a positional zip is
 * not: 52 К.л lines against 23 resolutions in that protocol. The nearest is always the
 * body occurrence.
 *
 * ⚠️ THE OFFSET BETWEEN THE TWO NUMBERINGS IS NOT CONSTANT. It looks it on the first few
 * pairs (917 ↔ 925, 918 ↔ 926, 919 ↔ 927) and is not: across prot 32 it takes the values
 * 6, 8, 10 and 18, because not every контролен лист reaches a vote. Nothing may derive the
 * pairing from it,
 * which `checkKlPairing` reports instead of letting it publish silently.
 *
 * Subjects are single-line in this layout; nothing wraps.
 */
// ⚠️ THE GAPS ARE HORIZONTAL WHITESPACE ONLY. `\s*` matches a newline, so "К." on one
// line and "л 926 …" on the next fabricates an entry out of two unrelated lines — the same
// trap lib/tally.ts already paid for with its HGAP vs SHORT_WS split.
//
// ⚠️ THE SUBJECT IS UNBOUNDED HERE AND CHECKED AFTERWARDS, deliberately. A `{5,400}` bound
// is greedy and unanchored, so an over-long subject does not fail — it matches its first
// 400 characters and publishes them. That shipped: 8 of 425 stored titles were exactly 400
// chars ending mid-word ("…без режим на з"), and two of them clipped to the SAME string,
// manufacturing a collision between unrelated resolutions. The sibling
// nearestOtnosnoTitle fails closed for this reason and so must this.
const KL_RE =
  /(?:^|\n)[ \t\f]*К[ \t]*\.?[ \t]*л[ \t]*\.?[ \t]*(\d+)[ \t]+([^\n]+)/gu;

/**
 * Longest subject we accept; beyond it the line is something other than a контролен-лист
 * subject. Measured over ПРОТОКОЛ_32: 52 subjects, median 163, p90 338, **max 415** — so a
 * 400 ceiling is BELOW the real maximum and rejected two genuine items, which then widened
 * the gap for the decisions after them. 600 clears the observed maximum with headroom while
 * still refusing a body paragraph.
 */
const KL_TITLE_MAX = 600;

type KlEntry = { offset: number; number: string; title: string };

export const findKlEntries = (text: string): KlEntry[] => {
  const out: KlEntry[] = [];
  const re = new RegExp(KL_RE.source, KL_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[2].replace(/\s+/gu, " ").trim();
    // Fail CLOSED on both ends: too short is not a subject, and too long means the line is
    // something else. Never publish a clipped prefix.
    if (title.length >= 5 && title.length <= KL_TITLE_MAX)
      out.push({ offset: m.index, number: m[1], title });
  }
  return out;
};

/**
 * The last контролен лист before `offset`, or null when there is none within `maxBack`.
 *
 * ⚠️ THE BOUND IS NOT DECORATION. Every decision carries its own К.л line immediately
 * above it, so the nearest one is a few hundred characters away. Unbounded, a decision
 * whose body line is missing — a subject under 5 chars, a "К.Л." spelling, or no line at
 * all — silently borrows whatever came before, and with the agenda list sitting at the top
 * of the document that can be a subject from an entirely different item. 6000 matches the
 * window nearestOtnosnoTitle uses and spans a recorded debate.
 *
 * PRECONDITION: `entries` must be in ascending `offset` order — the early `break` depends
 * on it. `findKlEntries` guarantees that (one `/g/` regex, one exec loop); a second
 * producer must sort.
 */
export const nearestKl = (
  entries: KlEntry[],
  offset: number,
  maxBack = 6000,
): KlEntry | null => {
  let best: KlEntry | null = null;
  for (const e of entries) {
    if (e.offset >= offset) break;
    if (offset - e.offset <= maxBack) best = e;
  }
  return best;
};

/**
 * Report a контролен лист that titles two NON-CONSECUTIVE resolutions.
 *
 * ⚠️ THIS DELIBERATELY DOES NOT CHECK MONOTONICITY, and an earlier cut did. The pairing
 * looked like it carried a constant offset — РЕШЕНИЕ 917 ↔ К.л 925, 918 ↔ 926, 919 ↔ 927
 * — but that was six pairs of a 23-pair protocol. Measured across the whole of prot 32 the
 * offsets are 6, 8, 10 and 18, because not every контролен лист reaches a vote and the two
 * sequences drift apart. Ruse also takes items out of numeric order. A monotonic guard
 * therefore fired on 14 of 18 protocols with nothing wrong.
 *
 * What IS a real signal: one К.л reused for resolutions that are not adjacent. A run of
 * consecutive decisions under one item is ordinary — Перник does the same, and prot 36 has
 * 1046/1047/1048 all under "Отчет за дейността на Общински съвет" — but a gap means the
 * nearest-preceding rule probably reached past a decision whose own К.л line is missing,
 * and attached someone else's subject to it.
 *
 * Measured 2026-08-22: 28 of 425 titled rows share a title, and all but a handful are
 * consecutive runs. Warns rather than throws — the title is a label, and losing a whole
 * sitting over one suspect pair would be the worse trade.
 *
 * ⚠️ TWO BLIND SPOTS, both stated rather than hidden. A borrowed title landing on the very
 * NEXT resolution produces a consecutive pair, which this is defined not to flag; and a
 * К.л titling exactly one resolution never reaches the duplicate branch at all. The
 * `maxBack` bound on nearestKl is what actually limits the damage in both cases.
 */
const checkKlPairing = (
  pairs: { resolution: string; kl: string }[],
  session: string,
): void => {
  const byKl = new Map<string, number[]>();
  for (const p of pairs) {
    const n = Number(p.resolution);
    if (!Number.isFinite(n)) continue;
    if (!byKl.has(p.kl)) byKl.set(p.kl, []);
    byKl.get(p.kl)!.push(n);
  }
  const suspect: string[] = [];
  for (const [kl, nums] of byKl) {
    if (nums.length < 2) continue;
    const sorted = [...nums].sort((a, b) => a - b);
    const gapped = sorted.some((n, i) => i > 0 && n - sorted[i - 1] > 1);
    if (gapped) suspect.push(`К.л ${kl} -> ${sorted.join(", ")}`);
  }
  if (suspect.length > 0) {
    console.warn(
      `  [RSE01] prot ${session}: ${suspect.length} контролен лист(а) title ` +
        `non-consecutive resolutions — the nearest-preceding rule may have reached past a ` +
        `decision whose own К.л line is missing: ${suspect.slice(0, 3).join("; ")}`,
    );
  }
};

const parseProtocolText = (
  text: string,
  meta: { url: string; year: number; session: string | null },
): CouncilResolution[] => {
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  const klEntries = findKlEntries(text);
  const klPairs: { resolution: string; kl: string }[] = [];
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
    const kl = nearestKl(klEntries, marker.offset);
    if (kl) klPairs.push({ resolution: marker.number, kl: kl.number });
    out.push({
      id: `${OBSHTINA}-${yearStr}-prot${session}-r${marker.number}`,
      // Ruse archive doesn't expose the sitting date in a parseable place;
      // fall back to year + protocol number. Per-session date extraction
      // from the DOCX text is a follow-up.
      date: `${yearStr}-01-01`,
      session,
      number: marker.number,
      // ОТНОСНО first, for symmetry with every other parser — but Русе writes none, so
      // in practice this is always the контролен лист. See findKlEntries.
      title: marker.title || kl?.title || "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.url,
    });
  }
  checkKlPairing(klPairs, meta.session ?? "?");
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
  let candidatesDropped = 0;

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
          kind: "discovery",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  if (opts.sinceYear) refs = refs.filter((r) => r.year >= opts.sinceYear!);
  // Newest first.
  refs.sort((a, b) => b.year - a.year);
  // --max truncates the candidate list newest-first, and a dropped
  // candidate raises NO error — so the count has to reach the
  // watermark, or it advances past protocols this run never looked at.
  if (opts.maxProtocols && refs.length > opts.maxProtocols) {
    candidatesDropped = refs.length - opts.maxProtocols;
    refs = refs.slice(0, opts.maxProtocols);
  }

  if (refs.length === 0) {
    console.log(`  [${OBSHTINA}] no new protocols`);
    return {
      obshtinaCode: OBSHTINA,
      resolutions,
      protocolsTouched,
      candidatesDropped,
      errors,
    };
  }

  console.log(`  [${OBSHTINA}] fetching ${refs.length} protocol(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-rse-"));
  try {
    for (const ref of refs) {
      const localPath = join(dir, ref.filename.replace(/[^a-z0-9_.-]/gi, "_"));
      // Ruse's index carries only a year, never a sitting date — that is
      // parsed out of the DOCX body below. Hoisted so a failure AFTER the
      // parse can still be dated; a download failure genuinely cannot be,
      // and then the orchestrator freezes rather than caps.
      let sittingDate: string | undefined;
      try {
        await fetchToFile(ref.url, localPath);
        const buf = await readFile(localPath);
        if (/\.pdf$/i.test(ref.filename)) {
          // Older protocols ship as PDF — skip for the DOCX-only parser,
          // surface as a soft error so the operator can wire it later.
          errors.push({
            url: ref.url,
            kind: "content",
            message: "PDF variant skipped (use --include-pdf when supported)",
          });
          continue;
        }
        // `.docx?` — Ruse's archive holds both, and extractWordText picks
        // the reader from the bytes rather than from this extension.
        if (!/\.docx?$/i.test(ref.filename)) continue;
        const text = await extractWordText(buf);
        sittingDate = extractSittingDate(text) ?? undefined;
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
          // undefined only when the document never parsed far enough.
          date: sittingDate,
          // An unreadable container is `content`: same bytes next run.
          kind: isMalformedArchiveError(err) ? "content" : "fetch",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return {
    obshtinaCode: OBSHTINA,
    resolutions,
    protocolsTouched,
    candidatesDropped,
    errors,
  };
};
