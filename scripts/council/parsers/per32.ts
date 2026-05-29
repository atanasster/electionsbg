// Перник (PER32) — full-session protokol .docx parser, tier A.
//
// Source surface:
//   - Index: https://www.obs-pernik.bg/category/заседания/протоколи-заседания/
//     (WordPress category with /page/N/ pagination, 10 posts per page,
//     ~50 posts back to the 2023-2027 mandate)
//   - Posts live at  /протокол-№-{N}-{DD}-{MM}-{YYYY}г/  (Cyrillic slug)
//     and each post page links a single .docx under
//     /wp-content/uploads/{YYYY}/{MM}/ПРОТОКОЛ-№{N}-{DD}.{MM}.{YYYY}г.docx
//
// The protokol is born-digital text-layer DOCX with three layers:
//
//   1. Agenda preamble (chair lists the day's докладни записки, with
//      many cross-references to past decisions: "Поправка на РЕШЕНИЕ
//      №863 ..."). All РЕШЕНИЕ matches in this layer are CROSS-
//      REFERENCES, not new decisions. We filter them by requiring a
//      "прие" anchor in the 200 chars preceding the marker.
//
//   2. Per-decision body (chair narrates the discussion + the formal
//      announcement: "Общинският съвет гласува и със 'за' - N,
//      'против' - M и 'въздържали се' - K [per-councillor lines] прие
//      На основание чл.X ... Р Е Ш Е Н И Е № NNN <body>"). The tally
//      form matches the shared SUMMARY_RE_LABEL_FIRST out of the box.
//
//   3. Per-councillor named-vote block between the tally summary and
//      the marker, ungrouped (NO leading position numbers — just
//      "<First> <Last>: За|Против|Въздържал[а|и] се" one per line).
//      The shared VOTE_LINE_RE requires a leading number; this parser
//      ships its own simpler regex for the un-numbered Перник form.
//
// Per-councillor join goes to the cacbg "Перник" roster. Coverage
// tier A (full decision metadata + tally + adopted/rejected + per-
// councillor block), comparable to VTR01 / SZR12 / BGS01 / SOF /
// GAB05 (the latter 2025+ only).

import { fetchToFile } from "../lib/fetch";
import { extractDocxText } from "../lib/docx";
import {
  classifyResult,
  findAllTallies,
  type ParsedVoteEntry,
} from "../lib/tally";
import {
  buildMuniLookup,
  joinVotesToRoster,
  summariseJoin,
} from "../lib/roster_join";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type RosterLookup = Awaited<ReturnType<typeof buildMuniLookup>>;

const OBSHTINA = "PER32";
const BASE = "https://www.obs-pernik.bg";
const CATEGORY_PATH = "/category/заседания/протоколи-заседания/";
const UA = "Mozilla/5.0 electionsbg-council/1.0";

type SessionRef = {
  postUrl: string;
  session: string;
  date: string; // ISO YYYY-MM-DD
};

type ProtokolDoc = SessionRef & {
  docxUrl: string;
};

const fetchHtml = async (url: string): Promise<string> => {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.text();
};

// Post slug: /протокол-№-{N}-{DD}-{MM}-{YYYY}г/
// The Cyrillic slug is rendered both as percent-encoded (linkedin
// share URL) AND as literal Cyrillic (canonical link). We anchor on
// the literal form since it's the canonical href.
const POST_SLUG_RE = /\/протокол-№-(\d+)-(\d{1,2})-(\d{1,2})-(\d{4})г\//u;

const decodeHref = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const parsePostUrl = (rawHref: string): SessionRef | null => {
  // Reject share-button hrefs that ALSO contain the post URL as a param.
  if (
    /twitter|facebook|linkedin|intent\/tweet|share\.php|shareArticle/i.test(
      rawHref,
    )
  )
    return null;
  // WordPress emits both encoded (%d0%bf%d1%80%d0%be%d1%82%d0%be%d0%ba%d0%be%d0%bb)
  // and literal Cyrillic forms — decode before matching.
  const decoded = decodeHref(rawHref);
  const m = decoded.match(POST_SLUG_RE);
  if (!m) return null;
  const full = decoded.startsWith("http") ? decoded : `${BASE}${decoded}`;
  const dd = m[2].padStart(2, "0");
  const mm = m[3].padStart(2, "0");
  const yyyy = m[4];
  return { postUrl: full, session: m[1], date: `${yyyy}-${mm}-${dd}` };
};

