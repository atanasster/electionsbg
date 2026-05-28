// Бургас (BGS01) — drill-in parser over Drupal /node/{id} session pages.
//
// CAVEAT (same as Varna): burgascouncil.org publishes only the
// "ПРЕПИС – ИЗВЛЕЧЕНИЕ" extract format. The PDFs carry per-decision text
// but NO vote tally — Burgas publishes the take but not how each
// councillor voted. So tally is undefined; result is "unknown".
//
// Source surface:
//   - Index: /reshenia (Drupal node-list view — no pagination observed)
//   - Per-session node page: /node/{id} with H1 "ВЗЕТИ РЕШЕНИЯ НА
//     ЗАСЕДАНИЕ №<N> ОТ ДАТА <DD.MM.YYYY> ГОДИНА" and a single
//     PDF attachment href="/sites/default/files/{YYYY-MM}/za-sayta-<N>.pdf"
//   - PDF format: ПРЕПИС – ИЗВЛЕЧЕНИЕ от Протокол № N, followed by a
//     numbered list of agenda items in the form
//        "<pos>. ОбС <docId> Докладна записка от <name>, относно: <title>"
//     each followed by a "РЕШЕНИЕ:" body block (NO resolution number is
//     ever stamped — Burgas identifies decisions by the ОбС docket id).
//
// Decision ID is built from the ОбС docket id ("08-00-17953" → "17953"
// for the trailing number, normalised) — stable across the entire
// mandate so the same docket re-ingest is idempotent.

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "BGS01";
const BASE = "https://burgascouncil.org/";
const INDEX_URL = `${BASE}reshenia`;

type SessionRef = {
  pageUrl: string;
  pdfUrl: string;
  session: string;
  date: string;
};

const NODE_HREF_RE = /^\/node\/(\d+)$/u;
const TITLE_RE =
  /ВЗЕТИ\s+РЕШЕНИЯ\s+НА\s+ЗАСЕДАНИЕ\s+№\s*(\d+)\s+ОТ\s+ДАТА\s+(\d{2})\.(\d{2})\.(\d{4})/iu;
const PDF_HREF_RE = /\/sites\/default\/files\/[\d-]+\/za-sayta-\d+\.pdf/u;

const discoverSessions = async (): Promise<SessionRef[]> => {
  const indexHtml = await fetchHtml(INDEX_URL);
  const $ = cheerio.load(indexHtml);
  const nodeIds = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(NODE_HREF_RE);
    if (m) nodeIds.add(m[1]);
  });
  // Drupal navigation throws lots of unrelated /node/<id> hrefs onto every
  // page (menus, news teasers etc). We can't filter on the index page
  // alone — drill into each and keep the ones whose H1 matches the
  // ВЗЕТИ РЕШЕНИЯ pattern.
  const sessions: SessionRef[] = [];
  for (const nodeId of nodeIds) {
    const pageUrl = `${BASE}node/${nodeId}`;
    let html: string;
    try {
      html = await fetchHtml(pageUrl);
    } catch {
      continue;
    }
    const titleMatch = html.match(TITLE_RE);
    if (!titleMatch) continue;
    const pdfMatch = html.match(PDF_HREF_RE);
    if (!pdfMatch) continue;
    sessions.push({
      pageUrl,
      pdfUrl: resolveUrl(pdfMatch[0], BASE),
      session: titleMatch[1],
      date: `${titleMatch[4]}-${titleMatch[3]}-${titleMatch[2]}`,
    });
  }
  // Dedupe + newest-first.
  const seen = new Set<string>();
  return sessions
    .filter((s) => {
      const k = `${s.date}|${s.session}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
};

// Agenda-item header: "<position>. ОбС <prefix>-<dept>-<docId> Докладна
// записка от <author>, относно: <title until next agenda or РЕШЕНИЕ>".
// The position is reused inside the document body in cross-references, so
// we identify items by their full "ОбС N-N-NNNNN" docket id, not by
// position.
const AGENDA_ITEM_RE =
  /^\s*(\d+)\.\s+ОбС\s+(\d+-\d+-\d+)\s+([\s\S]+?)(?=\n\s*\d+\.\s+ОбС\s+\d+-\d+-\d+|\n\s+РЕШЕНИЕ\s*:)/gmu;
const OTNOSNO_RE = /относно\s*:\s*([\s\S]+?)(?:\n\s*$|$)/iu;

const parseSessionText = (
  text: string,
  meta: SessionRef,
): CouncilResolution[] => {
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);
  const seen = new Set<string>();
  for (const match of text.matchAll(AGENDA_ITEM_RE)) {
    const docket = match[2]; // e.g., "08-00-17953"
    const number = docket.split("-").pop()!; // "17953"
    if (seen.has(number)) continue;
    seen.add(number);
    // Title pulled from the body of the agenda item — the "относно:" clause.
    const itemBody = match[3].replace(/\s+/g, " ").trim();
    const titleMatch = itemBody.match(OTNOSNO_RE);
    const title = titleMatch
      ? titleMatch[1].replace(/\s+/g, " ").trim()
      : itemBody.slice(0, 200);
    out.push({
      id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${number}`,
      date: meta.date,
      session: meta.session,
      number,
      title: title || "(no title parsed)",
      // No tally — Burgas publishes ПРЕПИС-ИЗВЛЕЧЕНИЕ only.
      result: "unknown",
      sourceUrl: meta.pdfUrl,
    });
  }
  return out;
};

export const scrapeBGS = async (
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

  let sessions: SessionRef[];
  try {
    sessions = await discoverSessions();
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

  if (opts.sinceYear)
    sessions = sessions.filter(
      (s) => parseInt(s.date.slice(0, 4), 10) >= opts.sinceYear!,
    );
  if (opts.sinceDate)
    sessions = sessions.filter((s) => s.date > opts.sinceDate!);
  if (opts.maxProtocols) sessions = sessions.slice(0, opts.maxProtocols);

  if (sessions.length === 0) {
    console.log(`  [${OBSHTINA}] no new sessions`);
    return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
  }

  console.log(`  [${OBSHTINA}] processing ${sessions.length} session(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-bgs-"));
  try {
    for (const sess of sessions) {
      const pdfPath = join(dir, `s_${sess.session}_${sess.date}.pdf`);
      try {
        await fetchToFile(sess.pdfUrl, pdfPath);
        const buf = await readFile(pdfPath);
        const text = await extractPdfText(buf);
        if (looksLikeScannedPdf(text)) {
          errors.push({
            url: sess.pdfUrl,
            message: "scanned PDF — route to Phase 3 OCR",
          });
          continue;
        }
        const recs = parseSessionText(text, sess);
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + sess ${sess.session} (${sess.date}): ${recs.length} decision(s)`,
        );
      } catch (err) {
        errors.push({
          url: sess.pdfUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
