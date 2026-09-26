/** Conservative presidential extraction for AR, ML, SH, MY and GIB.
 * Only a labelled voting question can own rows. Multiple columns, unclear
 * chart values and missing methodology stay in the review queue. */
import fs from "node:fs";
import { extractMarketLinksPresidential } from "./market_links_presidential";
import { presidentialDraftId } from "../lib/draft_identity";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PollQuestion,
  PollBase,
  PollResidual,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
import { transliterateName } from "../../../src/data/candidates/transliterateName";
import { resolveCandidate } from "../presidential/candidate_resolver";
import type { PresidentialInboxDraft } from "../lib/draft";
import {
  gateShares,
  type Refusal,
  type ShareClaim,
} from "../lib/evidence_gate";
import {
  acquireText,
  extractPageTitle,
  type AcquiredText,
} from "../lib/text_acquisition";
import { isExitPollTitle } from "../agencies/wp_lister";
import { parseBgFieldworkRange } from "../lib/fieldwork_bg";
import {
  resolvePresidentialCycle,
  presidentialRound1Date,
} from "../lib/presidential_cycle";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const HEADING =
  /електорални нагласи\s*[-–:]\s*президентски избори|(?:за кого|за кой кандидат)[^?\n]{0,180}(?:президент|президентски)[^?\n]*\?/iu;
