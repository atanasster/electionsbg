// Перник (PER32) — full-session protokol Word parser, tier A.
//
// Source surface:
//   - Index: https://www.obs-pernik.bg/category/заседания/протоколи-заседания/
//     (WordPress category with /page/N/ pagination, 10 posts per page,
//     ~50 posts back to the 2023-2027 mandate)
//   - Posts live at  /протокол-№-{N}-{DD}-{MM}-{YYYY}г/  (Cyrillic slug)
//     and each post page links a single Word file under
//     /wp-content/uploads/{YYYY}/{MM}/ПРОТОКОЛ-№{N}-{DD}.{MM}.{YYYY}г.docx
//
// Mostly .docx, but NOT always: протокол №13/19-10-2025 is a Word 97-2003
// .doc. `extractWordText` picks the reader from the file's own signature,
// so neither this parser nor `findDocxUrl` has to care which one a post
// links. Reading it off the extension is what fed an OLE2 file to the OOXML
// reader and pinned this município's watermark at 2025-10-16 for a month.
//
// The protokol is born-digital text-layer Word with three layers:
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

import { councilFetchHtml as fetchHtml, fetchToFile } from "../lib/fetch";
import { isMalformedArchiveError, extractWordText } from "../lib/docx";
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

type SessionRef = {
  postUrl: string;
  session: string;
  date: string; // ISO YYYY-MM-DD
};

type ProtokolDoc = SessionRef & {
  docxUrl: string;
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

/** Find the protokol URL on a post page. The post is a WordPress single
 *  with one attached file under /wp-content/uploads/.
 *
 *  The `.docx?` in the pattern is load-bearing: Перник links BOTH, and
 *  протокол №13/19-10-2025 is a `.doc`. Which reader that needs is decided
 *  from the bytes by `extractWordText`, not from the extension here — the
 *  href only has to be found. */
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
//
// ⚠️ THE INTRA-NAME SEPARATOR MUST NOT CROSS A LINE, and it used `\s+`.
// `\s` matches `\n`, and „За" / „Против" themselves match the name-part class
// (capital + lowercase), so a vote-label line sitting directly above a
// „Name: За" line was absorbed INTO the name: the capture came out as
// "За\nРая Благоева". The stored norm_key then began with a vote word, the PG
// loader refused it as corrupt, and that councillor's vote was dropped.
//
// Measured 2026-08-17 over the durable tree: 1,029 of Перник's 8,915
// per-councillor rows, and the cost was NOT spread thinly — it fell on the 18
// councillors who happen to follow a label line, and ALL EIGHTEEN had zero
// surviving clean rows. Рая Владимирова Благоева (364 votes) and Петър Кирилов
// Първанов (287) are on the official roster and were entirely absent from
// „Кой как гласува" for Перник.
//
// `:` and the vote are also line-bound now, for the same reason.
// The hyphen alternative repeats on EVERY name part, not just the first. It was
// on the first only, so „Мариета Тимнева-Рохова: Въздържал се" matched nothing
// at all — a pre-existing latent gap (Перник's roster happens to hold no
// hyphenated councillor today, so it costs nothing yet) and one hyphenated
// surname away from silently dropping a whole person.
const NAME_PART = "[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)*";
const PER_NAME_RE = new RegExp(
  `(${NAME_PART}(?:[ \\t\\u00a0]+${NAME_PART}){1,3})` +
    `[ \\t\\u00a0]*:[ \\t\\u00a0]*` +
    `(За|Против|Въздържал[аи]?[ \\t\\u00a0]*се|отсъства)(?=[^\\p{L}]|$)`,
  "giu",
);

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
      // End the skip at the tally match's OWN end, never at a fixed
      // offset. This was `candidate.offset + 200` ("generous skip past
      // the tally line itself"), and 200 is longer than most Перник
      // tally lines — so the slice started INSIDE the first councillor's
      // name and ate a variable number of leading letters, producing one
      // orphan fold per block: Владислав Владимиров survived as
      // 'ладислав', 'дислав', 'ислав', 'слав' and 'лав' Владимиров, each
      // matching no roster entry. The truncation VARIES with the tally
      // line's real length, which is what rules out a regex-boundary
      // cause and points here.
      //
      // findAllTallies already reports the match length, so the correct
      // bound is exact. Anything between the tally's end and the first
      // name (". Приема се", "Гласували поименно:") cannot false-match —
      // collectNamedVotes requires a `Name: Vote` shape.
      const tallyEnd = candidate.offset + candidate.length;
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
  let candidatesDropped = 0;

  let sessions: SessionRef[] = [];
  try {
    sessions = await collectIndexPages(opts.sinceDate, opts.maxProtocols);
  } catch (err) {
    errors.push({
      url: `${BASE}${CATEGORY_PATH}`,
      kind: "discovery",
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
  // --max truncates the candidate list newest-first, and a dropped
  // candidate raises NO error — so the count has to reach the
  // watermark, or it advances past protocols this run never looked at.
  if (opts.maxProtocols && all.length > opts.maxProtocols) {
    candidatesDropped = all.length - opts.maxProtocols;
    all = all.slice(0, opts.maxProtocols);
  }

  if (all.length === 0) {
    console.log(
      `  [${OBSHTINA}] no new posts (sinceDate=${opts.sinceDate ?? "n/a"}, sinceYear=${startYear})`,
    );
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched,
      candidatesDropped,
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
        kind: "enrich",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const joinTotals = { exact: 0, ambiguous: 0, unmatched: 0, total: 0 };

  console.log(`  [${OBSHTINA}] fetching ${all.length} post(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-per32-"));
  try {
    for (const p of all) {
      // Hoisted so a failure AFTER the href is known is deferred against the
      // DOCUMENT url — the one the resolutions carry as `sourceUrl` — and the
      // ledger entry then clears itself when the protokol finally lands.
      // Keyed on the POST url it never matches `ingestedUrls` and is immortal
      // by construction: протокол №13 stayed on the ledger as "missing" after
      // the .doc route ingested it, which is the ledger asserting something
      // false rather than merely stale.
      let docxUrl: string | undefined;
      try {
        const postHtml = await fetchHtml(p.postUrl);
        docxUrl = findDocxUrl(postHtml) ?? undefined;
        if (!docxUrl) {
          errors.push({
            url: p.postUrl,
            date: p.date,
            kind: "content",
            message: "no .docx link on post page",
          });
          continue;
        }
        const docxPath = join(dir, `pr_${p.session}.docx`);
        await fetchToFile(docxUrl, docxPath);
        const buf = await readFile(docxPath);
        const text = await extractWordText(buf);
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
          url: docxUrl ?? p.postUrl,
          // A body that is not a readable .docx cannot be fixed by
          // re-fetching it — protokol №13/2025 is a Word 97-2003 .doc under
          // a .doc href this parser feeds to the OOXML reader — so it is a
          // `content` skip that the watermark may pass. As `fetch` it capped
          // PER32 at 2025-10-16 and re-wrote 271 unchanged resolutions a run.
          kind: isMalformedArchiveError(err) ? "content" : "fetch",
          date: p.date,
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