const collectIndexPages = async (
  sinceDate: string | undefined,
  maxProtocols: number | undefined,
): Promise<SessionRef[]> => {
  const out: SessionRef[] = [];
  const seen = new Set<string>();
  for (let pageIdx = 1; pageIdx <= 30; pageIdx++) {
    const url =
      pageIdx === 1
        ? `${BASE}${CATEGORY_PATH}`
        : `${BASE}${CATEGORY_PATH}page/${pageIdx}/`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err) {
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
      const ref = parsePostUrl(h);
      if (!ref) continue;
      if (seen.has(ref.postUrl)) continue;
      seen.add(ref.postUrl);
      fresh.push(ref);
    }
    if (fresh.length === 0) break;
    out.push(...fresh);
    if (sinceDate && fresh.every((r) => r.date <= sinceDate)) break;
    if (maxProtocols && out.length >= maxProtocols * 2) break;
  }
  return out;
};

/** Find the .docx URL on a post page. The post is a WordPress single
 *  with one attached file under /wp-content/uploads/. */
const findDocxUrl = (postHtml: string): string | null => {
  const hrefs = Array.from(
    postHtml.matchAll(/href=["']([^"']+)["']/g),
    (m) => m[1],
  );
  for (const h of hrefs) {
    if (!/wp-content\/uploads\/.+\.docx?$/i.test(h)) continue;
    if (/twitter|facebook|linkedin/i.test(h)) continue;
    return h.startsWith("http")
      ? h
      : `${BASE}${h.startsWith("/") ? "" : "/"}${h}`;
  }
  return null;
};

// Marker: "Р Е Ш Е Н И Е № NNN" (with optional spaced letters from the
// .docx's rendered form). Real markers are preceded by "прие\s*На
// основание" — chair's announcement of adoption. Agenda cross-
// references like "поправка на РЕШЕНИЕ №863" or "Решение № 1146 от
// 23.02.2023 г." precede with completely different context and are
// filtered out.
const MARKER_RE = /Р\s*Е\s*Ш\s*Е\s*Н\s*И\s*Е\s*№\s*(\d{1,5})/giu;
// ASCII \b word-boundary doesn't fire after Cyrillic — rely on a
// preceding tally separator (the chair's "за - N, против - M ..."
// tally line ends in a number, optionally followed by " ." or " прие").
// We match "прие" surrounded by Cyrillic OR space, just not in the
// middle of "приета" etc. The (?!\p{L}) lookahead after the trailing
// "е" rejects "приета", "приема", "приеха", etc. — only the bare
// past-tense verb "прие" survives.
const ADOPTION_ANCHOR_RE = /прие(?!\p{L})/iu;

type Marker = {
  offset: number;
  number: string;
};

const findRealMarkers = (text: string): Marker[] => {
  const out: Marker[] = [];
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Look back 300 chars — a real "прие" anchor should sit within
    // that window. Agenda cross-references typically have "РЕШЕНИЕ
    // №NNN от <date> г." far from any "прие" verb.
    const lookback = text.slice(Math.max(0, m.index - 300), m.index);
    if (!ADOPTION_ANCHOR_RE.test(lookback)) continue;
    out.push({ offset: m.index, number: m[1] });
  }
  return out;
};

// Per-councillor line — ungrouped Перник form: "<First> <Last>: За".
// Allow 2-3 name parts (some councillors include middle names). Capture
// the vote separately. The Cyrillic name class is required because the
// shared VOTE_LINE_RE only matches numbered rolls. We use a Unicode
// lookahead after the vote token instead of \b — ASCII word-boundary
// doesn't fire after Cyrillic letters in u-mode regex (same trap as
// the HKV34 chair-announcement parser hit).
const PER_NAME_RE =
  /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?:\s+[А-ЯЁ][а-яё]+){1,3})\s*:\s*(За|Против|Въздържал[аи]?\s*се|отсъства)(?=[^\p{L}]|$)/giu;

const collectNamedVotes = (
  blockText: string,
): { entries: ParsedVoteEntry[] } => {
  const entries: ParsedVoteEntry[] = [];
  const seen = new Set<string>();
  const re = new RegExp(PER_NAME_RE.source, PER_NAME_RE.flags);
  let m: RegExpExecArray | null;
  let pos = 0;
  while ((m = re.exec(blockText)) !== null) {
    const name = m[1].trim();
    if (seen.has(name)) continue; // dedupe (chair may re-read a name)
    seen.add(name);
    const voteRaw = m[2];
    if (/^отсъства$/iu.test(voteRaw)) continue;
    const vote: ParsedVoteEntry["vote"] = /^За$/iu.test(voteRaw)
      ? "for"
      : /^Против$/iu.test(voteRaw)
        ? "against"
        : "abstain";
    pos++;
    entries.push({
      name,
      normKey: name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[-\s]+/g, " ")
        .trim(),
      vote,
      position: pos,
    });
  }
  return { entries };
};

