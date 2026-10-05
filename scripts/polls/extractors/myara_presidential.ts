/** Мяра (MY) presidential extraction. Мяра publishes its presidential
 *  snapshot as ONE sentence of tickets („за Илияна Йотова и Кирил Вълчев биха
 *  гласували 46,9%, за Андрей Гюров и Георги Кандев – 25,3%, …") with a chart
 *  beside it, and dates the fieldwork without a year („между 26 септември и
 *  4 октомври"). The shared table parser (agency_presidential.ts) can read
 *  neither, so this reads the sentence, takes the year from the chart title
 *  or the publication date, and the base from the chart's „База:" line.
 *
 *  Values that appear ONLY in the chart („Друг 7,6%") are not read: the
 *  chart's value labels do not OCR reliably, and a number is never inferred.
 *  The independent reading in polls:review finds them, so such a post goes
 *  to a human with that one difference named. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PollBase,
  PollGenre,
  PollQuestion,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
import { transliterateName } from "../../../src/data/candidates/transliterateName";
import { resolveCandidate } from "../presidential/candidate_resolver";
import type { PresidentialInboxDraft } from "../lib/draft";
import { presidentialDraftId } from "../lib/draft_identity";
import {
  gateSharesEitherDirection,
  type Refusal,
  type ShareClaim,
} from "../lib/evidence_gate";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import {
  presidentialRound1Date,
  resolvePresidentialCycle,
} from "../lib/presidential_cycle";
import { acquireText, type AcquiredText } from "../lib/text_acquisition";
import { extractAgencyPresidential } from "./agency_presidential";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];

const TOKEN = "[А-ЯЍ][а-яѝ]+(?:-[А-ЯЍ][а-яѝ]+)?";
const NAME = `${TOKEN}(?:\\s+${TOKEN}){1,2}`;
/** The ticket sentence, from its lead to the „Не подкрепям никого" clause. */
const SENTENCE =
  /Ако президентските избори бяха[\s\S]*?Не подкрепям никого[“"]?/u;
const TICKET = new RegExp(
  `(?:за\\s+)?(${NAME})\\s+и\\s+${NAME}(?:\\s+биха\\s+гласували)?\\s*[–—-]?\\s*(\\d{1,2}(?:[.,]\\d)?)\\s*%`,
  "gu",
);
const NONE =
  /(\d{1,2}(?:[.,]\d)?)\s*%\s*биха\s+избрали\s+[„"]?Не подкрепям никого/u;
const FIELDWORK =
  /между\s+(\d{1,2})\s+([а-я]+)\s+и\s+(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?/u;

const num = (s: string): number => Number(s.replace(",", "."));

/** The ticket rows the sentence states, as evidence-gated share claims. */
/** A figure the sentence states approximately („близо до 1%") is not a
 *  share and needs no row. */
const APPROXIMATE = /(?:близо до|около|под|над|до)\s*$/u;

export const parseTicketSentence = (
  text: string,
): { lead: string; claims: ShareClaim[]; refused: Refusal[] } | null => {
  const sentence = SENTENCE.exec(text)?.[0];
  if (!sentence) return null;
  const matches = [...sentence.matchAll(TICKET)];
  const claims: ShareClaim[] = matches.map((m) => ({
    label: m[1],
    value: num(m[2]),
    quote: m[0].trim(),
  }));
  const consumed = matches.map((m) => [m.index, m.index + m[0].length]);
  const none = NONE.exec(sentence);
  if (none) {
    claims.push({
      label: "Не подкрепям никого",
      value: num(none[1]),
      quote: none[0],
    });
    consumed.push([none.index, none.index + none[0].length]);
  }
  // Every stated share must become a row — a ticket the pattern could not
  // read is refused, never silently dropped.
  const refused: Refusal[] = [];
  for (const pct of sentence.matchAll(/\d{1,2}(?:[.,]\d)?\s*%/gu)) {
    const at = pct.index;
    if (consumed.some(([a, b]) => at >= a && at < b)) continue;
    if (APPROXIMATE.test(sentence.slice(Math.max(0, at - 15), at))) continue;
    const quote = sentence.slice(Math.max(0, at - 60), at + pct[0].length);
    refused.push({
      field: `share:${quote.trim()}`,
      reason: "A stated share whose ticket could not be read",
      quote,
    });
  }
  const lead = sentence.split(/,\s*за\s/u)[0];
  return claims.length ? { lead, claims, refused } : null;
};

/** Fieldwork with the year resolved: stated, else the chart title's year for
 *  the end month, else the publication year (one earlier when the fieldwork
 *  ends in a later month than the post — a December survey published in
 *  January). */
export const parseMyaraFieldwork = (
  text: string,
  chartText: string,
  publishedAt: string | null,
): {
  startIso: string | null;
  endIso: string;
  fieldwork: string;
  quote: string;
} | null => {
  const m = FIELDWORK.exec(text);
  if (!m) return null;
  const [quote, d1, m1, d2, m2, stated] = m;
  const endMonth = MONTHS.indexOf(m2);
  if (MONTHS.indexOf(m1) < 0 || endMonth < 0) return null;
  const titled = new RegExp(`${m2}\\s+(\\d{4})\\s*г`, "u").exec(chartText)?.[1];
  let year = stated ?? titled;
  if (!year && publishedAt) {
    const pubYear = Number(publishedAt.slice(0, 4));
    const pubMonth = Number(publishedAt.slice(5, 7)) - 1;
    year = String(endMonth > pubMonth ? pubYear - 1 : pubYear);
  }
  if (!year) return null;
  const range =
    m1 === m2
      ? `${d1} - ${d2} ${m2} ${year}`
      : `${d1} ${m1} - ${d2} ${m2} ${year}`;
  const parsed = parseBgFieldworkRange(range);
  return parsed ? { ...parsed, quote } : null;
};

const baseFrom = (
  chartText: string,
): { base: PollBase; quote: string } | null => {
  const m = /База:\s*([^\n]+)/u.exec(chartText);
  if (!m || !/твърдо решили да гласуват/u.test(m[1])) return null;
  return {
    quote: m[0].trim(),
    base: {
      kind: "likely_voters",
      label: {
        bg: "Твърдо решили да гласуват",
        en: "Respondents firmly decided to vote",
      },
      respondents: null,
      includesNone: true,
    },
  };
};

const genreFrom = (text: string): PollGenre =>
  /не са прогноза/u.test(text) ? "raw_attitudes" : "unclear";

const publishedFrom = (html: string): string | null =>
  /article:published_time"\s+content="(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ??
  null;

export const extractMyaraPresidential = async (
  captureDir: string,
  pubId: string,
  acquired?: AcquiredText,
): Promise<PresidentialInboxDraft> => {
  const source = acquired ?? (await acquireText(captureDir, "MY"));
  const draft = await extractAgencyPresidential(
    "MY",
    captureDir,
    pubId,
    source,
  );
  if (draft.details.length) return draft; // a labelled table — shared path

  const text = source.articleText;
  const chartText = source.imageTexts.map((i) => i.text).join("\n");
  const parsed = parseTicketSentence(text);
  if (!parsed) return draft;
  const html = fs.readFileSync(path.join(captureDir, "page.html"), "utf8");
  const publishedAt = draft.poll.publishedAt ?? publishedFrom(html);
  const fieldwork = parseMyaraFieldwork(text, chartText, publishedAt);
  if (!fieldwork) return draft;

  const gate = gateSharesEitherDirection(parsed.claims, text);
  const id = presidentialDraftId(`my-${fieldwork.endIso}`);
  const cycle = resolvePresidentialCycle(ROOT, fieldwork.endIso);
  const based = baseFrom(chartText);
  const genre = genreFrom(text);
  const evidence: Record<string, string> = {
    ...draft.evidence,
    fieldwork: fieldwork.quote,
  };
  if (based) evidence.base = based.quote;
  for (const c of gate.accepted) evidence[`share:${c.label}`] = c.quote;

  const question: PollQuestion = {
    id: "vote",
    race: "presidential",
    cycle,
    round: 1,
    measure: "vote_intention",
    wording: {
      bg: parsed.lead,
      en: "If the presidential election were held now, which ticket would you vote for?",
    },
    base: based?.base ?? {
      kind: "unknown",
      label: { bg: "Неуточнена база", en: "Unresolved population base" },
      respondents: null,
      includesNone: null,
    },
    scenario: null,
    answerScale: [
      { code: "support", label: { bg: "Подкрепа", en: "Support" } },
    ],
    genre,
    residual: null,
    evidence: {
      url: draft.poll.source!,
      quote: parsed.lead,
      locator: "page.html",
    },
    scoring: {
      eligible: false,
      reason: based
        ? "The source defines likely voters (firmly decided to vote), not an explicitly decided-voter or valid-vote base"
        : "Population base not stated in the text",
    },
  };
  const details: PresidentialPollDetail[] = gate.accepted.map((c) => ({
    pollId: id,
    agencyId: "MY",
    questionId: "vote",
    answerCode: "support",
    candidateKey: resolveCandidate(c.label, [], cycle).candidateKey,
    candidateName_bg: c.label,
    candidateName_en:
      c.label === "Не подкрепям никого"
        ? "None of the above"
        : transliterateName(c.label),
    nominator: null,
    placeholderFor: null,
    support: c.value,
  }));

  return {
    ...draft,
    poll: {
      ...draft.poll,
      id,
      cycle,
      electionDate: cycle ? presidentialRound1Date(cycle) : null,
      publishedAt,
      fieldwork: fieldwork.fieldwork,
      questions: [question],
      genre,
      provenance: {
        ...draft.poll.provenance!,
        fieldworkStart: fieldwork.startIso,
        fieldworkEnd: fieldwork.endIso,
        basePhrase: based ? "твърдо решили да гласуват" : null,
        quotes: evidence,
      },
    },
    details,
    genre,
    evidence,
    refused: [
      ...draft.refused.filter(
        (r) => r.field !== "fieldwork" && r.field !== "questions",
      ),
      ...parsed.refused,
      ...gate.refused,
    ],
  };
};
