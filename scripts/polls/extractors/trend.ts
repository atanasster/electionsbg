// Tier 2c — the Trend deterministic extractor (§6.2). Reads a capture
// directory (`raw_data/polls/trend/<pubId>/`, written by `polls:fetch`)
// and produces an `InboxDraft`: shares from the sentence rule over the
// article text, the passport (sample size + fieldwork) from OCR'ing
// whichever Slide image carries it — decision 18: TR's passport is
// published ONLY as an image, never in the `.et_pb_text_inner` narrative
// that carries the party shares — genre from the base phrase (decision
// 8), and race from `classifyRace` (decision 11).
//
// KNOWN RESIDUAL LIMITATION, measured across all 3 real captures: a
// SHORT (3-letter) label that is the LAST party mentioned before its
// sentence ends, with nothing trailing the closing paren/percent
// ("МЕЧ (3,6%)." with nothing else in that clause), still normalises
// under `MIN_QUOTE_CHARS` and is refused — `sentence_rule.ts`'s quote
// already extends to the full clause boundary, and there is no more of
// that clause left to extend into. Accepted for v1 as a conservative,
// visible refusal (never a wrong value) rather than padding the quote
// with text from an ADJACENT clause, which would re-open exactly the
// misattribution risk the boundary rule exists to close.

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

const AGENCY_ID = "TR";

// Measured across all 3 real 2026 captures (212637, 212732, 212750) —
// three distinct real phrasings, each recorded verbatim into
// `provenance.basePhrase` when matched. TR has not been observed
// publishing anything but this genre; no match means "unclear", never a
// guessed default (decision 8).
const BASE_PHRASE_RE =
  /подкрепа(?:та)?\s+(?:на\s+[\d.,]+%\s+)?(?:от|сред)\s+(?:заявилите|заявяващите|гласуващите)[^.]{0,50}/iu;

// Both measured verbatim on the real passport slides (Slide2.png,
// OCR'd) — "1002 ефективни интервюта" / "1004 ефективни интервюта" and
// "Период на провеждане: 12-18 февруари 2026 г." / "...13-16 април 2026 г.".
const SAMPLE_SIZE_RE = /(\d+)\s*ефективни\s+интервюта/iu;
const FIELDWORK_LABEL_RE = /Период на провеждане:?\s*([^.\n]+)/iu;

interface SourceStamp {
  url: string;
  fetchedAt: string;
  sha256: string;
  archiveUrl?: string;
}

interface OcrField<T> {
  value: T;
  quote: string;
}

/** Scans every OCR'd image's text (in order) for `re`, returning the FIRST
 *  match — TR's passport (Slide2, by convention today) and its chart
 *  (Slide3, noisy and never used for this) are two separate images, and
 *  this deliberately doesn't assume which slide number carries which:
 *  it asks each image's own text directly. */
const findInOcrTexts = <T>(
  texts: { text: string }[],
  re: RegExp,
  extract: (m: RegExpExecArray) => T,
): OcrField<T> | null => {
  for (const { text } of texts) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return { value: extract(m), quote: m[0] };
  }
  return null;
};

/**
 * `captureDir` is one `polls:fetch` capture (e.g.
 * `raw_data/polls/trend/212750`); `pubId` is that publication's own id,
 * used only to mint a provisional poll id when the fieldwork end date
 * cannot be resolved (see below).
 */