const parseProtokolText = (
  text: string,
  meta: ProtokolDoc,
  lookup: RosterLookup | null,
): {
  resolutions: CouncilResolution[];
  joinStats: {
    exact: number;
    ambiguous: number;
    unmatched: number;
    total: number;
  };
} => {
  const tallies = findAllTallies(text);
  const markers = findRealMarkers(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);
  const joinTotals = { exact: 0, ambiguous: 0, unmatched: 0, total: 0 };

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    // Tally PRECEDES the marker. Pick the latest tally with offset
    // less than the marker AND greater than the previous marker.
    const prevMarkerOffset = i === 0 ? -1 : markers[i - 1].offset;
    const candidate = [...tallies]
      .reverse()
      .find((t) => t.offset < marker.offset && t.offset > prevMarkerOffset);
    if (!candidate) continue;

    let tally = candidate.tally;
    const result = classifyResult(text, candidate.offset);

    // Per-councillor block sits between the tally line and the marker.
    if (lookup) {
      // Slice from just after the tally summary line up to (but not
      // including) the marker — that's the named-vote window.
      const tallyEnd = candidate.offset + 200; // generous skip past the tally line itself
      const blockText = text.slice(tallyEnd, marker.offset);
      const { entries } = collectNamedVotes(blockText);
      if (entries.length > 0) {
        const joined = joinVotesToRoster(entries, lookup);
        const stats = summariseJoin(joined);
        joinTotals.exact += stats.exact;
        joinTotals.ambiguous += stats.ambiguous;
        joinTotals.unmatched += stats.unmatched;
        joinTotals.total += stats.total;
        tally = {
          ...tally,
          method: "named",
          perCouncillor: joined.map((j) => ({
            name: j.matchedTo ?? j.name,
            normKey: j.normKey,
            vote: j.vote,
          })),
        };
      }
    }

    out.push({
      id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title: "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.docxUrl,
    });
  }
  return { resolutions: out, joinStats: joinTotals };
};

export const scrapePER = async (
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

  let sessions: SessionRef[] = [];
  try {
    sessions = await collectIndexPages(opts.sinceDate, opts.maxProtocols);
  } catch (err) {
    errors.push({
      url: `${BASE}${CATEGORY_PATH}`,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const currentYear = new Date().getUTCFullYear();
  const startYear = opts.sinceYear ?? currentYear - 1;
  let all = sessions.filter((r) => {
    const yyyy = parseInt(r.date.slice(0, 4), 10);
    return yyyy >= startYear && yyyy <= currentYear;
  });
  if (opts.sinceDate) all = all.filter((r) => r.date > opts.sinceDate!);
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (opts.maxProtocols) all = all.slice(0, opts.maxProtocols);

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new posts (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
      errors,
    };
  }

  // Build the cacbg councillor roster lookup once per run.
  let lookup: RosterLookup | null = null;
  if (opts.perCouncillor) {
    try {
      lookup = await buildMuniLookup("Перник");
    } catch (err) {
      errors.push({
        url: "buildMuniLookup",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const joinTotals = { exact: 0, ambiguous: 0, unmatched: 0, total: 0 };

  console.log(`  [${OBSHTINA}] fetching ${all.length} post(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-per32-"));
  try {
    for (const p of all) {
      try {
        const postHtml = await fetchHtml(p.postUrl);
        const docxUrl = findDocxUrl(postHtml);
        if (!docxUrl) {
          errors.push({
            url: p.postUrl,
            message: "no .docx link on post page",
          });
          continue;
        }
        const docxPath = join(dir, `pr_${p.session}.docx`);
        await fetchToFile(docxUrl, docxPath);
        const buf = await readFile(docxPath);
        const text = await extractDocxText(buf);
        const { resolutions: recs, joinStats } = parseProtokolText(
          text,
          { ...p, docxUrl },
          lookup,
        );
        resolutions.push(...recs);
        joinTotals.exact += joinStats.exact;
        joinTotals.ambiguous += joinStats.ambiguous;
        joinTotals.unmatched += joinStats.unmatched;
        joinTotals.total += joinStats.total;
        protocolsTouched++;
        console.log(
          `    + prot ${p.session} (${p.date}): ${recs.length} decision(s)`,
        );
      } catch (err) {
        errors.push({
          url: p.postUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (lookup && joinTotals.total > 0) {
    console.log(
      `    perCouncillor join: ${joinTotals.exact} exact + ${joinTotals.ambiguous} ambiguous + ${joinTotals.unmatched} unmatched (total ${joinTotals.total})`,
    );
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
