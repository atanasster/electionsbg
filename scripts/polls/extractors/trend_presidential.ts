// Tier 4b — the Trend deterministic PRESIDENTIAL extractor. `trend.ts`
// (parliamentary) explicitly refuses a presidential-race capture with two
// guard-throws citing "Tier 4b is not built yet" — this is that build,
// as a SIBLING file rather than a branch inside `trend.ts` itself, mirroring
// how `extractGlobalMetrics` (presidential) stands alone from any
// hypothetical GM-parliamentary extractor: the two races' row-extraction
// rules are different enough (a party-label registry vs. a candidate-name
// shape) that sharing one function body would mean branching through most
// of it, not reusing it.
//
// Built for Tier 4b's historical backfill (docs/plans/polls-agency-watchers
// -v1.md) against TWO real, structurally different captures:
//
//   - 2016 (raw_data/polls/trend/a63a09b7af8f2976): a PRESIDENTIAL-ONLY
//     page. No passport images at all — sample size ("проведено сред 1004
//     души") and fieldwork ("между 19 и 26 октомври 2016 г.") are both
//     stated in the article's own PROSE, not an image.
//   - 2021 (raw_data/polls/trend/a19cfbc0c6dad528): a JOINT page covering
//     BOTH the parliamentary and presidential races on one release. The
//     passport (sample size, fieldwork) is image-only here, matching
//     `trend.ts`'s own decision-18 convention — but the candidate shares
//     themselves are still read from the ARTICLE TEXT, not the OCR'd
//     slide, because the slide's OCR mangles the % sign on nearly every
//     row ("46.896," for "46.8%,") while the article states the exact
//     same numbers in clean, quote-gateable prose.
//
// Both realities mean this extractor tries PROSE first for every field and
// falls back to the OCR'd passport only when the prose has nothing —
// the reverse of decision 18's original assumption that TR's passport is
// "ONLY ever in an image, never in article text", which held for every
// PARLIAMENTARY capture measured but not for 2016's presidential one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pollId as mintPollId } from "../../../src/data/polls/fieldwork";
import type {
  PollGenre,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
import {
  type ResolvableTicket,
  resolveCandidate,
} from "../presidential/candidate_resolver";
import {
  classifyRace,
  classifyTitle,
  PARLIAMENTARY_RE,
} from "../lib/classify_race";
import { extractCandidateSharesBySentenceRule } from "../lib/candidate_name_rule";
import { dedupeAcceptedShares } from "../lib/dedupe_shares";
import type { DraftPoll, PresidentialInboxDraft } from "../lib/draft";
import {
  gateFields,
  gateSharesEitherDirection,
  type Refusal,
} from "../lib/evidence_gate";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import { acquireText, extractPageTitle } from "../lib/text_acquisition";

const AGENCY_ID = "TR";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

interface SourceStamp {
  url: string;
  fetchedAt: string;
  sha256: string;
  archiveUrl?: string;
}

const readCaptureFile = (
  captureDir: string,
  pubId: string,
  name: string,
): string => {
  try {
    return fs.readFileSync(path.join(captureDir, name), "utf8");
  } catch (e) {
    throw new Error(
      `extractTrendPresidential(${pubId}): missing or unreadable ${name} in ${captureDir} ` +
        `(a partial polls:fetch run?): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

// TR's convention on a JOINT release (measured on the real 2021 capture):
// the parliamentary section always closes with an explicit declared-
// turnout sentence naming that race ("Декларативната избирателна
// активност за предстоящите предсрочни парламентарни избори е 55%.")
// immediately before the presidential discussion begins. A bare mention
// of "парламентарни избори" ANYWHERE in the text is deliberately NOT used
// as the cutoff — the real 2016 presidential-ONLY capture states, later
// than its own candidate ranking and unrelated to it, "тествахме...
// нагласата... за нов парламентарен вот" (a hypothetical-early-election
// aside), which a bare last-mention rule would misread as "the
// parliamentary section ends here" and cut the real candidate paragraph
// out of what follows. `PARLIAMENTARY_RE` is reused (not restated) so this
// stays in step with `classify_race.ts`'s own phrase definition.
// ⚠️ `PARLIAMENTARY_RE.source` is itself an alternation (`A|B`) — spliced
// in bare, `|` regex-alternation's own lowest-precedence rule would split
// this whole pattern into FOUR independent branches instead of the two
// intended compound phrases, two of which are `PARLIAMENTARY_RE`'s own
// bare "народно събрание" branch with NO turnout context required at all.
// That reintroduces the exact bug this file's own header warns about —
// verified by reproduction (removing the wrapper drops `details.length`
// from 9 to 0 on the real 2016 capture): `presidentialSection()` keeps the
// position of the LAST match as its cut point, and the bare
// "парламентарн...избор" branch matches TWICE, well AFTER the candidate
// ranking ("...тествахме и нагласата на хората за нов парламентарен
// вот.", "...не са необходими предсрочни парламентарни избори..."), so
// the cut lands past the whole candidate paragraph and discards it. The
// capture's earlier, also-unrelated "Народното събрание" mention (before
// the candidate list) is a real instance of the same underlying risk —
// an unguarded bare stem match anywhere in the document can invalidate
// the cut — but it is these two LATER mentions that drive this specific
// capture's failure, since the cut point tracks the last match, not the
// first. The `(?:...)` wrapper is load-bearing either way.
const PARLIAMENTARY_TURNOUT_RE = new RegExp(
  `избирателна активност[^.]{0,80}(?:${PARLIAMENTARY_RE.source})|(?:${PARLIAMENTARY_RE.source})[^.]{0,80}избирателна активност`,
  "giu",
);

/** The presidential-specific slice of `articleText` — everything AFTER the
 *  last declared-turnout-for-parliament sentence, or the WHOLE text when
 *  no such sentence exists (a presidential-only release, 2016's shape).
 *  Without this, a joint release's own PARLIAMENTARY numbers ("Демократична
 *  България... 9.1%", "Красимир Каракачанов... 2.2%" — both measured live
 *  in the real 2021 capture) would be misread as presidential candidate
 *  rows: both are genuinely name-shaped AND have exactly one adjacent
 *  percentage, so nothing else in this extractor's evidence-gate discipline
 *  would catch them. */
const presidentialSection = (articleText: string): string => {
  const re = new RegExp(
    PARLIAMENTARY_TURNOUT_RE.source,
    PARLIAMENTARY_TURNOUT_RE.flags,
  );
  let cutAfter: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(articleText))) cutAfter = m.index + m[0].length;
  return cutAfter === null ? articleText : articleText.slice(cutAfter);
};

// Both measured verbatim on the real captures: 2016's "27,3% от
// заявилите, че ще гласуват" and 2021's "24.4% от гласуващите" — the same
// "share of those who say they'll vote" framing `trend.ts`'s own
// (differently-worded) BASE_PHRASE_RE captures for the parliamentary
// side. No match means "unclear", never a guessed default (decision 8).
const BASE_PHRASE_RE =
  /от\s+(?:заявилите|гласуващите)(?:,\s*че\s+ще\s+гласуват)?/iu;

// The OCR'd-passport shape, reused verbatim from `trend.ts` — TR's
// passport slide states both fields identically regardless of race
// (measured: 2021's Slide2.png carries the same "N ефективни интервюта" /
// "Период на провеждане: ..." labels as every parliamentary passport).
const OCR_SAMPLE_SIZE_RE = /(\d+)\s*ефективни\s+интервюта/iu;
const OCR_FIELDWORK_LABEL_RE = /Период на провеждане:?\s*([^.\n]+)/iu;

// The PROSE shape, measured only on the real 2016 capture (a presidential-
// only page with no passport image at all) — "проведено сред 1004 души,
// интервюирани лице в лице.".
const PROSE_SAMPLE_SIZE_RE = /сред\s+(\d+)\s+души/iu;
// "между 19 и 26 октомври 2016 г." — an "и"-separated range, a shape
// `parseBgFieldworkRange` does not accept (its three documented shapes are
// all hyphen-separated); normalised to "19-26 октомври 2016 г." before
// handing off to that shared parser rather than widening its own accepted
// grammar for a form only this one prose source has been measured to use.
const PROSE_FIELDWORK_RE =
  /между\s+(\d{1,2})\s+и\s+(\d{1,2})\s+([а-я]+)\s+(\d{4})\s*г\.?/iu;

/** `candidate_name_rule.ts`'s own abstention match is whatever case the
 *  source text happened to use ("не подкрепям никого" mid-sentence, "Не
 *  подкрепям никого" sentence-initial) — this is the ONE fixed, correctly
 *  capitalized display form, used consistently for both `quotes`' key and
 *  `candidateName_bg` so the two never disagree about this row's name. */
const ABSTENTION_DISPLAY_BG = "Не подкрепям никого";
const isAbstentionLabel = (label: string): boolean =>
  label.trim().toLowerCase() === "не подкрепям никого";
const displayLabel = (rawLabel: string): string =>
  isAbstentionLabel(rawLabel) ? ABSTENTION_DISPLAY_BG : rawLabel;

interface OcrField<T> {
  value: T;
  quote: string;
}

/** Scans every OCR'd image's text (in order) for `re`, returning the
 *  FIRST match — same helper `trend.ts` uses for its own passport read. */
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

// The round-1 folder id shape (`data/<date>_pvr/`) — same rule
// `rekey.ts`'s own `CYCLE_ID_RE` enforces.
const PVR_CYCLE_DIR_RE = /^(\d{4})_(\d{2})_(\d{2})_pvr$/;

/** The presidential cycle a poll with this `fieldworkEndIso` was almost
 *  certainly polling FOR — the EARLIEST `data/<cycle>_pvr` directory whose
 *  own date is on or after the poll's fieldwork end (a poll's fieldwork
 *  always closes before the election it polls). Reads the folder name
 *  only — no need to open any file to know a cycle's own date, since the
 *  directory name IS the date (`YYYY_MM_DD_pvr`). Returns `null` when no
 *  cycle qualifies (fieldwork past every registered cycle, or the corpus
 *  has none yet) rather than guessing the nearest one either way. */
const resolveCycleForFieldworkEnd = (
  fieldworkEndIso: string,
): string | null => {
  const dataDir = path.join(REPO_ROOT, "data");
  const candidates = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && PVR_CYCLE_DIR_RE.test(e.name))
    .map((e) => {
      const m = PVR_CYCLE_DIR_RE.exec(e.name)!;
      return { cycleId: e.name, dateIso: `${m[1]}-${m[2]}-${m[3]}` };
    })
    .filter((c) => c.dateIso >= fieldworkEndIso)
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return candidates[0]?.cycleId ?? null;
};

/** `data/<cycleId>/tickets.json`'s own ticket rows, or `[]` when the file
 *  does not exist — a cycle folder existing (checked by
 *  `resolveCycleForFieldworkEnd` above) does not guarantee ЦИК's own
 *  ticket registration file has been placed inside it. An empty return
 *  degrades every candidate to a `provisional:` key via `resolveCandidate`
 *  itself, never a thrown error — same "refuse rather than guess" shape
 *  decision 16 already specifies for a cycle with no tickets at all. */
const loadTicketsForCycle = (cycleId: string): ResolvableTicket[] => {
  const file = path.join(REPO_ROOT, "data", cycleId, "tickets.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    tickets?: ResolvableTicket[];
  };
  return parsed.tickets ?? [];
};

export const extractTrendPresidential = async (
  captureDir: string,
  pubId: string,
): Promise<PresidentialInboxDraft> => {
  const html = readCaptureFile(captureDir, pubId, "page.html");
  const stamp = JSON.parse(
    readCaptureFile(captureDir, pubId, "SOURCE.json"),
  ) as SourceStamp;
  if (!stamp.url || !stamp.sha256 || !stamp.fetchedAt) {
    throw new Error(
      `extractTrendPresidential(${pubId}): SOURCE.json in ${captureDir} is missing a required field (url/sha256/fetchedAt)`,
    );
  }
  const title = extractPageTitle(html);
  // Mirror-image guard of `extractTrend`'s own fast path (and
  // `extractGlobalMetrics`'s identical reasoning): this extractor builds
  // ONLY presidential drafts, so the safe early rejection is "the title
  // explicitly, unambiguously states parliamentary" — `classifyTitle`
  // reports that honestly (`null` for an ambiguous title), never
  // `classifyRace`'s own defaulted race.
  if (classifyTitle(title) === "parliamentary") {
    throw new Error(
      `extractTrendPresidential(${pubId}): title alone resolves to "parliamentary" for this capture — ` +
        `this extractor only builds presidential drafts`,
    );
  }
  const acquired = await acquireText(captureDir, AGENCY_ID);

  const race = classifyRace(title, acquired.articleText);
  if (race !== "presidential") {
    throw new Error(
      `extractTrendPresidential(${pubId}): classifyRace resolved "${race}" for this capture — ` +
        `this extractor only builds presidential drafts`,
    );
  }

  const section = presidentialSection(acquired.articleText);
  const refused: Refusal[] = [];
  const quotes: Record<string, string> = {};

  const rawShares = extractCandidateSharesBySentenceRule(section);
  const sharesGate = gateSharesEitherDirection(rawShares, section);
  const dedupedShares = dedupeAcceptedShares(sharesGate.accepted);
  refused.push(...sharesGate.refused, ...dedupedShares.refused);
  for (const c of dedupedShares.accepted)
    quotes[`share:${displayLabel(c.label)}`] = c.quote;

  const baseMatch = BASE_PHRASE_RE.exec(section);
  const genre: PollGenre = baseMatch ? "raw_attitudes" : "unclear";
  const basePhrase = baseMatch?.[0] ?? null;

  // Sample size and fieldwork: PROSE first (2016's own shape), the OCR'd
  // passport only when the prose has nothing (2021's shape) — see this
  // file's header for why the two real captures need opposite sourcing
  // from what `trend.ts`'s own decision-18 convention assumes.
  const ocrText = acquired.imageTexts.map((t) => t.text).join("\n");

  // A "Други" (Others/residual) row exists in TR's own passport/chart image
  // for BOTH real captures measured — 2016's bar chart (zadl8.png; the
  // article's candidate paragraph sums to only 94.3% without it) and 2021's
  // OCR'd list (Slide4.png; the article's 7 candidates sum to only 93.2%)
  // — but neither article's own PROSE ever states it, so the candidate-
  // share scan above (prose-only, plus 2021's list-shaped article text)
  // cannot see it and would otherwise silently under-report the true
  // candidate set with nothing flagging the gap.
  //
  // ⚠️ This is a REFUSAL, deliberately never a number. Verified live against
  // both real captures: 2016's bar-chart OCR renders each row's own value as
  // unreliable, differently-corrupted digit noise no consistent regex can
  // decode without already knowing the expected answer (e.g. "24.49" for a
  // real 24.4%, next to "9.996" for a real 9.9%, whose trailing digit counts
  // disagree — the underlying "%" → \d{1,2} substitution is not the SAME
  // substitution row to row). 2021's list-style OCR is individually cleaner
  // per row, but "Други"'s own OWN value ("6.896") is exactly as unverifiable
  // as 2016's — the only reason a human could read it as "≈6.8%" is by
  // already knowing the other 7 candidates' real values and subtracting from
  // 100%, an assumption (that the poll's own categories close to exactly
  // 100%) this extractor has no source text confirming. A human reviewing
  // the source image can confirm the real value and set
  // `residual.otherNamedMinor` (the draft's own top-level field, alongside
  // `poll`/`details`) by hand before accepting — the same "extractor
  // refuses, human fills in what it cannot verify" contract `methodology`
  // already has.
  //
  // ⚠️ SCOPED PER-IMAGE, requiring the SAME image to also name at least one
  // of THIS race's own accepted candidates — never a bare search over the
  // concatenated `ocrText`. 2021's joint capture carries a PARLIAMENTARY
  // chart (Slide3.png) with its OWN, unrelated "Други 5.9%," row (a small-
  // party residual), and `listAttachments`' plain filename sort does not
  // reliably put images in DOCUMENT order (2016's zadl.png/zadl2.png/…
  // sorts "zadl11.png" ahead of "zadl2.png" — lexicographic, not numeric) —
  // so neither "first match" nor "last match" over the joined text is a
  // safe way to land on the right image. Requiring a co-located candidate
  // name is what actually distinguishes "this image is about OUR race"
  // from "this image mentions the same fixed BG polling-industry phrase
  // for a DIFFERENT race's chart" — the exact cross-corpus bleed
  // `presidentialSection()` exists to rule out for prose, mirrored here
  // for images.
  // The boundary is `(?![\p{L}\p{N}])`, never `\b` (ASCII-only, silently
  // fails after a Cyrillic letter — this repo's own documented trap) —
  // without it this also matches inside "Другите" ("the others", a common
  // unrelated word), which neither real capture's OCR happens to contain
  // today but a future one plausibly could, among the many unrelated
  // survey-question charts these TR posts carry.
  const OTHERS_LABEL_RE = /Други(?![\p{L}\p{N}])/iu;
  const acceptedCandidateFirstNames = dedupedShares.accepted
    .filter((c) => !isAbstentionLabel(c.label))
    .map((c) => c.label.split(/\s+/)[0].toLowerCase())
    .filter((tok) => tok.length > 0);
  const othersImage = acquired.imageTexts.find((img) => {
    const lower = img.text.toLowerCase();
    return (
      OTHERS_LABEL_RE.test(img.text) &&
      acceptedCandidateFirstNames.some((name) => lower.includes(name))
    );
  });
  if (othersImage) {
    const othersMatch = OTHERS_LABEL_RE.exec(othersImage.text)!;
    const contextStart = Math.max(0, othersMatch.index - 20);
    const contextEnd = Math.min(
      othersImage.text.length,
      othersMatch.index + othersMatch[0].length + 20,
    );
    refused.push({
      field: "residual.otherNamedMinor",
      reason:
        'the passport/chart image mentions a "Други" (Others) residual row ' +
        "whose value cannot be reliably read from OCR — a human should " +
        "confirm the real percentage from the source image and set " +
        "residual.otherNamedMinor (the draft's own top-level field) before accepting",
      quote: othersImage.text.slice(contextStart, contextEnd).trim(),
    });
  }

  const proseSample = PROSE_SAMPLE_SIZE_RE.exec(acquired.articleText);
  const ocrSample = proseSample
    ? null
    : findInOcrTexts(acquired.imageTexts, OCR_SAMPLE_SIZE_RE, (m) =>
        Number(m[1]),
      );
  let respondents: number | null = null;
  if (proseSample || ocrSample) {
    const [value, quote, docText] = proseSample
      ? [Number(proseSample[1]), proseSample[0], acquired.articleText]
      : [ocrSample!.value, ocrSample!.quote, ocrText];
    const gated = gateFields([{ field: "sampleSize", value, quote }], docText);
    if (gated.accepted.length > 0) {
      respondents = value;
      quotes.sampleSize = quote;
    } else {
      refused.push(...gated.refused);
    }
  }

  // ⚠️ The GATED value is the text exactly as it occurs in the document
  // ("между 19 и 26 октомври 2016 г.") — never the "и"→"-" normalised form
  // `parseBgFieldworkRange` needs, which `gateFields`' plain string-
  // containment check would then fail to find inside a quote that still
  // says "и". The normalisation happens only AFTER grounding succeeds,
  // fed from the match's own capture groups.
  const proseFieldworkMatch = PROSE_FIELDWORK_RE.exec(acquired.articleText);
  const ocrFieldworkMatch = proseFieldworkMatch
    ? null
    : findInOcrTexts(acquired.imageTexts, OCR_FIELDWORK_LABEL_RE, (m) =>
        m[1].trim(),
      );

  let fieldwork: string | null = null;
  let fieldworkStart: string | null = null;
  let fieldworkEnd: string | null = null;

  const acceptFieldwork = (normalised: string, quote: string): void => {
    const parsed = parseBgFieldworkRange(normalised);
    if (parsed) {
      fieldwork = parsed.fieldwork;
      fieldworkStart = parsed.startIso;
      fieldworkEnd = parsed.endIso;
      quotes.fieldwork = quote;
    } else {
      refused.push({
        field: "fieldwork",
        reason: `could not parse a date range from "${normalised}"`,
        quote,
      });
    }
  };

  if (proseFieldworkMatch) {
    const quote = proseFieldworkMatch[0];
    const gated = gateFields(
      [{ field: "fieldwork", value: quote, quote }],
      acquired.articleText,
    );
    if (gated.accepted.length > 0) {
      const [, d1, d2, monthBg, year] = proseFieldworkMatch;
      acceptFieldwork(`${d1}-${d2} ${monthBg} ${year}`, quote);
    } else {
      refused.push(...gated.refused);
    }
  } else if (ocrFieldworkMatch) {
    const gated = gateFields(
      [
        {
          field: "fieldwork",
          value: ocrFieldworkMatch.value,
          quote: ocrFieldworkMatch.quote,
        },
      ],
      ocrText,
    );
    if (gated.accepted.length > 0) {
      acceptFieldwork(ocrFieldworkMatch.value, ocrFieldworkMatch.quote);
    } else {
      refused.push(...gated.refused);
    }
  }

  const id = fieldworkEnd
    ? mintPollId(AGENCY_ID, fieldworkEnd)
    : `${AGENCY_ID.toLowerCase()}-pub-${pubId}`;
  if (!fieldworkEnd) {
    refused.push({
      field: "poll.id",
      reason:
        "no fieldwork end date resolved — using a provisional pubId-keyed id",
      quote: "",
    });
  }

  // The cycle this poll was almost certainly polling FOR, resolved from
  // its own fieldwork end date — `null` (and every candidate below stays
  // `provisional:`) when fieldwork itself did not resolve, since guessing
  // a cycle without a real date to anchor it risks resolving candidates
  // against the WRONG election's tickets.
  const cycle = fieldworkEnd ? resolveCycleForFieldworkEnd(fieldworkEnd) : null;
  const tickets = cycle ? loadTicketsForCycle(cycle) : [];
  const electionDate = cycle
    ? (() => {
        const m = PVR_CYCLE_DIR_RE.exec(cycle)!;
        return `${m[1]}-${m[2]}-${m[3]}`;
      })()
    : null;
  if (fieldworkEnd && !cycle) {
    refused.push({
      field: "poll.cycle",
      reason: `no data/<cycle>_pvr directory found on or after fieldwork end ${fieldworkEnd}`,
      quote: "",
    });
  }

  const details: PresidentialPollDetail[] = dedupedShares.accepted.map((c) => {
    const resolved = resolveCandidate(c.label, tickets);
    return {
      pollId: id,
      agencyId: AGENCY_ID,
      candidateKey: resolved.candidateKey,
      candidateName_bg: displayLabel(c.label),
      // Left blank — cannot be verified against a Bulgarian source quote;
      // filled in by a human at `polls:accept` time, same as every other
      // presidential extractor.
      candidateName_en: "",
      nominator: null,
      placeholderFor: null,
      support: c.value,
    };
  });

  const poll: DraftPoll = {
    id,
    agencyId: AGENCY_ID,
    source: stamp.url,
    electionDate,
    cycle,
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

  return {
    race: "presidential",
    poll,
    details,
    runoffs: [], // no runoff pairing published in either real capture
    residual: null,
    genre,
    extractor: AGENCY_ID,
    evidence: quotes,
    refused,
  };
};
