// Global Metrics presidential extraction. Keep hypothetical party choices and
// named-person support potential in separate, unscorable questions.

import fs from "node:fs";
import * as cheerio from "cheerio";
import path from "node:path";
import {
  placeholderCandidateKey,
  resolveCandidate,
} from "../presidential/candidate_resolver";
import { normKey, POLL_TO_ACTUAL } from "../../../src/data/polls/aliases";
import { pollId as mintPollId } from "../../../src/data/polls/fieldwork";
import { UPCOMING_ELECTIONS } from "../../../src/data/myarea/upcomingElections";
import type {
  PollGenre,
  PollQuestion,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
import { classifyRace, classifyTitle } from "../lib/classify_race";
import { dedupeAcceptedShares } from "../lib/dedupe_shares";
import type { DraftPoll, PresidentialInboxDraft } from "../lib/draft";
import {
  gateShares,
  type Refusal,
  type ShareClaim,
} from "../lib/evidence_gate";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import { acquireText, extractPageTitle } from "../lib/text_acquisition";

const AGENCY_ID = "GM";

// The placeholder table's own header states the SAME base phrase decision
// 8 already defines for the parliamentary side — this poll genuinely IS
// a "if elections were held this Sunday" horse race for the placeholder
// arm (measured verbatim: "(сред заявилите, че ще гласуват)").
const BASE_PHRASE_RE = /сред\s+заявилите,?\s+че\s+ще\s+гласуват/iu;

// Section boundaries within the combined PDF text — both tables sit on
// ONE page in the real capture, back to back, bounded by their own
// question headers. Matched on stable substrings of each header rather
// than the whole sentence, since a header can itself wrap across lines
// in `pdftotext -layout`'s column-preserving output.
const PLACEHOLDER_SECTION_START_RE = /бихте гласували\?/iu;
const PLACEHOLDER_SECTION_END_RE = /Според Вас какъв модел/iu;
const NAMED_SECTION_START_RE = /бихте дали своята\s*\n?\s*подкрепа\?/iu;
const NAMED_SECTION_END_RE = /Ако президентските избори бяха/iu;

// "Кандидат на <party>" (the party may wrap across lines in the PDF's
// column layout — matched non-greedily up to the next number) or the
// fixed catch-all row "Друг кандидат" ("another/other candidate"). Case
// sensitive DELIBERATELY, not merely by omission — the press release's
// own running prose uses the lowercase phrase ("...кандидат на ПП–ДБ..."),
// and a case-insensitive row regex would (if this pattern were ever run
// un-sectioned, or the section markers ever widened by accident) read
// ordinary narrative text as a fake ballot row.
//
// The lazy `[\s\S]+?` span is bounded by a negative lookahead against
// EITHER marker, not merely non-greedy — without it, a row whose own
// percentage is missing (withheld, footnoted, a redesigned table) lets
// the span leech across an entire second row's own marker and percentage,
// silently merging two parties into one garbled label/value pair that
// (verified) still PASSES the evidence gate, because the merged label and
// number are still contiguous in the merged quote. Bounding the span
// means a percentage-less row instead fails to match at all — correctly
// invisible to `extractPlaceholderRows`, rather than corrupting its
// neighbour.
const PLACEHOLDER_ROW_RE =
  /(Кандидат на\s+(?:(?!Кандидат на|Друг кандидат)[\s\S])+?|Друг кандидат)\s*\n*\s*(\d{1,2}[.,]\d)\s*%/g;

// The three support tiers precede the repeated name in the adjacent trust table.
const NAMED_ROW_RE =
  /^[ \t]*(\p{L}[\p{L}.'-]*(?:\s+\p{L}[\p{L}.'-]*)?)\s+(\d{1,2}[.,]\d)%\s*(\d{1,2}[.,]\d)%\s*(\d{1,2}[.,]\d)%[\s\S]*?\1/gmu;

