// Tier 2c — the Alpha Research deterministic extractor (§6.2). Unlike
// Trend, AR's passport (sample size, fieldwork) is published IN the
// `#content` article text, never image-only — but AR's PARTY SHARES are
// the opposite of Trend's: roughly half of AR's real posts (measured:
// 1043 and 1047 carry a full narrative; 1044 and 1045 carry NONE — every
// share is rendered solely inside `GraphN.jpg` chart images, decision 18).
//
// This extractor covers the text-based path completely (shares, passport,
// genre, race) and, for a chart-only post, explicitly flags that the
// (not yet built) Gemini Vision fallback is needed rather than attempting
// to parse the chart images itself — measured live, tesseract's OCR of
// AR's electoral-attitudes chart is too noisy to trust ("герв-сдс и
// РННННННННЯ 20 те.", "меч. ДД з зе,"): every number is visibly garbled,
// and running it through the sentence rule would either refuse almost
// everything (the safe outcome, near-zero recall) or — worse — happen to
// produce a plausible-looking wrong number the gate cannot distinguish
// from a real one. Decision 5's "< 3 shares" trigger is exactly this
// case; the fallback itself is Tier 2c's own stated follow-up, not yet
// shipped.

import fs from "node:fs";
import path from "node:path";
import { pollId as mintPollId } from "../../../src/data/polls/fieldwork";
import type { PollDetail, PollGenre } from "../../../src/data/polls/pollsTypes";
import { classifyRace } from "../lib/classify_race";
import { dedupeAcceptedShares } from "../lib/dedupe_shares";
import type { DraftPoll, InboxDraft } from "../lib/draft";
import { gateFields, gateShares, type Refusal } from "../lib/evidence_gate";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import { acquireText, extractPageTitle } from "../lib/text_acquisition";
import { extractSharesBySentenceRule } from "../lib/sentence_rule";

const AGENCY_ID = "AR";

// A poll with fewer accepted shares than this, while chart images exist,
// is a chart-only post (decision 5/18) rather than a text extraction
// that merely came up short.
const MIN_SHARES_BEFORE_IMAGE_FALLBACK = 3;

// Two real base-phrase families, measured across all 4 real captures:
// 1043 ("...32.6% от гласуващите"), 1047 ("...от сигурните, че ще
// гласуват в неделя"). Neither of the two chart-only posts (1044, 1045)
// states a base phrase in TEXT at all — it is visible only on the chart
// image's own subtitle ("сред твърдо решилите да гласуват"), which this
// extractor does not reach (see the header). The trailing context is
// bounded by a NON-decimal period, same rule as sentence_rule.ts's
// SENTENCE_END_RE and for the same reason — a plain `[^.]` class would
// truncate "с 19.7%" right after "19".
const BASE_PHRASE_RE =
  /(?:от|сред)\s+(?:сигурните,?\s+че\s+ще\s+гласуват|гласуващите|заявилите)(?:(?!\.(?!\d))[\s\S]){0,50}/iu;
// No AR forecast-genre post has been measured yet, so this is watched for
// but not yet exercised by a real fixture. Checked ONLY within the same
// sentence as the base phrase (never the whole document) — AR's long,
// discursive posts routinely mention an unrelated economic/demographic
// "прогноза" elsewhere in the same article (measured: 1043's real text
// covers protest sentiment, presidential approval and much else besides
// the vote-intent finding), and an unscoped check would flip the WHOLE
// poll's genre on that unrelated mention.
const FORECAST_RE = /прогноз(?:а|ен резултат)/iu;

const SENTENCE_BOUNDARY_RE = /[!?]|\.(?!\d)/g;

/** The sentence containing position `at` in `text` — from just after the
 *  previous sentence-ending punctuation (or the start) through the next
 *  one (or the end). Mirrors sentence_rule.ts's own decimal-point rule. */
const sentenceAt = (text: string, at: number): string => {
  SENTENCE_BOUNDARY_RE.lastIndex = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_BOUNDARY_RE.exec(text)) && m.index < at) {
    start = m.index + 1;
  }
  SENTENCE_BOUNDARY_RE.lastIndex = start;
  const end = SENTENCE_BOUNDARY_RE.exec(text)?.index ?? text.length;
  return text.slice(start, end);
};

// AR states its sample size two different ways across real captures:
// "Обем на извадката: 1000 души" (1044, 1045) and "сред 1000 пълнолетни
// граждани" (1043, 1047). Tried in order, first match wins.
const SAMPLE_SIZE_PATTERNS = [
  /Обем на извадката:?\s*(\d+)\s*души/iu,
  /сред\s+(\d+)\s*пълнолетни/iu,
];
// Same two-family split for fieldwork: the shared "Период на
// провеждане:" label (1044, 1045) and AR's own "в периода ..." phrasing
// (1043, 1047).
const FIELDWORK_PATTERNS = [
  /Период на провеждане:?\s*([^.\n]+)/iu,
  /в периода\s+([^.\n]+)/iu,
];

