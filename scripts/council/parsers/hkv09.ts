// Димитровград (HKV09) — full-session protokol .doc parser.
//
// Source surface:
//   - Index: https://www.dimitrovgrad.bg/bg/protokoli-ot-zasedaniyata-na-obshtinskiya-savet
//     (static, paginated /page/N — 220+ pages of sessions back to 2009)
//   - Session pages link a single .doc (Word 97-2003 binary) under
//     /uploads/posts/{YYYY}/{DDMMYYYY}-za-publ.doc
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

import { fetchToFile } from "../lib/fetch";
import { extractDocxText } from "../lib/docx";
import { classifyResult, findAllTallies } from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { spawn } from "node:child_process";
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

const UA = "Mozilla/5.0 electionsbg-council/1.0";

const fetchHtml = async (url: string): Promise<string> => {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.text();
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

// Session-page → protokol file URL. The protokol is the single .doc or
// .docx link under /uploads/posts/ — most sessions ship .doc (Word 97-
// 2003 binary), recent sessions (33+) started using .docx. Per-decision
// .docx files live on the companion /bg/resheniya-na-obs pages, not
// here.
const findDocUrl = (sessionHtml: string): string | null => {
  const hrefs = Array.from(
    sessionHtml.matchAll(/href=["']([^"']+)["']/g),
    (m) => m[1],
  );
  for (const h of hrefs) {
    if (!/uploads\/posts\/.+\.docx?$/i.test(h)) continue;
    return h.startsWith("http") ? h : `${BASE}/${h.replace(/^\/+/, "")}`;
  }
  return null;
};

// Convert a .doc buffer → UTF-8 text via macOS `textutil`. Throws if the
// binary isn't on PATH (the user runs the watcher on macOS).
const convertDocToText = async (docBuffer: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "council-hkv09-"));
  const docPath = join(dir, "in.doc");
  const txtPath = join(dir, "in.txt");
  try {
    await (await import("node:fs/promises")).writeFile(docPath, docBuffer);
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
              "textutil not found on PATH — Dimitrovgrad .doc conversion " +
                "requires macOS textutil (run the watcher on macOS).",
            ),
          );
        } else reject(err);
      });
      child.on("close", (c: number | null) =>
        resolve({ code: c ?? 0, stderr: errBuf }),
      );
    });
    if (code !== 0) {
      throw new Error(`textutil exited ${code}: ${stderr.slice(0, 200)}`);
    }
    return await readFile(txtPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// Dimitrovgrad's protokol uses LETTER-SPACED "Р  Е  Ш  Е  Н  И  Е" for
// the marker (each glyph separated by whitespace from textutil), followed
// by "№ NNN" + "От {date} г." Anchoring on the trailing "От \d" date
// line is what distinguishes a true decision marker from a body-internal
// cross-reference (e.g. "поправка на Решение № 556 от 26.6.2025 г.").
const MARKER_RE = /Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е\s+№\s*(\d{1,4})\s+От\s+\d/giu;

type Marker = {
  offset: number;
  number: string;
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

const parseProtokolText = (
  text: string,
  meta: ProtokolDoc,
): CouncilResolution[] => {
  const tallies = findAllTallies(text);
  const markers = findHkv09Markers(text);
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
    // Title extraction skipped — Dimitrovgrad bodies open with the legal
    // preamble "На основание чл.X от ЗМСМА", not a clean subject line.
    const title = "(no title parsed)";

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

  const currentYear = new Date().getUTCFullYear();
  const startYear = opts.sinceYear ?? currentYear - 1;

  let sessions: SessionRef[] = [];
  try {
    sessions = await collectIndexPages(opts.sinceDate, opts.maxProtocols);
  } catch (err) {
    errors.push({
      url: INDEX_URL,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let all = sessions.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= currentYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (opts.maxProtocols) all = all.slice(0, opts.maxProtocols);

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new protokols (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
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
            message: "no .doc link found on session page",
          });
          continue;
        }
        const isDocx = /\.docx$/i.test(docUrl);
        const docPath = join(dir, `pr_${p.session}.${isDocx ? "docx" : "doc"}`);
        await fetchToFile(docUrl, docPath);
        const buf = await readFile(docPath);
        const text = isDocx
          ? await extractDocxText(buf)
          : await convertDocToText(buf);
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
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
