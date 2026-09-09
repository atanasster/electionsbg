// Tier 2c — the party-name vocabulary the sentence-rule extractor (§6.2)
// scans text against. Deliberately NOT a new registry: it unions two
// already-curated sources rather than hand-listing labels from scratch.
//
//  - `POLL_TO_ACTUAL`'s keys are agency-published FULL-NAME spellings
//    (src/data/polls/aliases.ts) — curated over years of real polls
//    specifically because they don't already match an actual-results key.
//  - The most recent election's ballot nicknames (src/data/json/elections.json)
//    are the bare abbreviations (ГЕРБ-СДС, ПП-ДБ, ДПС, Възраждане, МЕЧ, …)
//    agencies also write bare in prose, with no alias needed because the
//    nickname IS what gets published.
//
// A label present in neither source (a periphrasis like "новата формация на
// Румен Радев", 212637) is deliberately NOT recognised — decision 5's rule
// is that a value with no matched label produces no claim at all, rather
// than a guessed one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POLL_TO_ACTUAL } from "../../../src/data/polls/aliases";

interface ElectionsFile {
  name: string;
  results?: { votes: { nickName: string }[] };
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const latestBallotNickNames = (): string[] => {
  const elections = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "src/data/json/elections.json"),
      "utf8",
    ),
  ) as ElectionsFile[];
  // Re-sort rather than trust the file's own order — the same defensive
  // step scripts/parsers/canonicalParties.ts takes reading this same file,
  // rather than the same ASSUMPTION restated without it. `name` is
  // "YYYY_MM_DD", so a plain string sort is a correct date sort.
  const withResults = elections.filter((e) => e.results?.votes.length);
  const latest = [...withResults].sort((a, b) =>
    b.name.localeCompare(a.name),
  )[0];
  return latest?.results?.votes.map((v) => v.nickName) ?? [];
};

/** Every recognised party-label surface form, LONGEST FIRST so a scan
 *  prefers "ГЕРБ-СДС" over the "ГЕРБ" prefix it contains. */
export const KNOWN_PARTY_LABELS: string[] = Array.from(
  new Set([
    ...Object.keys(POLL_TO_ACTUAL),
    ...Object.values(POLL_TO_ACTUAL),
    ...latestBallotNickNames(),
  ]),
).sort((a, b) => b.length - a.length);