interface SourceStamp {
  url: string;
  fetchedAt: string;
  sha256: string;
  archiveUrl?: string;
}

interface TextField<T> {
  value: T;
  quote: string;
}

/** Every match of `re` in `text`, regardless of whether `re` itself
 *  carries the `g` flag. */
const findAllMatches = (text: string, re: RegExp): RegExpExecArray[] => {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return [...text.matchAll(new RegExp(re.source, flags))];
};

// `fetch.ts` writes page.html FIRST and SOURCE.json LAST, so an
// interrupted `polls:fetch` run can leave a capture with page.html
// present and SOURCE.json absent or truncated — a predictable
// partial-write shape. Named per capture/publication rather than a bare
// ENOENT (same fix as trend.ts's own extractor).
const readCaptureFile = (
  captureDir: string,
  pubId: string,
  name: string,
): string => {
  try {
    return fs.readFileSync(path.join(captureDir, name), "utf8");
  } catch (e) {
    throw new Error(
      `extractAlphaResearch(${pubId}): missing or unreadable ${name} in ${captureDir} ` +
        `(a partial polls:fetch run?): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

/**
 * `captureDir` is one `polls:fetch` capture (e.g.
 * `raw_data/polls/alpha_research/1047`); `pubId` is that publication's
 * own id, used only to mint a provisional poll id when the fieldwork end
 * date cannot be resolved.
 */
export const extractAlphaResearch = async (
  captureDir: string,
  pubId: string,
): Promise<InboxDraft> => {
  const html = readCaptureFile(captureDir, pubId, "page.html");
  const stamp = JSON.parse(
    readCaptureFile(captureDir, pubId, "SOURCE.json"),
  ) as SourceStamp;
  if (!stamp.url || !stamp.sha256 || !stamp.fetchedAt) {
    throw new Error(
      `extractAlphaResearch(${pubId}): SOURCE.json in ${captureDir} is missing a required field (url/sha256/fetchedAt)`,
    );
  }
  const title = extractPageTitle(html);
  const acquired = await acquireText(captureDir, AGENCY_ID);

  const shareCandidates = extractSharesBySentenceRule(acquired.articleText);
  const sharesGate = gateShares(shareCandidates, acquired.articleText);
  const dedupedShares = dedupeAcceptedShares(sharesGate.accepted);
  const refused: Refusal[] = [...sharesGate.refused, ...dedupedShares.refused];
  const quotes: Record<string, string> = {};
  for (const c of dedupedShares.accepted) quotes[`share:${c.label}`] = c.quote;

  // `imageTexts.length > 0` alone barely discriminates for AR — measured,
  // EVERY one of the 4 real captures carries `Graph*.jpg` files,
  // including the two full-narrative posts that need none of them. A
  // chart that `looksLikeLabelledTable` (text_acquisition.ts's own
  // pre-gate, generalised from Sova Harris's "≥4 party labels" rule) is
  // a much better proxy that an image plausibly CARRIES a shares table,
  // rather than merely existing on the page.
  const tableLikeImages = acquired.imageTexts.filter(
    (t) => t.looksLikeTable,
  ).length;
  if (
    dedupedShares.accepted.length < MIN_SHARES_BEFORE_IMAGE_FALLBACK &&
    tableLikeImages > 0
  ) {
    refused.push({
      field: "shares",
      reason:
        `text yielded only ${dedupedShares.accepted.length} share(s) and ` +
        `${tableLikeImages} chart image(s) look like a labelled table — likely a ` +
        `chart-only post (decision 18); the Gemini Vision fallback this needs is not yet built`,
      quote: "",
    });
  }

  const race = classifyRace(title, acquired.articleText);

  const baseMatch = BASE_PHRASE_RE.exec(acquired.articleText);
  const genreSentence = baseMatch
    ? sentenceAt(acquired.articleText, baseMatch.index)
    : "";
  const forecastMatch = genreSentence ? FORECAST_RE.exec(genreSentence) : null;
  const genre: PollGenre = forecastMatch
    ? "forecast"
    : baseMatch
      ? "raw_attitudes"
      : "unclear";
  const basePhrase = baseMatch?.[0] ?? null;
  if (forecastMatch) quotes.forecastPhrase = genreSentence;

  // Every candidate across BOTH sample-size patterns, not just the first
  // pattern's first match — AR's long narratives sometimes discuss a
  // sub-group's own sample ("сред 500 пълнолетни столичани") ahead of
  // the poll's real, overall sample size, and the two look identical to
  // a single-pattern, first-match search. `gateFields`'s grounding check
  // cannot catch this: a matched quote is by construction a literal
  // substring of the source, so any real occurrence — right or wrong —
  // grounds equally. Exactly ONE candidate across all patterns is
  // required before it is trusted at all; more than one is refused,
  // mirroring `dedupe_shares.ts`'s "two disagreeing mentions ⇒ refuse,
  // never guess" rule.
  const sampleSizeMatches = SAMPLE_SIZE_PATTERNS.flatMap((re) =>
    findAllMatches(acquired.articleText, re),
  );
  let respondents: number | null = null;
  if (sampleSizeMatches.length === 1) {
    const m = sampleSizeMatches[0];
    const sampleSize: TextField<number> = { value: Number(m[1]), quote: m[0] };
    const gated = gateFields(
      [
        {
          field: "sampleSize",
          value: sampleSize.value,
          quote: sampleSize.quote,
        },
      ],
      acquired.articleText,
    );
    if (gated.accepted.length > 0) {
      respondents = sampleSize.value;
      quotes.sampleSize = sampleSize.quote;
    } else {
      refused.push(...gated.refused);
    }
  } else if (sampleSizeMatches.length > 1) {
    refused.push({
      field: "sampleSize",
      reason: `${sampleSizeMatches.length} candidate sample sizes found — refusing rather than guessing which is the poll's own`,
      quote: sampleSizeMatches.map((m) => m[0]).join(" | "),
    });
  } else {
    refused.push({
      field: "sampleSize",
      reason: "no sample-size pattern matched the extracted text",
      quote: "",
    });
  }

  // Same multi-candidate risk as sample size, but fieldwork has a natural
  // RETRY mechanism sample size doesn't: a candidate that fails to parse
  // as a real date range (`parseBgFieldworkRange`) is conclusively not
  // the real fieldwork statement, so the next candidate is tried rather
  // than giving up — a decoy phrase like "в периода на предизборната
  // кампания" (no date follows "периода" at all) fails to parse and is
  // skipped, so a real, later "в периода 1-5 март 2026г." in the same
  // document is still found. Two candidates that BOTH parse to DIFFERENT
  // real dates would still silently take the first — a rarer, compound
  // case not guarded against here.
  const fieldworkCandidates = FIELDWORK_PATTERNS.flatMap((re) =>
    findAllMatches(acquired.articleText, re).map(
      (m): TextField<string> => ({ value: m[1].trim(), quote: m[0] }),
    ),
  );
  let fieldwork: string | null = null;
  let fieldworkStart: string | null = null;
  let fieldworkEnd: string | null = null;
  const fieldworkFailures: Refusal[] = [];
  for (const candidate of fieldworkCandidates) {
    const gated = gateFields(
      [
        {
          field: "fieldwork",
          value: candidate.value,
          quote: candidate.quote,
        },
      ],
      acquired.articleText,
    );
    if (gated.accepted.length === 0) {
      fieldworkFailures.push(...gated.refused);
      continue;
    }
    const parsed = parseBgFieldworkRange(candidate.value);
    if (!parsed) {
      fieldworkFailures.push({
        field: "fieldwork",
        reason: `could not parse a date range from "${candidate.value}"`,
        quote: candidate.quote,
      });
      continue;
    }
    fieldwork = parsed.fieldwork;
    fieldworkStart = parsed.startIso;
    fieldworkEnd = parsed.endIso;
    quotes.fieldwork = candidate.quote;
    break;
  }
  if (!fieldwork) refused.push(...fieldworkFailures);

  // A poll id NEEDS the fieldwork end date — see trend.ts's identical
  // rule for the full reasoning (provisional ids cannot collide with a
  // real one, and are disposable once a real one resolves).
  const id = fieldworkEnd
    ? mintPollId(AGENCY_ID, fieldworkEnd)
    : `${AGENCY_ID.toLowerCase()}-pub-${pubId}`;
  if (!fieldworkEnd) {
    refused.push({
      field: "poll.id",
      reason:
        "no fieldwork end date resolved from the text — using a provisional pubId-keyed id",
      quote: "",
    });
  }

  const poll: DraftPoll = {
    id,
    agencyId: AGENCY_ID,
    source: stamp.url,
    electionDate: null,
    respondents,
    genre,
    ...(fieldwork ? { fieldwork } : {}),
    provenance: {
      url: stamp.url,
      ...(stamp.archiveUrl ? { archiveUrl: stamp.archiveUrl } : {}),
      fetchedAt: stamp.fetchedAt,
      sha256: stamp.sha256,
      extractor: AGENCY_ID,
      fieldworkStart,
      fieldworkEnd,
      basePhrase,
      quotes,
    },
  };

  const details: PollDetail[] = dedupedShares.accepted.map((c) => ({
    pollId: id,
    agencyId: AGENCY_ID,
    support: c.value,
    nickName_bg: c.label,
    nickName_en: "",
  }));

  return {
    race,
    poll,
    details,
    residual: null,
    genre,
    extractor: AGENCY_ID,
    evidence: quotes,
    refused,
  };
};
