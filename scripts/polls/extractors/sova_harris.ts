// Sova Harris (SH) parliamentary extractor. SH publishes each wave as a
// bulletin of page IMAGES („Buletin_Pol0326_page-0009.jpg") behind a short
// article whose text carries the passport: „в периода 7 – 12 март 2026 г.
// сред 1000 български граждани". The party shares sit only in the bulletin's
// vote table („ЗА КОЯ ПАРТИЯ ИЛИ КОАЛИЦИЯ БИХТЕ ГЛАСУВАЛИ? (сред гласуващите
// за конкретна политическа сила)"), so they come from OCR.
//
// Tesseract reads these tables badly — measured on the March 2026 bulletin:
// „ГЕРБ - САС Г 193" for 19,3, „АПС Ново Начало 74" for ДПС 7,1. So a row is
// accepted ONLY when its value is printed with a decimal comma (`30,9`); a
// value that lost its comma or a digit is REFUSED with its OCR line quoted,
// never repaired — inserting the comma would be a guess. Such drafts go to a
// human with the independent reading beside them (polls:review); a cleanly
// OCR'd bulletin can still agree and auto-accept.

import fs from "node:fs";
import path from "node:path";
import { pollId as mintPollId } from "../../../src/data/polls/fieldwork";
import type {
  PollDetail,
  PollResidual,
} from "../../../src/data/polls/pollsTypes";
import type { DraftPoll, ParliamentaryInboxDraft } from "../lib/draft";
import {
  gateShares,
  type Refusal,
  type ShareClaim,
} from "../lib/evidence_gate";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import { acquireText, type AcquiredText } from "../lib/text_acquisition";

const AGENCY_ID = "SH";

/** The vote question's heading, in both measured wordings: „ЗА КОЯ ПАРТИЯ
 *  ИЛИ КОАЛИЦИЯ БИХТЕ ГЛАСУВАЛИ?" (March 2026) and „ЗА КОЯ ПОЛИТИЧЕСКА СИЛА
 *  ЩЕ ГЛАСУВАТЕ НА ИЗБОРИТЕ…?" (April 2026). Not „СМЯТАТЕ ЛИ ДА ГЛАСУВАТЕ" —
 *  that is the turnout question. */
const VOTE_HEADING_RE = /(?:БИХТЕ\s+ГЛАСУВАЛИ|ЩЕ\s+ГЛАСУВАТЕ)/iu;
/** The base as printed under either heading; OCR may drop the column header
 *  „ПРОЦЕНТ" into the middle of it. */
const BASE_PHRASE_RE =
  /(?:само\s+)?сред\s+гласуващите\s+за\s+(?:ПРОЦЕНТ\s+)?конкретна\s+(?:ПРОЦЕНТ\s+)?(?:политическа\s+сила|партия\s*\/\s*коалиция)/iu;
/** The table ends at its „Друга…" row or the page footer. `\\b` is
 *  ASCII-only and never matches after a Cyrillic letter. */
