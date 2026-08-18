// Димитровград (HKV09) — full-session protokol parser (.doc / .docx / .pdf).
//
// Source surface:
//   - Index: https://www.dimitrovgrad.bg/bg/protokoli-ot-zasedaniyata-na-obshtinskiya-savet
//     (static, paginated /page/N — 220+ pages of sessions back to 2009)
//   - Session pages link a single document under
//     /uploads/posts/{YYYY}/{DDMMYYYY}-za-publ.{doc,docx,pdf}
//
// FORMAT HISTORY — this município has changed format twice, and each change
// was silent: the parser reported "no link found" while the document sat on
// the page. .doc through session 32, .docx from 33, .pdf from 38
// (2026-07-30). Assume it will change again; findDocUrl below prefers Word
// and falls back to PDF rather than pinning one extension.
//   - Per-decision .docx files (r-{N}-{slug}.docx) also published on the
//     companion /bg/resheniya-na-obs page — but those contain ONLY the
//     decision body, no tally. The tally lives in the chair-narrated
//     session protokol .doc.
//
// Two layout characteristics:
//
// 1. .doc is binary Word 97-2003 (Composite Document File, codepage 1251).
//    Convert via macOS `textutil` (the user's primary host) — produces
//    clean UTF-8. The watcher therefore inherits a macOS dependency,
//    matching the existing scripts/budget/capital_programs/vidin.ts
//    convention. On Linux a libreoffice / catdoc fallback would be
//    needed; the watcher currently runs on macOS so this is acceptable.
//
// 2. Tally PRECEDES the РЕШЕНИЕ marker — the chair narrates the vote
//    result first, then "И след поименното гласуване ОбС прие: Р Е Ш Е
//    Н И Е № NNN". Same pairing convention as Kazanlak (szrk.ts):
//    take the LATEST tally whose offset PRECEDES the marker. The text
//    between the marker and the next marker is the decision body.
//
// 3. Tally form is VERBOSE label-first with semicolon separators and
//    quoted Bulgarian-style labels:
//       "за" – 22 общински съветници; "против" – 2; "въздържали се" – 0
//    The shared SUMMARY_RE_VERBOSE in lib/tally.ts already matches
//    this — its VERBOSE_SEP includes `[;,.\s]+` and an optional
//    "общински съветници" suffix. No pre-processing needed.
//
// No per-councillor block — the protokol records the chair's announced
// totals, not the individual readout. Coverage tier B (decision
// metadata + tally + adopted/rejected), equivalent to HKV34 / SZR /
// RSE / Pleven / Добрич.

import { councilFetchHtml as fetchHtml, fetchToFile } from "../lib/fetch";
import { isMalformedArchiveError, extractWordText } from "../lib/docx";
import { extractPdfText, looksLikeScannedPdf } from "../lib/pdf_text";
import { classifyResult, findAllTallies } from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "HKV09";
const BASE = "https://www.dimitrovgrad.bg";
const INDEX_URL =
  "https://www.dimitrovgrad.bg/bg/protokoli-ot-zasedaniyata-na-obshtinskiya-savet";

type SessionRef = {
  pageUrl: string; // session HTML page
  session: string; // numeric session id
  date: string; // ISO YYYY-MM-DD
};

type ProtokolDoc = SessionRef & {
  docUrl: string;
};

// Session URL pattern: /bg/protokoli-ot-zasedaniyata-na-obshtinskiya-savet/
//   protokol-{N}-ot-{type}-zasedanie-na-{D}-{M}-{YYYY}-godina
// or                  protokol-{N}-ot-{type}-zasedanie-na-{DDMMYYYY}-godina
const SESSION_PATH_RE =
  /\/bg\/protokoli-ot-zasedaniyata-na-obshtinskiya-savet\/protokol-(\d+)-ot-[a-z-]+-na-(\d{1,2})-?(\d{1,2})?-?(\d{4,8})-godina/i;

