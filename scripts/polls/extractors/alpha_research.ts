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
//
// Pre-2017 posts are a THIRD shape: an empty page linking one Word (or
// PDF) attachment that carries the whole release — passport and shares
// (measured: 871, 890, 918). `acquireText` already converts those
// attachments; this extractor reads them as additional sources (see
// `TextSource`), with stricter share rules for attachment text and a
// `provenance.quoteSources` entry naming the file behind every quote.

import fs from "node:fs";
import path from "node:path";
import { pollId as mintPollId } from "../../../src/data/polls/fieldwork";
import type { PollDetail, PollGenre } from "../../../src/data/polls/pollsTypes";
import { classifyRaces } from "../lib/classify_race";
import { dedupeAcceptedShares } from "../lib/dedupe_shares";
import type { DraftPoll, ParliamentaryInboxDraft } from "../lib/draft";
import {
  gateFields,
  gateShares,
  type Refusal,
  type ShareClaim,
} from "../lib/evidence_gate";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import {
  acquireText,
  acquiredSourceText,
  type AcquiredText,
  extractPageTitle,
} from "../lib/text_acquisition";
import {
  extractSharesBySentenceRule,
  parsePercent,
  percentMatchesIn,
} from "../lib/sentence_rule";

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

// AR states its sample size three different ways across real captures:
// "Обем на извадката: 1000 души" (1044, 1045), "сред 1000 пълнолетни
// граждани" (1043, 1047) and, in the 2013 Word attachment (871), "В
// допитването участват 1025 пълнолетни граждани".
const SAMPLE_SIZE_PATTERNS = [
  /Обем на извадката:?\s*(\d+)\s*души/iu,
  /сред\s+(\d+)\s*пълнолетни/iu,
  /участват\s+(\d+)\s*пълнолетни/iu,
];
// Same split for fieldwork: the shared "Период на провеждане:" label
// (1044, 1045) and AR's own "в периода ..." phrasing (1043, 1047). The
// value runs to the first sentence-ending period or comma, but a period
// followed by a digit is part of a numeric date ("28–30.09. 2014г", 890),
// not a sentence end. A Bulgarian date never contains a comma, and
// stopping there keeps "15-23 януари, сред стратифицирана…" (895) from
// dragging the rest of the sentence into the date candidate.
const FIELDWORK_PATTERNS = [
  /Период на провеждане:?\s*((?:[^.,\n]|\.(?=\s*\d))+)/iu,
  /в периода\s+((?:[^.,\n]|\.(?=\s*\d))+)/iu,
];

// Attachment text gets two rules the article path does not. Measured over
// the 60 AR captures with a Word/PDF attachment, the sentence rule's "first
// percentage after the label" lands on a DIFFERENT statistic far more often
// in these long, discursive documents than in a modern post's narrative —
// "ДПС … (48% я виждат като губеща влияние…)" (902), a referendum figure
// 400 characters on (883), "ГЕРБ … (6 - 7% от анкетираните)" (846). The
// gate cannot see this: the quote really does contain both the label and
// the number. So for attachments:
//  - the number must start within MAX_LABEL_TO_NUMBER_CHARS of the label's
//    start (every real share in the measured set is within ~25), and
//  - an approximate or ranged figure ("около 4.5%", "около и над 2%",
//    "19-20%") is refused — it is not a published share, and storing its
//    upper bound as one would assert a precision the agency never claimed.
// Neither rule catches a SHORT semantic misread ("ПФ и 23% от тези на РБ",
// 897) — that is what operator review is for.
const MAX_LABEL_TO_NUMBER_CHARS = 60;
const APPROXIMATE_BEFORE_NUMBER_RE =
  /(?:около|над|под|между|до|приблизително|почти|\d\s*[-–])\s*$/iu;

