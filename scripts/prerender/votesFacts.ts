// Build-time facts for the /votes/<date> prerender.
//
// WHY THIS EXISTS. Until now each of the 613 session bodies said one thing —
// "161 точки в дневния ред на това заседание. Кликнете върху точка…" — an integer and a
// UI instruction, on a page holding every MP's vote on every item. That is fine for a
// crawler counting links and useless to an answer engine: a model asked "как гласува НС на
// 30 юли 2026" could extract the date and the item count and nothing else. Adding links
// fixes discovery; only facts fix answerability.
//
// WHY NOT THE SHIPPED SHARD. `derived/important_votes/<ns>.json` looks like the obvious
// source and is not: it is a top-15-PER-NS leaderboard whose 135 rows cluster onto 92 of
// 613 plenary days, so 85% of the bodies would have got nothing. The facts have to come
// from the session files, which the build can read even after the Postgres migration
// retires them from the bucket (they stay on disk as a load source).
//
// The scoring vocabulary is IMPORTED from the derived pipeline rather than restated. That
// heuristic is already duplicated once (the client-side scorer in useAreaImportantVotes),
// and its own comment asks for the two to be kept in sync; a third copy living in the
// prerender would drift silently, and the symptom would be a body naming different
// "headline" items than the module's own tiles.

import fs from "fs";
import path from "path";
import {
  castCount,
  contestScoreFor,
  importanceScore,
  outcomeFor,
} from "../parliament/derived/important_votes";
import { normalizeTitle } from "../parliament/derived/dedupe";
import type { SessionFile } from "../parliament/derived/types";

/** One named item, with enough on it to state a fact in a sentence. */
export interface SessionFact {
  item: number;
  slug: string;
  title: string;
  yes: number;
  no: number;
  abstain: number;
  absent: number;
  outcome: ReturnType<typeof outcomeFor>;
  score: number;
}

export interface SessionFacts {
  date: string;
  ns: string;
  /** Every item on the day, including the procedural ones the scorer drops. */
  totalItems: number;
  /** The scored headline items, best first. */
  top: SessionFact[];
}

const sessionPath = (projectRoot: string, date: string): string =>
  path.join(projectRoot, "data/parliament/votes/sessions", `${date}.json`);

/** Read ONE day. Deliberately one file at a time rather than the whole tree: the corpus is
 *  288 MB across 613 files, and the builder walks it once — holding it all would cost more
 *  than the prerender itself. */
export const readSessionFacts = (
  projectRoot: string,
  date: string,
  topN = 4,
): SessionFacts | null => {
  const file = sessionPath(projectRoot, date);
  if (!fs.existsSync(file)) return null;
  let session: SessionFile;
  try {
    session = JSON.parse(fs.readFileSync(file, "utf-8")) as SessionFile;
  } catch {
    return null;
  }
  return factsFromSession(session, topN);
};

/** Split out so the scoring is testable without touching the filesystem. */
export const factsFromSession = (
  session: SessionFile,
  topN = 4,
): SessionFacts => {
  const scored: SessionFact[] = [];
  for (const item of session.sessions ?? []) {
    // An item nobody voted on carries no fact worth stating.
    if (castCount(item) === 0) continue;
    const raw = session.itemTitles?.[String(item.item)];
    const title = raw ? normalizeTitle(raw) : "";
    if (!title) continue;
    const score = importanceScore(title, contestScoreFor(item));
    if (score === 0) continue;
    scored.push({
      item: item.item,
      slug: session.itemSlugs?.[String(item.item)] ?? String(item.item),
      title,
      yes: item.tallies.yes,
      no: item.tallies.no,
      abstain: item.tallies.abstain,
      absent: item.tallies.absent ?? 0,
      outcome: outcomeFor(item),
      score,
    });
  }

  // Collapse the article-by-article second-reading runs: a bill voted through §1..§40
  // would otherwise fill every headline slot with the same bill's paragraphs. Keep the
  // best-scoring item per title stem, which is the same shape the derived pipeline uses.
  const bestByStem = new Map<string, SessionFact>();
  for (const fact of scored) {
    const stem = fact.title.slice(0, 60);
    const prev = bestByStem.get(stem);
    if (!prev || fact.score > prev.score) bestByStem.set(stem, fact);
  }

  const top = [...bestByStem.values()]
    .sort((a, b) => b.score - a.score || a.item - b.item)
    .slice(0, topN);

  return {
    date: session.date,
    ns: session.ns,
    totalItems: session.sessions?.length ?? 0,
    top,
  };
};

/** "137 за, 25 против, 3 въздържали се" — the tally as a clause, so the sentence around it
 *  can be quoted whole. Zero-valued parts are dropped rather than printed, because "0
 *  против" reads as an assertion nobody made. */
export const tallyClause = (fact: SessionFact, lang: "bg" | "en"): string => {
  const words =
    lang === "bg"
      ? { yes: "за", no: "против", abstain: "въздържали се" }
      : { yes: "for", no: "against", abstain: "abstained" };
  const parts: string[] = [`${fact.yes} ${words.yes}`];
  if (fact.no > 0) parts.push(`${fact.no} ${words.no}`);
  if (fact.abstain > 0) parts.push(`${fact.abstain} ${words.abstain}`);
  return parts.join(", ");
};

const OUTCOME_WORD: Record<string, { bg: string; en: string }> = {
  passed: { bg: "приет", en: "passed" },
  passed_unanimous: { bg: "приет единодушно", en: "passed unanimously" },
  rejected: { bg: "отхвърлен", en: "rejected" },
  rejected_unanimous: {
    bg: "отхвърлен единодушно",
    en: "rejected unanimously",
  },
  abstain_unanimous: { bg: "без подкрепа", en: "no support" },
  contested: { bg: "оспорван", en: "contested" },
};

export const outcomeWord = (fact: SessionFact, lang: "bg" | "en"): string =>
  OUTCOME_WORD[fact.outcome]?.[lang] ?? OUTCOME_WORD.contested[lang];