const parseDateParts = (a: string, b: string, c: string): string | null => {
  // Two URL forms surface in the wild:
  //   protokol-34-ot-redovno-zasedanie-na-26-3-2026-godina    → a=26 b=3 c=2026
  //   protokol-26-ot-tarzhestvena-sesiya-na-2092025-godina    → a=2092025 b="" c=""
  if (c && /^\d{4}$/.test(c)) {
    const dd = a.padStart(2, "0");
    const mm = b.padStart(2, "0");
    return `${c}-${mm}-${dd}`;
  }
  // Compacted form: DDMMYYYY or DMMYYYY → take last 4 = year
  const compact = a;
  if (compact.length >= 7) {
    const yyyy = compact.slice(-4);
    const mm = compact.slice(-6, -4).padStart(2, "0");
    const dd = compact.slice(0, -6).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
};

const parseSessionLink = (rawHref: string): SessionRef | null => {
  const full = rawHref.startsWith("http")
    ? rawHref
    : `${BASE}/${rawHref.replace(/^\/+/, "")}`;
  const m = full.match(SESSION_PATH_RE);
  if (!m) return null;
  const date = parseDateParts(m[2] ?? "", m[3] ?? "", m[4] ?? "");
  if (!date) return null;
  return { pageUrl: full, session: m[1], date };
};

const collectIndexPages = async (
  sinceDate: string | undefined,
  maxProtocols: number | undefined,
): Promise<SessionRef[]> => {
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  // Walk paginated index. The site uses /page/10, /page/20, ... (step 10),
  // newest first. We stop when (a) we hit a page with no new session links
  // (end of catalogue), (b) every session on the page is older than sinceDate,
  // or (c) we've collected enough.
  const STEP = 10;
  for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
    const url =
      pageIdx === 0 ? INDEX_URL : `${INDEX_URL}/page/${pageIdx * STEP}`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      // 404 = ran off end of pagination, that's OK.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("→ 404")) break;
      throw err;
    }
    const hrefs = Array.from(
      html.matchAll(/href=["']([^"']+)["']/g),
      (m) => m[1],
    );
    const fresh: SessionRef[] = [];
    for (const h of hrefs) {
      const ref = parseSessionLink(h);
      if (!ref) continue;
      if (seen.has(ref.pageUrl)) continue;
      seen.add(ref.pageUrl);
      fresh.push(ref);
    }
    if (fresh.length === 0) break;
    out.push(...fresh);
    // Stop early if EVERY session on this page is older than the watermark.
    if (sinceDate && fresh.every((r) => r.date <= sinceDate)) break;
    if (maxProtocols && out.length >= maxProtocols * 2) break;
  }
  return out;
};

// Session-page → protokol file URL. The protokol is the single document
// link under /uploads/posts/. The format has now shifted TWICE across the
// archive: most sessions ship .doc (Word 97-2003 binary), sessions 33+
// moved to .docx, and session 38 (2026-07-30) moved again to .pdf. Per-
// decision .docx files live on the companion /bg/resheniya-na-obs pages,
// not here.
//
// PREFERENCE ORDER, not first-match: .doc/.docx win when present, and .pdf
// is the fallback. Every already-ingested session therefore keeps parsing
// through exactly the path it did before — the PDF branch only engages for
// sessions that ship nothing else, so this widening cannot silently re-route
// (and re-parse) settled history.
const DOC_EXT_RE = /uploads\/posts\/.+\.(docx?|pdf)$/i;

const findDocUrl = (sessionHtml: string): string | null => {
  const hrefs = Array.from(
    sessionHtml.matchAll(/href=["']([^"']+)["']/g),
    (m) => m[1],
  );
  const candidates = hrefs.filter((h) => DOC_EXT_RE.test(h));
  const word = candidates.find((h) => /\.docx?$/i.test(h));
  const chosen = word ?? candidates.find((h) => /\.pdf$/i.test(h));
  if (!chosen) return null;
  return chosen.startsWith("http")
    ? chosen
    : `${BASE}/${chosen.replace(/^\/+/, "")}`;
};

// Dimitrovgrad's protokol uses LETTER-SPACED "Р  Е  Ш  Е  Н  И  Е" for
// the marker (each glyph separated by whitespace from textutil), followed
// by "№ NNN" + "От {date} г." We require ALL-CAPS Cyrillic with whitespace
// between every glyph (no `i` flag), so body-internal cross-references like
// "Промяна на решение № 573 от 31.07.2025г." don't masquerade as markers.
const MARKER_RE = /Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е\s+№\s*(\d{1,4})\s+От\s+\d/gu;

// Agenda-item header: "ПО ПЪРВА ТОЧКА ОТ ДНЕВНИЯ РЕД: ... относно: <TITLE>"
// (also "ПО ВТОРА", "ПО ТРЕТА", ..., "ПО ДВАДЕСЕТА", etc.). The same
// session protokol opens each numbered agenda item with this header, and
// every Р Е Ш Е Н И Е inside that block shares the same subject. We use
// the "относно:" payload as the canonical title. The payload usually
// occupies a single line but occasionally continues across the next
// non-blank lines (numbered sub-items) — see prot 31/2025 ТБО decision.
const AGENDA_RE = /ПО\s+\S+\s+ТОЧКА(?:\s+ОТ\s+ДНЕВНИЯ\s+РЕД)?\s*:?\s*/giu;

type Marker = {
  offset: number;
  number: string;
};

type AgendaItem = {
  offset: number;
  title: string;
};

const findHkv09Markers = (text: string): Marker[] => {
  const out: Marker[] = [];
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ offset: m.index, number: m[1] });
  }
  return out;
};

const trimTitle = (raw: string, maxLen = 240): string => {
  let t = raw.replace(/\s+/g, " ").trim();
  // Drop a trailing dangling " г." duplicate or stray punctuation.
  t = t.replace(/\s*[;,.]\s*$/u, "");
  if (t.length <= maxLen) return t;
  // Cut on a word boundary so we don't slice a Cyrillic word mid-glyph.
  const cut = t.lastIndexOf(" ", maxLen);
  return (
    (cut > Math.floor(maxLen * 0.5)
      ? t.slice(0, cut)
      : t.slice(0, maxLen)
    ).trim() + "…"
  );
};