// `fetch.ts` writes page.html FIRST and SOURCE.json LAST (attachments in
// between), so an interrupted `polls:fetch` run (killed process, crashed
// machine) can leave a capture directory with page.html present and
// SOURCE.json absent or truncated — a predictable partial-write shape,
// not an exotic one. Reading it bare would throw a contextless ENOENT/
// SyntaxError with no indication of which capture or publication failed;
// this names both.
const readCaptureFile = (
  captureDir: string,
  pubId: string,
  name: string,
): string => {
  try {
    return fs.readFileSync(path.join(captureDir, name), "utf8");
  } catch (e) {
    throw new Error(
      `extractTrend(${pubId}): missing or unreadable ${name} in ${captureDir} ` +
        `(a partial polls:fetch run?): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

export const extractTrend = async (
  captureDir: string,
  pubId: string,
): Promise<InboxDraft> => {
  const html = readCaptureFile(captureDir, pubId, "page.html");
  const stamp = JSON.parse(
    readCaptureFile(captureDir, pubId, "SOURCE.json"),
  ) as SourceStamp;
  if (!stamp.url || !stamp.sha256 || !stamp.fetchedAt) {
    throw new Error(
      `extractTrend(${pubId}): SOURCE.json in ${captureDir} is missing a required field (url/sha256/fetchedAt)`,
    );
  }
  const title = extractPageTitle(html);
  const acquired = await acquireText(captureDir, AGENCY_ID);

  const shareCandidates = extractSharesBySentenceRule(acquired.articleText);
  const sharesGate = gateShares(shareCandidates, acquired.articleText);
  // A label mentioned more than once (a headline restating a number the
  // body also gives) is reconciled AFTER gating, not before — a claim
  // that failed grounding for its own reason must never suppress a
  // sibling mention that passed.
  const dedupedShares = dedupeAcceptedShares(sharesGate.accepted);
  const refused: Refusal[] = [...sharesGate.refused, ...dedupedShares.refused];
  const quotes: Record<string, string> = {};
  for (const c of dedupedShares.accepted) quotes[`share:${c.label}`] = c.quote;

  const race = classifyRace(title, acquired.articleText);

  const baseMatch = BASE_PHRASE_RE.exec(acquired.articleText);
  const genre: PollGenre = baseMatch ? "raw_attitudes" : "unclear";
  const basePhrase = baseMatch?.[0] ?? null;

  // Both passport fields are gated against the FULL OCR'd text (every
  // image's transcription joined) — never against the claim's own quote,
  // which would ground the quote against itself and always pass
  // regardless of what the quote actually says (a tautology, not a
  // check) — and never against the article text, since decision 18's
  // passport-is-image-only rule means the passport is never there.
  const ocrText = acquired.imageTexts.map((t) => t.text).join("\n");

  const sampleSize = findInOcrTexts(acquired.imageTexts, SAMPLE_SIZE_RE, (m) =>
    Number(m[1]),
  );
  let respondents: number | null = null;
  if (sampleSize) {
    const gated = gateFields(
      [
        {
          field: "sampleSize",
          value: sampleSize.value,
          quote: sampleSize.quote,
        },
      ],
      ocrText,
    );
    if (gated.accepted.length > 0) {
      respondents = sampleSize.value;
      quotes.sampleSize = sampleSize.quote;
    } else {
      refused.push(...gated.refused);
    }
  }

  // Gated on the RAW extracted date-range text ("12-18 февруари 2026 г"),
  // never on `formatFieldwork`'s OWN output ("Feb 12-18 2026") — that
  // English string can never literally occur in a Bulgarian quote, so
  // gating the translated form would refuse every real fieldwork date.
  // The translation itself is verified by a different mechanism entirely
  // (`parseBgFieldworkRange` either produces a real, representable date
  // or returns null) — the gate's job here is only "does this quote
  // really say what we claim the raw text is".
  const fieldworkRaw = findInOcrTexts(
    acquired.imageTexts,
    FIELDWORK_LABEL_RE,
    (m) => m[1].trim(),
  );
  let fieldwork: string | null = null;
  let fieldworkStart: string | null = null;
  let fieldworkEnd: string | null = null;
  if (fieldworkRaw) {
    const gated = gateFields(
      [
        {
          field: "fieldwork",
          value: fieldworkRaw.value,
          quote: fieldworkRaw.quote,
        },
      ],
      ocrText,
    );
    if (gated.accepted.length > 0) {
      const parsed = parseBgFieldworkRange(fieldworkRaw.value);
      if (parsed) {
        fieldwork = parsed.fieldwork;
        fieldworkStart = parsed.startIso;
        fieldworkEnd = parsed.endIso;
        quotes.fieldwork = fieldworkRaw.quote;
      } else {
        refused.push({
          field: "fieldwork",
          reason: `could not parse a date range from "${fieldworkRaw.value}"`,
          quote: fieldworkRaw.quote,
        });
      }
    } else {
      refused.push(...gated.refused);
    }
  }

  // A poll id NEEDS the fieldwork end date (`pollId`'s own contract) — an
  // unresolved passport (a bad OCR pass, a redesigned slide) gets a
  // PROVISIONAL id keyed on the publication itself instead of silently
  // having no id at all, flagged so the operator knows it is provisional.
  // The `-pub-` segment can never occur inside a real `mintPollId` shape
  // (`<agency>-<ISO date>`), so the two id spaces cannot collide — but a
  // provisional draft is DISPOSABLE, not a permanent alternate identity:
  // once a later re-extraction resolves a real fieldwork date for the
  // same `pubId`, whatever writes drafts to disk (`polls:extract`, not
  // yet built) must treat the old `tr-pub-<pubId>` file as superseded and
  // remove it, rather than leaving two drafts describing one publication.
  const id = fieldworkEnd
    ? mintPollId(AGENCY_ID, fieldworkEnd)
    : `${AGENCY_ID.toLowerCase()}-pub-${pubId}`;
  if (!fieldworkEnd) {
    refused.push({
      field: "poll.id",
      reason:
        "no fieldwork end date resolved from the passport — using a provisional pubId-keyed id",
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
    // Not resolved here — an English translation cannot be verified
    // against a Bulgarian source quote, so it is left for the operator
    // at `polls:accept` time rather than fabricated.
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