const FIELDWORK_RE = /в периода\s+([^.;\n]+)/iu;
const SAMPLE_SIZE_RE = /обем на извадката:?\s*(\d+)/iu;

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
      `extractGlobalMetrics(${pubId}): missing or unreadable ${name} in ${captureDir} ` +
        `(a partial polls:fetch run?): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

/** The text strictly between two marker regexes, or `null` when either
 *  marker is absent — the caller decides what "no such section" means
 *  for its own table (today: no placeholder/named rows extracted, not an
 *  error, since a future GM capture may carry only one of the two). */
const sectionBetween = (
  text: string,
  startRe: RegExp,
  endRe: RegExp,
): string | null => {
  const startMatch = startRe.exec(text);
  if (!startMatch) return null;
  const from = startMatch.index + startMatch[0].length;
  endRe.lastIndex = 0;
  const endMatch = endRe.exec(text.slice(from));
  const to = endMatch ? from + endMatch.index : text.length;
  return text.slice(from, to);
};

/** "Кандидат на Прогресивна България" → "Прогресивна България"; "Друг
 *  кандидат" is left as-is (it names no party to strip a prefix from). A
 *  trailing separator ("Продължаваме промяната –", the party name
 *  truncated mid-wrap — see `PLACEHOLDER_ROW_RE`'s header) is trimmed off
 *  too, so the alias lookup below sees the same clean form regardless of
 *  whether the row wrapped. */
const partyNameFromRow = (rowLabel: string): string =>
  rowLabel
    .replace(/^Кандидат на\s+/iu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s–—-]+$/u, "");

/** The party's own canonical key (decision 14's alias table, extended
 *  here — never forked) when known, else a stable normalised form of
 *  whatever text this poll printed. `POLL_TO_ACTUAL` is built for
 *  resolving a poll label to a PARLIAMENTARY election's actual-result
 *  key, but a direct hit in it is just as valid a canonical party key
 *  here — this never calls `resolveActualKey` itself, since that
 *  function's ДПС/БСП cycle-ambiguity handling needs an `actualKeys` set
 *  from a specific past election, which a presidential placeholder has
 *  no such thing to be scored against. */
const placeholderPartyKey = (partyName: string): string =>
  POLL_TO_ACTUAL[partyName] ?? normKey(partyName);

export interface PlaceholderRow {
  partyName: string;
  partyKey: string;
  evidenceLabel: string;
  support: number;
  quote: string;
}

// Exported for targeted regex-edge-case unit tests (a missing-percentage
// row, a case-sensitivity check) that need no real PDF/pdftotext binary —
// every other behavior of this extractor is tested end-to-end against
// the real capture, per this repo's own "validate against real data"
// convention; this pure string→row function is the one piece cheap and
// safe to test in isolation from the OS-level PDF pipeline.
export const extractPlaceholderRows = (section: string): PlaceholderRow[] => {
  const rows: PlaceholderRow[] = [];
  const re = new RegExp(PLACEHOLDER_ROW_RE.source, PLACEHOLDER_ROW_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    const evidenceLabel = partyNameFromRow(m[1]);
    const continuation = /^\s*Демократична България(?=\s|$)/u.exec(
      section.slice(re.lastIndex),
    );
    const partyName =
      evidenceLabel === "Продължаваме промяната" && continuation
        ? `${evidenceLabel} – Демократична България`
        : evidenceLabel;
    rows.push({
      partyName,
      evidenceLabel,
      partyKey: placeholderPartyKey(evidenceLabel),
      support: Number(m[2].replace(",", ".")),
      quote: m[0] + (partyName !== evidenceLabel ? continuation![0] : ""),
    });
  }
  return rows;
};

interface NamedRow {
  candidateName: string;
  support: number;
  answerCode: string;
  quote: string;
}

const extractNamedRows = (section: string): NamedRow[] => {
  const rows: NamedRow[] = [];
  const re = new RegExp(NAMED_ROW_RE.source, NAMED_ROW_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    for (const [index, answerCode] of [
      "definitely",
      "probably",
      "hesitant",
    ].entries()) {
      rows.push({
        candidateName: m[1].trim(),
        answerCode,
        support: Number(m[index + 2].replace(",", ".")),
        quote: m[0],
      });
    }
  }
  return rows;
};

/**
 * `captureDir` is one `polls:fetch` capture (e.g.
 * `raw_data/polls/global_metrics/658`); `pubId` is that publication's own
 * id, used only to mint a provisional poll id when the fieldwork end date
 * cannot be resolved.
 *
 * No `tickets.json` exists for the 2026 cycle yet (ЦИК has not registered
 * it), so every named candidate resolves as `provisional:<first-last>`
 * today — `polls:presidential:rekey` (decision 16, built) is what
 * upgrades these to real `canonicalKey`s once it does.
 */
export const extractGlobalMetrics = async (
  captureDir: string,
  pubId: string,
): Promise<PresidentialInboxDraft> => {
  const html = readCaptureFile(captureDir, pubId, "page.html");
  const stamp = JSON.parse(
    readCaptureFile(captureDir, pubId, "SOURCE.json"),
  ) as SourceStamp;
  if (!stamp.url || !stamp.sha256 || !stamp.fetchedAt) {
    throw new Error(
      `extractGlobalMetrics(${pubId}): SOURCE.json in ${captureDir} is missing a required field (url/sha256/fetchedAt)`,
    );
  }
  const title = extractPageTitle(html);
  // Cheap fast path, mirroring trend.ts/alpha_research.ts's — but NOT
  // their mirror-image condition. Those two build only PARLIAMENTARY
  // drafts and can safely reject on `classifyRace(title) !==
  // "parliamentary"`, because that value is only ever "presidential"
  // there via a genuine title match, never `classifyRace`'s own
  // ambiguous-title default. This extractor builds only PRESIDENTIAL
  // drafts, so the mirror condition (`!== "presidential"`) is NOT safe:
  // it would also fire on a title that states neither race, incorrectly
  // rejecting a real presidential capture before its PDF text is ever
  // read. `classifyTitle` reports that ambiguity honestly (`null`,
  // never a defaulted race) — the only case safe to reject early here is
  // a title that explicitly, unambiguously states PARLIAMENTARY.
  if (classifyTitle(title) === "parliamentary") {
    throw new Error(
      `extractGlobalMetrics(${pubId}): title alone resolves to "parliamentary" for this capture — ` +
        `this extractor only builds presidential drafts`,
    );
  }
  const acquired = await acquireText(captureDir, AGENCY_ID);
  // GM publishes as PDF only (§2's own table) — the two real PDFs are
  // concatenated so either table can be found regardless of which file
  // it happens to sit in, rather than assuming a specific filename.
  const combinedPdfText = acquired.pdfTexts.map((t) => t.text).join("\n\n");

  const race = classifyRace(title, combinedPdfText);
  if (race !== "presidential") {
    throw new Error(
      `extractGlobalMetrics(${pubId}): classifyRace resolved "${race}" for this capture — ` +
        `this extractor only builds presidential drafts`,
    );
  }

  const refused: Refusal[] = [];
  const quotes: Record<string, string> = {};
  const details: PresidentialPollDetail[] = [];

  // --- Placeholder rows ("Кандидат на <party>") ---
  const placeholderSection = sectionBetween(
    combinedPdfText,
    PLACEHOLDER_SECTION_START_RE,
    PLACEHOLDER_SECTION_END_RE,
  );
  let basePhrase: string | null = null;
  if (placeholderSection) {
    const rawRows = extractPlaceholderRows(placeholderSection);
    const claims: ShareClaim[] = rawRows.map((r) => ({
      label: r.evidenceLabel,
      value: r.support,
      quote: r.quote,
    }));
    const gated = gateShares(claims, placeholderSection);
    const deduped = dedupeAcceptedShares(gated.accepted);
    refused.push(...gated.refused, ...deduped.refused);
    for (const c of deduped.accepted) {
      const row = rawRows.find((r) => r.evidenceLabel === c.label);
      if (!row) continue; // unreachable — every accepted claim came from rawRows
      quotes[`share:${row.partyName}`] = c.quote;
      details.push({
        pollId: "", // filled in once the poll id is known, below
        agencyId: AGENCY_ID,
        candidateKey: placeholderCandidateKey(row.partyKey),
        candidateName_bg: row.partyName,
        // Left blank, like the parliamentary side's `nickName_en` — the
        // type's documented `transliterateName()` default is applied by
        // the not-yet-built `polls:accept`/rekey step, not by extraction,
        // since an English translation cannot be verified against a
        // Bulgarian source quote.
        candidateName_en: "",
        nominator: null,
        placeholderFor: row.partyKey,
        support: row.support,
        questionId: "party-backed-choice",
        answerCode: "vote",
      });
    }
    const baseMatch = BASE_PHRASE_RE.exec(placeholderSection);
    basePhrase = baseMatch?.[0] ?? null;
  } else {
    refused.push({
      field: "details.placeholder",
      reason: "no party-placeholder table found (question header not matched)",
      quote: "",
    });
  }

  // --- Named-candidate rows ---
  const namedSection = sectionBetween(
    combinedPdfText,
    NAMED_SECTION_START_RE,
    NAMED_SECTION_END_RE,
  );
  if (namedSection) {
    const orderedLegend =
      /Със\s+сигурност\s+бих\s+гласувал\/а\s+По-скоро\s+бих\s+гласувал\/а\s+Колебая\s+се/u.test(
        namedSection,
      );
    const rawRows = orderedLegend ? extractNamedRows(namedSection) : [];
    if (!orderedLegend)
      refused.push({
        field: "details.named.scale",
        reason: "support-potential legend missing or reordered",
        quote: "",
      });
    for (const answerCode of ["definitely", "probably", "hesitant"]) {
      const claims: ShareClaim[] = rawRows
        .filter((r) => r.answerCode === answerCode)
        .map((r) => ({
          label: r.candidateName,
          value: r.support,
          quote: r.quote,
        }));
      const gated = gateShares(claims, namedSection);
      const deduped = dedupeAcceptedShares(gated.accepted);
      refused.push(...gated.refused, ...deduped.refused);
      for (const c of deduped.accepted) {
        const resolved = resolveCandidate(c.label, []);
        quotes[`share:${c.label}:${answerCode}`] = c.quote;
        details.push({
          pollId: "",
          agencyId: AGENCY_ID,
          candidateKey: resolved.candidateKey,
          candidateName_bg: c.label,
          candidateName_en: "",
          nominator: null,
          placeholderFor: null,
          support: c.value,
          questionId: "named-support-potential",
          answerCode,
        });
      }
    }
  } else {
    refused.push({
      field: "details.named",
      reason:
        "no named-candidate support table found (question header not matched)",
      quote: "",
    });
  }

  const genre: PollGenre = basePhrase ? "raw_attitudes" : "unclear";

  const fieldworkMatch = FIELDWORK_RE.exec(combinedPdfText);
  let fieldwork: string | null = null;
  let fieldworkStart: string | null = null;
  let fieldworkEnd: string | null = null;
  if (fieldworkMatch) {
    const parsed = parseBgFieldworkRange(fieldworkMatch[1].trim());
    if (parsed) {
      fieldwork = parsed.fieldwork;
      fieldworkStart = parsed.startIso;
      fieldworkEnd = parsed.endIso;
      quotes.fieldwork = fieldworkMatch[0];
    } else {
      refused.push({
        field: "fieldwork",
        reason: `could not parse a date range from "${fieldworkMatch[1].trim()}"`,
        quote: fieldworkMatch[0],
      });
    }
  } else {
    refused.push({
      field: "fieldwork",
      reason: "no fieldwork pattern matched the extracted text",
      quote: "",
    });
  }

  const sampleMatch = SAMPLE_SIZE_RE.exec(combinedPdfText);
  const respondents = sampleMatch ? Number(sampleMatch[1]) : null;
  if (sampleMatch) quotes.sampleSize = sampleMatch[0];
  else
    refused.push({
      field: "sampleSize",
      reason: "no sample-size pattern matched the extracted text",
      quote: "",
    });

  // A poll id needs the fieldwork end date — trend.ts's/alpha_research.ts's
  // identical rule (provisional ids cannot collide with a real one, and
  // are disposable once a later re-extraction resolves a real one). Minted
  // through the shared, validated helper (not a hand-rolled template) so a
  // malformed `fieldworkEnd` or agency id throws here rather than minting
  // a silently-broken id.
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
  for (const d of details) d.pollId = id;

  // Decision 11: a presidential poll's electionDate is the current best
  // estimate from the SAME shared source the My-Area tile reads
  // (src/data/myarea/upcomingElections.ts) — never a literal date string
  // hardcoded here, so this extractor tracks the real decree the moment
  // that file is updated, with no code change of its own.
  const electionDate =
    UPCOMING_ELECTIONS.find((e) => e.kind === "presidential")?.date ?? null;

  const sourceEvidence = (pattern: RegExp): PollQuestion["evidence"] => {
    const pdf = acquired.pdfTexts.find((p) => pattern.test(p.text));
    const match = pdf && pattern.exec(pdf.text);
    if (!pdf || !match)
      throw new Error("Question header not found in the captured PDF");
    const $ = cheerio.load(html);
    const href = $("a[href]")
      .toArray()
      .map((a) => $(a).attr("href")!)
      .find((value) => {
        try {
          return decodeURIComponent(
            new URL(value, stamp.url).pathname,
          ).endsWith(`/${pdf.file}`);
        } catch {
          return false;
        }
      });
    return {
      url: href ? new URL(href, stamp.url).href : stamp.url,
      quote: match[0],
      locator: `${pdf.file}, page ${pdf.text.slice(0, match.index).split("\f").length}`,
    };
  };
  const questions: PollQuestion[] = [];
  if (details.some((d) => d.questionId === "party-backed-choice"))
    questions.push({
      id: "party-backed-choice",
      race: "presidential",
      cycle: null,
      round: 1,
      measure: "party_backed_candidate",
      wording: {
        bg: "Ако президентските избори бяха следващата неделя за кандидат президент от коя политическа сила бихте гласували?",
        en: "If the presidential election were next Sunday, which political force's candidate would you vote for?",
      },
      base: {
        kind: basePhrase ? "likely_voters" : "unknown",
        label: {
          bg: basePhrase ?? "Неуточнена база",
          en: basePhrase
            ? "Respondents who say they will vote"
            : "Unspecified base",
        },
        respondents: null,
        includesNone: null,
      },
      scenario: "hypothetical-party-nominations",
      answerScale: [
        { code: "vote", label: { bg: "Бих гласувал/а", en: "Would vote" } },
      ],
      genre,
      residual: null,
      evidence: sourceEvidence(
        /Ако президентските избори бяха[\s\S]*?бихте гласували\?/u,
      ),
      scoring: {
        eligible: false,
        reason:
          "Hypothetical party-backed candidates, not registered candidate vote intention",
      },
    });
  if (details.some((d) => d.questionId === "named-support-potential"))
    questions.push({
      id: "named-support-potential",
      race: "presidential",
      cycle: null,
      round: null,
      measure: "support_potential",
      wording: {
        bg: "Когато става дума за предстоящите президентски избори, на кои от следните личности бихте дали своята подкрепа?",
        en: "Which of these people would you support in the upcoming presidential election?",
      },
      base: {
        kind: "unknown",
        label: {
          bg: "Базата на този въпрос не е уточнена",
          en: "Base not specified for this question",
        },
        respondents: null,
        includesNone: null,
      },
      scenario: "hypothetical-candidates",
      answerScale: [
        {
          code: "definitely",
          label: {
            bg: "Със сигурност бих гласувал/а",
            en: "Would definitely vote",
          },
        },
        {
          code: "probably",
          label: { bg: "По-скоро бих гласувал/а", en: "Would probably vote" },
        },
        { code: "hesitant", label: { bg: "Колебая се", en: "Hesitant" } },
      ],
      genre: "raw_attitudes",
      residual: null,
      evidence: sourceEvidence(
        /Когато става дума за предстоящите президентски избори,[\s\S]*?подкрепа\?/u,
      ),
      scoring: {
        eligible: false,
        reason:
          "Support potential permits support for multiple people; it is not a voting distribution",
      },
    });
  const poll: DraftPoll = {
    id,
    agencyId: AGENCY_ID,
    questions,
    source: stamp.url,
    electionDate,
    cycle: null,
    publicationId: `GM:${pubId}`,
    publishedAt:
      /property=["']article:published_time["']\s+content=["']([^"']+)/u.exec(
        html,
      )?.[1] ?? null,
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
    runoffs: [], // no runoff pairing published in this capture
    residual: null,
    genre,
    extractor: AGENCY_ID,
    evidence: quotes,
    refused,
  };
};