const OTHER_RE = /^Друга(?![\p{L}])/iu;
const POOLED_OTHER_RE = /не\s+подкрепям/iu;
const FOOTER_RE = /ПОЛИТИЧЕСКИ\s+НАГЛАСИ\s+В\s+БЪЛГАРИЯ/iu;
/** A table row: label, then a trailing number with optional table rules. */
const ROW_RE =
  /^(.*?[А-Яа-яA-Za-z"“”„»].*?)[\s|„.Г]*?(\d{1,3}(?:[.,]\d{1,2})?)\s*[|.]?\s*$/u;
/** Only a value printed with its decimal comma is trusted. */
const WELL_FORMED_RE = /^\d{1,2},\d$/u;
/** A label the bulletin wraps onto the next line ends with „и" or a dash. */
const WRAPS_RE = /(?:\sи|[-–—])$/u;

const FIELDWORK_RE =
  /в\s+периода\s+(\d{1,2}(?:\s+[а-я]+)?\s*[–—-]\s*\d{1,2}\s+[а-я]+\s+\d{4})/iu;
const SAMPLE_RE =
  /сред\s+(\d{3,5})\s+(?:български\s+граждани|души|пълнолетни)/iu;

const cleanLabel = (raw: string): string =>
  raw
    .replace(/^[\s|„"».,:;-]+/u, "")
    .replace(/[\s|„.,Г]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

export interface SovaHarrisTable {
  basePhrase: string | null;
  claims: ShareClaim[];
  other: { value: number; quote: string } | null;
  refused: Refusal[];
}

/** Read the parliamentary vote table from one OCR'd bulletin page. Once the
 *  first row is seen, EVERY line is accounted for: a row, a continuation of
 *  a wrapped label, or a refused unreadable row — nothing is dropped. */
export const parseVoteTable = (text: string): SovaHarrisTable | null => {
  const heading = VOTE_HEADING_RE.exec(text);
  if (!heading) return null;
  const after = text.slice(heading.index);
  const base = BASE_PHRASE_RE.exec(after.slice(0, 300));
  const lines = after
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  type Row = { label: string; raw: string | null; quote: string };
  const rows: Row[] = [];
  for (const line of lines) {
    if (FOOTER_RE.test(line)) break;
    const m = ROW_RE.exec(line);
    const prev = rows[rows.length - 1];
    if (!m) {
      if (!rows.length) continue; // still in the heading / base lines
      if (prev && WRAPS_RE.test(prev.label)) {
        prev.label = cleanLabel(`${prev.label} ${line}`);
        prev.quote = `${prev.quote} ${line}`;
      } else rows.push({ label: cleanLabel(line), raw: null, quote: line });
      continue;
    }
    if (!rows.length && /^(?:ПРОЦЕНТ|АПРИЛ|МАРТ)/iu.test(line)) continue;
    rows.push({ label: cleanLabel(m[1]), raw: m[2], quote: line });
    if (OTHER_RE.test(cleanLabel(m[1]))) break;
  }

  const claims: ShareClaim[] = [];
  const refused: Refusal[] = [];
  let other: SovaHarrisTable["other"] = null;
  for (const row of rows) {
    const wellFormed = row.raw !== null && WELL_FORMED_RE.test(row.raw);
    if (OTHER_RE.test(row.label)) {
      if (POOLED_OTHER_RE.test(row.label))
        refused.push({
          field: `share:${row.label}`,
          reason:
            'pools another party with „Не подкрепям никого" — a human decides',
          quote: row.quote,
        });
      else if (wellFormed)
        other = { value: Number(row.raw!.replace(",", ".")), quote: row.quote };
      continue;
    }
    if (!wellFormed) {
      refused.push({
        field: `share:${row.label}`,
        reason: row.raw
          ? `OCR value "${row.raw}" has no decimal comma — not repaired (bulletin image)`
          : "OCR value unreadable (bulletin image)",
        quote: row.quote,
      });
      continue;
    }
    claims.push({
      label: row.label,
      value: Number(row.raw!.replace(",", ".")),
      quote: row.quote,
    });
  }
  return {
    basePhrase: base
      ? base[0]
          .replace(/\s*ПРОЦЕНТ\s*/iu, " ")
          .replace(/\s+/g, " ")
          .trim()
      : null,
    claims,
    other,
    refused,
  };
};

interface SourceStamp {
  url: string;
  fetchedAt: string;
  sha256: string;
  publishedAt?: string | null;
}

export const extractSovaHarris = async (
  captureDir: string,
  pubId: string,
  acquired?: AcquiredText,
): Promise<ParliamentaryInboxDraft> => {
  const stamp = JSON.parse(
    fs.readFileSync(path.join(captureDir, "SOURCE.json"), "utf8"),
  ) as SourceStamp;
  const source = acquired ?? (await acquireText(captureDir, AGENCY_ID));
  const refused: Refusal[] = [];
  const quotes: Record<string, string> = {};

  const fw = FIELDWORK_RE.exec(source.articleText);
  const fieldwork = fw
    ? parseBgFieldworkRange(fw[1].replace(/\s*[–—-]\s*/u, " - "))
    : null;
  if (fieldwork) quotes.fieldwork = fw![0];
  else
    refused.push({
      field: "fieldwork",
      reason: 'no „в периода …" range in the article text',
      quote: "",
    });

  const sample = SAMPLE_RE.exec(source.articleText);
  if (sample) quotes.sampleSize = sample[0];
  else
    refused.push({
      field: "sampleSize",
      reason: "no sample size in the article text",
      quote: "",
    });

  // The vote table: the first bulletin page that carries the heading.
  const page = source.imageTexts.find((i) => VOTE_HEADING_RE.test(i.text));
  const table = page ? parseVoteTable(page.text) : null;
  if (!table)
    refused.push({
      field: "questions",
      reason: "no parliamentary vote table found in the bulletin OCR",
      quote: "",
    });

  const gated = table
    ? gateShares(table.claims, page!.text)
    : { accepted: [] as ShareClaim[], refused: [] as Refusal[] };
  refused.push(...(table?.refused ?? []), ...gated.refused);
  for (const c of gated.accepted) quotes[`share:${c.label}`] = c.quote;
  if (table?.other) quotes["share:Друга партия"] = table.other.quote;

  const id = fieldwork
    ? mintPollId(AGENCY_ID, fieldwork.endIso)
    : `sh-pub-${pubId}`;
  if (!fieldwork)
    refused.push({
      field: "poll.id",
      reason: "no fieldwork end date — provisional pubId-keyed id",
      quote: "",
    });
  refused.push({
    field: "methodology",
    reason: "Source review required for method and English translation",
    quote: "",
  });

  const residual: PollResidual | null = table?.other
    ? {
        undecided: null,
        wontVote: null,
        wontSay: null,
        otherNamedMinor: table.other.value,
      }
    : null;

  const poll: DraftPoll = {
    id,
    agencyId: AGENCY_ID,
    source: stamp.url,
    electionDate: null,
    respondents: sample ? Number(sample[1]) : null,
    publishedAt: stamp.publishedAt ?? null,
    genre: "unclear",
    ...(fieldwork ? { fieldwork: fieldwork.fieldwork } : {}),
    provenance: {
      url: stamp.url,
      fetchedAt: stamp.fetchedAt,
      sha256: stamp.sha256,
      extractor: AGENCY_ID,
      fieldworkStart: fieldwork?.startIso ?? null,
      fieldworkEnd: fieldwork?.endIso ?? null,
      basePhrase: table?.basePhrase ?? null,
      quotes,
    },
  };

  const details: PollDetail[] = gated.accepted.map((c) => ({
    pollId: id,
    agencyId: AGENCY_ID,
    support: c.value,
    nickName_bg: c.label,
    nickName_en: "",
  }));

  return {
    race: "parliamentary",
    poll,
    details,
    residual,
    genre: "unclear",
    extractor: AGENCY_ID,
    evidence: quotes,
    refused,
  };
};