const tightenAttachmentClaims = (
  claims: ShareClaim[],
): { kept: ShareClaim[]; refused: Refusal[] } => {
  const kept: ShareClaim[] = [];
  const refused: Refusal[] = [];
  for (const c of claims) {
    const pm = percentMatchesIn(c.quote)[0];
    if (!pm) continue;
    if (pm.index > MAX_LABEL_TO_NUMBER_CHARS) {
      refused.push({
        field: `share:${c.label}`,
        reason: `attachment text: the number is ${pm.index} characters from the party name — too far to be its share`,
        quote: c.quote,
      });
    } else if (APPROXIMATE_BEFORE_NUMBER_RE.test(c.quote.slice(0, pm.index))) {
      refused.push({
        field: `share:${c.label}`,
        reason:
          "attachment text: an approximate or ranged figure, not a published share",
        quote: c.quote,
      });
    } else {
      kept.push(c);
    }
  }
  return { kept, refused };
};

/** One text an extractor can read and ground quotes against: the article
 *  body (`file: null`) or one converted attachment. Pre-2017 AR posts
 *  publish their figures ONLY in a Word attachment linked from an
 *  otherwise empty page (measured: 871, 890, 918), so reading the article
 *  alone produced drafts with no shares and no passport at all. */
interface TextSource {
  file: string | null;
  text: string;
}

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
  preAcquired?: AcquiredText,
): Promise<ParliamentaryInboxDraft> => {
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
  const acquired = preAcquired ?? (await acquireText(captureDir, AGENCY_ID));

  const article: TextSource = { file: null, text: acquired.articleText };
  const attachments: TextSource[] = acquired.pdfTexts
    .map((d) => ({ file: d.file, text: d.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text.length > 0);

  const shareRun = (source: TextSource) => {
    const claims = extractSharesBySentenceRule(source.text);
    const tightened = source.file
      ? tightenAttachmentClaims(claims)
      : { kept: claims, refused: [] };
    const gate = gateShares(tightened.kept, source.text);
    // A mention the tightening refused still COUNTS as a conflicting
    // mention. Without this, refusing one of two disagreeing mentions
    // leaves the other looking uncontested, and `dedupeAcceptedShares`'s
    // "two disagreeing mentions ⇒ refuse" rule never fires — measured, that
    // turned a correctly-refused label into "БСП = 80" (902) and
    // "ГЕРБ = 47.3" (950). So a label is accepted only when every mention of
    // it in this source carries the same number.
    const conflicted = new Set(
      tightened.refused
        .map((r) => {
          const label = r.field.replace(/^share:/, "");
          const pm = percentMatchesIn(r.quote)[0];
          return pm ? { label, value: parsePercent(pm[1]) } : null;
        })
        .filter(
          (r): r is { label: string; value: number } =>
            r !== null &&
            gate.accepted.some(
              (a) => a.label === r.label && a.value !== r.value,
            ),
        )
        .map((r) => r.label),
    );
    const contested: Refusal[] = gate.accepted
      .filter((a) => conflicted.has(a.label))
      .map((a) => ({
        field: `share:${a.label}`,
        reason:
          "attachment text: another mention of this party carries a different number — refusing rather than choosing",
        quote: a.quote,
      }));
    return {
      source,
      gate: {
        ...gate,
        refused: [...tightened.refused, ...contested, ...gate.refused],
      },
      deduped: dedupeAcceptedShares(
        gate.accepted.filter((a) => !conflicted.has(a.label)),
      ),
    };
  };
  // The article wins whenever it carries enough shares on its own — a
  // modern post's narrative is the primary publication, and its PDF (if
  // any) is a longer report that also discusses sub-groups. Only when the
  // article comes up short does an attachment get a say, and then the one
  // yielding the MOST gated shares, never a merge of several: two
  // documents' figures are two publications' figures until proven
  // otherwise, and mixing them would ground each share in a different
  // text with nothing tying them to one survey.
  const articleRun = shareRun(article);
  let chosen = articleRun;
  if (articleRun.deduped.accepted.length < MIN_SHARES_BEFORE_IMAGE_FALLBACK) {
    for (const att of attachments) {
      const run = shareRun(att);
      if (run.deduped.accepted.length > chosen.deduped.accepted.length)
        chosen = run;
    }
  }
  const shareSource = chosen.source;
  const dedupedShares = chosen.deduped;
  const refused: Refusal[] = [...chosen.gate.refused, ...dedupedShares.refused];
  const quotes: Record<string, string> = {};
  // field → attachment filename, for every quote NOT taken from the
  // article body, so a reviewer knows which document to open.
  const quoteSources: Record<string, string> = {};
  const recordQuote = (field: string, quote: string, source: TextSource) => {
    quotes[field] = quote;
    if (source.file) quoteSources[field] = source.file;
  };
  for (const c of dedupedShares.accepted)
    recordQuote(`share:${c.label}`, c.quote, shareSource);

  // Passport fields are looked up in the share source first (the survey
  // the shares belong to states its own sample and dates), then the
  // article, then any other attachment.
  const searchOrder: TextSource[] = [
    shareSource,
    ...[article, ...attachments].filter((s) => s !== shareSource),
  ];

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

  const race = "parliamentary" as const;
  // This extractor only knows how to build a PARLIAMENTARY-shaped draft
  // (party shares, no candidate/placeholder/runoff extraction) — Tier 4b
  // plans to reuse it for AR's own presidential captures (decision 10's
  // "the same extractors, nothing here is a second pipeline"), but that
  // arm is not built yet. Throwing here, rather than silently returning a
  // `PollDetail[]`-shaped "presidential" draft, is what keeps `InboxDraft`
  // a real discriminated union: a caller narrowing on `draft.race` must
  // never see a draft whose `details` don't match its own `race`. The
  // fast path above already caught a title-obvious case; this is the
  // rare title-ambiguous, body-resolved backstop.
  if (
    !classifyRaces(title, acquiredSourceText(acquired)).includes(
      "parliamentary",
    )
  ) {
    throw new Error(
      `extractAlphaResearch(${pubId}): classifyRace resolved "${race}" for this capture — ` +
        `this extractor only builds parliamentary drafts`,
    );
  }

  // The genre is a property of the SHARES, so it is read from the share
  // source only — never from an unrelated attachment.
  const baseMatch = BASE_PHRASE_RE.exec(shareSource.text);
  const genreSentence = baseMatch
    ? sentenceAt(shareSource.text, baseMatch.index)
    : "";
  const forecastMatch = genreSentence ? FORECAST_RE.exec(genreSentence) : null;
  const genre: PollGenre = forecastMatch
    ? "forecast"
    : baseMatch
      ? "raw_attitudes"
      : "unclear";
  const basePhrase = baseMatch?.[0] ?? null;
  if (forecastMatch) recordQuote("forecastPhrase", genreSentence, shareSource);

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
  //
  // The uniqueness rule applies WITHIN one source: the first source in
  // `searchOrder` with any candidate decides, so a press release and the
  // longer report it summarises do not count as "two disagreeing sample
  // sizes" merely for both stating the same survey's n.
  let sampleSource: TextSource = shareSource;
  let sampleSizeMatches: RegExpExecArray[] = [];
  for (const source of searchOrder) {
    const found = SAMPLE_SIZE_PATTERNS.flatMap((re) =>
      findAllMatches(source.text, re),
    );
    if (found.length > 0) {
      sampleSource = source;
      sampleSizeMatches = found;
      break;
    }
  }
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
      sampleSource.text,
    );
    if (gated.accepted.length > 0) {
      respondents = sampleSize.value;
      recordQuote("sampleSize", sampleSize.quote, sampleSource);
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
  const fieldworkCandidates = searchOrder.flatMap((source) =>
    FIELDWORK_PATTERNS.flatMap((re) =>
      findAllMatches(source.text, re).map(
        (m): TextField<string> & { source: TextSource } => ({
          value: m[1].trim(),
          quote: m[0].trim(),
          source,
        }),
      ),
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
      candidate.source.text,
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
    recordQuote("fieldwork", candidate.quote, candidate.source);
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
      ...(Object.keys(quoteSources).length > 0 ? { quoteSources } : {}),
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