const findAgendaItems = (text: string): AgendaItem[] => {
  const out: AgendaItem[] = [];
  const re = new RegExp(AGENDA_RE.source, AGENDA_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Capture from the end of the header forward to the first blank line.
    // That spans the same-line subject AND any continuation lines (e.g.
    // numbered sub-items "1. … 2. …" when the chair stacks two items in
    // one agenda point).
    const tail = text.slice(re.lastIndex, re.lastIndex + 2000);
    const para = tail.match(/^([^\n]*(?:\n[^\n]+)*)/u);
    const block = (para?.[1] ?? "").trim();
    if (!block) continue;
    // Prefer the "относно:" payload — that's the descriptive subject. Fall
    // back to the full block when the header omits "относно" (rare).
    const otn = block.match(/относно\s*[:\-–]?\s*([\s\S]+)/iu);
    const raw = otn ? otn[1] : block;
    const title = trimTitle(raw);
    if (title) out.push({ offset: m.index, title });
  }
  return out;
};

const parseProtokolText = (
  text: string,
  meta: ProtokolDoc,
): CouncilResolution[] => {
  const tallies = findAllTallies(text);
  const markers = findHkv09Markers(text);
  const agenda = findAgendaItems(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    // Tally PRECEDES the marker — take the latest tally whose offset is
    // less than the marker's offset, and not already claimed by an
    // earlier marker (guard against a tally being paired twice when
    // two РЕШЕНИЕ sit very close).
    const prevMarkerOffset = i === 0 ? -1 : markers[i - 1].offset;
    const candidate = [...tallies]
      .reverse()
      .find((t) => t.offset < marker.offset && t.offset > prevMarkerOffset);
    if (!candidate) continue;

    const tally = candidate.tally;
    const result = classifyResult(text, candidate.offset);
    // Title = "относно:" payload of the most recent "ПО ХХХ ТОЧКА ОТ
    // ДНЕВНИЯ РЕД" header before this marker. All Р Е Ш Е Н И Е inside
    // one agenda block share the same subject. Decisions that fall outside
    // any agenda block (rare procedural votes) fall through to "(no title
    // parsed)".
    const agendaItem = [...agenda]
      .reverse()
      .find((a) => a.offset < marker.offset);
    const title = agendaItem?.title ?? "(no title parsed)";

    const id = `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`;
    out.push({
      id,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title,
      tally,
      result,
      sourceUrl: meta.docUrl,
    });
  }
  return out;
};

export const scrapeHKV09 = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
    perCouncillor?: boolean;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;
  let candidatesDropped = 0;

  const currentYear = new Date().getUTCFullYear();
  const startYear = opts.sinceYear ?? currentYear - 1;

  let sessions: SessionRef[] = [];
  try {
    sessions = await collectIndexPages(opts.sinceDate, opts.maxProtocols);
  } catch (err) {
    errors.push({
      url: INDEX_URL,
      kind: "discovery",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let all = sessions.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= currentYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  // --max truncates the candidate list newest-first, and a dropped
  // candidate raises NO error — so the count has to reach the
  // watermark, or it advances past protocols this run never looked at.
  if (opts.maxProtocols && all.length > opts.maxProtocols) {
    candidatesDropped = all.length - opts.maxProtocols;
    all = all.slice(0, opts.maxProtocols);
  }

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new protokols (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
      candidatesDropped,
      errors,
    };
  }

  console.log(`  [${OBSHTINA}] fetching ${all.length} session page(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-hkv09-"));
  try {
    for (const p of all) {
      try {
        const sessionHtml = await fetchHtml(p.pageUrl);
        const docUrl = findDocUrl(sessionHtml);
        if (!docUrl) {
          errors.push({
            url: p.pageUrl,
            date: p.date,
            kind: "content",
            message: "no .doc/.docx/.pdf link found on session page",
          });
          continue;
        }
        const ext = /\.(docx|doc|pdf)$/i.exec(docUrl)?.[1].toLowerCase();
        const docPath = join(dir, `pr_${p.session}.${ext ?? "doc"}`);
        await fetchToFile(docUrl, docPath);
        const buf = await readFile(docPath);
        let text: string;
        if (ext === "pdf") {
          text = await extractPdfText(buf);
          if (looksLikeScannedPdf(text)) {
            errors.push({
              url: docUrl,
              date: p.date,
              kind: "content",
              message: "scanned PDF — route to Phase 3 OCR",
            });
            continue;
          }
        } else {
          // .doc up to session 32, .docx from 33 — and the extension has
          // been wrong before, so the reader is chosen from the signature.
          text = await extractWordText(buf);
        }
        const recs = parseProtokolText(text, {
          ...p,
          docUrl,
        });
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${p.session} (${p.date}): ${recs.length} decision(s)`,
        );
      } catch (err) {
        errors.push({
          url: p.pageUrl,
          // An unreadable .docx container is `content`: same bytes next run.
          // The .doc and .pdf branches raise plain Errors and stay `fetch`.
          kind: isMalformedArchiveError(err) ? "content" : "fetch",
          date: p.date,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