const NAME_ROW =
  /([А-Я][а-я]+(?:\s+[А-Я][а-я]+){1,2}|[Нн]е подкрепям никого)\s*[:|–—\-█\s]*(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/u;

export interface QuestionRows {
  wording: string;
  claims: ShareClaim[];
  refused: Refusal[];
  base?: PollBase;
  residual?: PollResidual;
  extraEvidence?: Record<string, string>;
}
export const extractPresidentialTable = (text: string): QuestionRows | null => {
  const heading = HEADING.exec(text);
  if (!heading) return null;
  if ([...text.matchAll(new RegExp(HEADING.source, "giu"))].length > 1)
    return {
      wording: heading[0],
      claims: [],
      refused: [
        {
          field: "questions",
          reason:
            "Multiple voting tables in one document require separate question/base mapping",
          quote: heading[0],
        },
      ],
    };
  const section = text
    .slice(heading.index + heading[0].length)
    .split(/\f|База:|(?:Електорални нагласи|За коя партия)/iu)[0];
  const lines = section.split(/\r?\n/);
  const claims: ShareClaim[] = [];
  const refused: Refusal[] = [];
  // A second percentage-only row is a second series, not another candidate.
  const multiColumn =
    lines.some((line) => /^\s*\d+(?:[.,]\d+)?\s*%\s*$/.test(line)) ||
    lines.some((line) => (line.match(/%/g)?.length ?? 0) > 1);
  if (multiColumn)
    return {
      wording: heading[0],
      claims: [],
      refused: [
        {
          field: "questions",
          reason:
            "Multiple percentage series require reviewed column/base mapping",
          quote: section.trim(),
        },
      ],
    };
  for (const line of lines) {
    const match = NAME_ROW.exec(line.trim());
    if (!line.trim()) continue;
    if (!match) {
      if (!claims.length)
        refused.push({
          field: "questions",
          reason:
            "Unrecognized row after voting heading; inspect chart structure",
          quote: line.trim(),
        });
      break;
    }
    const claim = {
      label: match[1],
      value: Number(match[2].replace(",", ".")),
      quote: line.trim(),
    };
    if (claim.value > 100) {
      refused.push({
        field: `share:${claim.label}`,
        reason: "Percentage exceeds 100",
        quote: claim.quote,
      });
      continue;
    }
    const gate = gateShares([claim], text);
    claims.push(...gate.accepted);
    refused.push(...gate.refused);
  }
  return { wording: heading[0], claims, refused };
};

export const extractAgencyPresidential = async (
  agencyId: string,
  captureDir: string,
  pubId: string,
  acquired?: AcquiredText,
): Promise<PresidentialInboxDraft> => {
  const stamp = JSON.parse(
    fs.readFileSync(path.join(captureDir, "SOURCE.json"), "utf8"),
  );
  if (!stamp.url || !stamp.sha256 || !stamp.fetchedAt)
    throw new Error("Invalid primary source stamp");
  const title = extractPageTitle(
    fs.readFileSync(path.join(captureDir, "page.html"), "utf8"),
  );
  if (isExitPollTitle(title))
    throw new Error("Exit-poll publication excluded from pre-election corpus");
  const source = acquired ?? (await acquireText(captureDir, agencyId));
  const documents = [
    { file: "page.html", text: source.articleText },
    ...source.pdfTexts,
    ...source.imageTexts,
  ];
  const refused: Refusal[] = [];
  const evidence: Record<string, string> = {};
  const text = documents.map((d) => d.text).join("\n");
  const ranges = [
    ...text.matchAll(
      /(?:периода|провеждане:)\s*(\d{1,2}\s*[–—-]\s*\d{1,2}\s+[а-я]+\s+\d{4})/giu,
    ),
  ];
  const distinctRanges = new Set(ranges.map((m) => m[1].replace(/\s+/g, " ")));
  const fieldworkMatch = distinctRanges.size === 1 ? ranges[0] : null;
  const fieldwork = fieldworkMatch
    ? parseBgFieldworkRange(fieldworkMatch[1])
    : null;
  if (fieldwork) evidence.fieldwork = fieldworkMatch![0];
  else
    refused.push({
      field: "fieldwork",
      reason: "No unambiguous fieldwork range; inspect source methodology",
      quote: "",
    });
  const samples = [
    ...text.matchAll(
      /(?:сред|извадката:)\s*(\d{3,5})\s*(?:лица|души|пълнолетни|респонденти)/giu,
    ),
  ];
  const sample =
    new Set(samples.map((m) => m[1])).size === 1 ? samples[0] : null;
  if (sample) evidence.sampleSize = sample[0];
  else
    refused.push({
      field: "respondents",
      reason: "No unambiguous overall sample size",
      quote: "",
    });
  const id = fieldwork
    ? presidentialDraftId(`${agencyId.toLowerCase()}-${fieldwork.endIso}`)
    : presidentialDraftId(`${agencyId.toLowerCase()}-pub-${pubId}`);
  const cycle = fieldwork
    ? resolvePresidentialCycle(ROOT, fieldwork.endIso)
    : null;
  const questions: PollQuestion[] = [];
  const details: PresidentialPollDetail[] = [];
  for (const doc of documents) {
    const mapped =
      agencyId === "ML" ? extractMarketLinksPresidential(doc.text) : null;
    const fallback = mapped ? null : extractPresidentialTable(doc.text);
    const tables: QuestionRows[] = mapped
      ? mapped.map((table) => ({ ...table, refused: [] }))
      : fallback
        ? [fallback]
        : [];
    for (const table of tables) {
      refused.push(...table.refused);
      if (!table.claims.length) continue;
      const qid = `vote-${questions.length + 1}`;
      for (const [field, quote] of Object.entries(table.extraEvidence ?? {}))
        evidence[`${qid}:${field}`] = quote;
      questions.push({
        id: qid,
        race: "presidential",
        cycle,
        round: null,
        measure: "vote_intention",
        wording: {
          bg: table.wording,
          en: "Presidential voting intention (source wording requires review)",
        },
        base: table.base ?? {
          kind: "unknown",
          label: { bg: "Неуточнена база", en: "Unresolved population base" },
          respondents: null,
          includesNone: null,
        },
        scenario: null,
        answerScale: [
          { code: "support", label: { bg: "Подкрепа", en: "Support" } },
        ],
        genre: "unclear",
        residual: table.residual ?? null,
        evidence: { url: stamp.url, quote: table.wording, locator: doc.file },
        scoring: {
          eligible: false,
          reason:
            "Question round, population base and chart values await source review",
        },
      });
      for (const c of table.claims) {
        evidence[`${qid}:${c.label}`] = c.quote;
        details.push({
          pollId: id,
          agencyId,
          questionId: qid,
          answerCode: "support",
          candidateKey: resolveCandidate(c.label, [], cycle).candidateKey,
          candidateName_bg: c.label,
          candidateName_en: transliterateName(c.label),
          nominator: null,
          placeholderFor: null,
          support: c.value,
        });
      }
    }
  }
  if (!questions.length)
    refused.push({
      field: "questions",
      reason:
        "No safely mapped presidential voting table; review narrative, chart or multiple-column source",
      quote: title,
    });
  refused.push({
    field: "methodology",
    reason:
      "Source review required for method, question/base and English translation",
    quote: "",
  });
  return {
    race: "presidential",
    poll: {
      id,
      agencyId,
      source: stamp.url,
      cycle,
      electionDate: cycle ? presidentialRound1Date(cycle) : null,
      publishedAt: stamp.publishedAt ?? null,
      ...(fieldwork ? { fieldwork: fieldwork.fieldwork } : {}),
      respondents: sample ? Number(sample[1]) : null,
      questions,
      genre: "unclear",
      provenance: {
        url: stamp.url,
        fetchedAt: stamp.fetchedAt,
        sha256: stamp.sha256,
        extractor: agencyId,
        fieldworkStart: fieldwork?.startIso ?? null,
        fieldworkEnd: fieldwork?.endIso ?? null,
        basePhrase: null,
        quotes: evidence,
      },
    },
    details,
    runoffs: [],
    residual: null,
    genre: "unclear",
    extractor: agencyId,
    evidence,
    refused,
  };
};
