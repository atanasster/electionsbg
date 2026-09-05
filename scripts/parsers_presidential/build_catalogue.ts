// Derive `src/data/json/presidential_elections.json` from the committed raw corpus.
//
//     npx tsx scripts/parsers_presidential/build_catalogue.ts          # report only
//     npx tsx scripts/parsers_presidential/build_catalogue.ts --write  # rewrite it
//
// ⚠ THE CATALOGUE IS NAVIGATION AND SHIPS IN THE ENTRY BUNDLE, so everything a selector
// row or a route guard needs is here and nothing else is. `src/data/presidentialCatalogue.ts`
// carries the shape and the field-by-field reasoning.
//
// ⚠ IT IS DERIVED RATHER THAN TYPED OUT BECAUSE FIVE OF ITS SIX FIELDS ARE MEASUREMENTS —
// only `name` and the two dates are declared. `decidedInRound` and `winnerTicket` come from
// art. 93 (3) applied to the votes, the one rule this plan refuses to copy from a source
// field (decision 5); `tickets` is a count over round 1's 61,362 sections, and the two
// capability flags are counts over all 122,716. A hand-written catalogue is a second
// opinion about every one of them that nothing keeps in step; measured here,
// `build_catalogue.test.ts` fails the day it drifts.
//
// ⚠ ONE FACT IS NOT A MEASUREMENT AND CANNOT BE. No presidential reader ingests the
// machine flash-memory tree, so `flashRecords` is not visible anywhere in the parsed
// corpus. It is read from the path each round declares in `sources.ts` and confirmed
// against the tree on disk — see `RoundSource.flashRecords`.
//
// Plan: docs/plans/presidential-elections-v1.md T4.1, decision 2.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPresidentialRound } from "./readers";
import {
  PRESIDENTIAL_CYCLES,
  presidentialSource,
  roundFolderName,
} from "./sources";
import { decideCycle, tallyRound, type RoundTally } from "./winnerRule";
import type { RoundNumber } from "./sources";
import type { PresidentialRound } from "./types";
import type {
  PresidentialElectionEntry,
  PresidentialRoundInfo,
} from "@/data/presidentialCatalogue";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const CATALOGUE_PATH = path.join(
  PROJECT_ROOT,
  "src/data/json/presidential_elections.json",
);

/**
 * Does the declared flash-record tree exist and hold per-section archives?
 *
 * ⚠ NON-EMPTINESS IS THE QUESTION, not existence. A tree is committed as its FILES, so an
 * empty `suemg/` directory survives a half-restored working copy and would publish
 * „flash records were released for this round" against nothing — the `assertCommitted`
 * argument, one directory down. It walks rather than reading the top level, because both
 * trees shard by oblast (`suemg/01/…`) and the top level is all directories.
 *
 * @param rel - Repo-relative path from `RoundSource.flashRecords`.
 * @returns Whether at least one file lives under it.
 */
export const flashTreeHasRecords = (rel: string): boolean => {
  // ⚠ `resolve`, not `join`: an absolute path passed by a test (a `mkdtemp` probe) would
  // otherwise be concatenated onto the repo root and silently miss, so the negative
  // control would pass for the wrong reason — as a second spelling of „this path does not
  // exist" rather than as the case it was written for.
  const abs = path.resolve(PROJECT_ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return false;
  const stack = [abs];
  while (stack.length) {
    for (const entry of fs.readdirSync(stack.pop()!, { withFileTypes: true })) {
      // ⚠ AN ARCHIVE, NOT „ANY FILE". `raw_data/2021_11_14/suemg/.DS_Store` already
      // exists on macOS, and so does one a directory down — so „at least one file" calls
      // a tree that has lost all 11,859 archives „published", which is precisely the
      // half-restored working copy this walk exists to refuse.
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))
        return true;
      if (entry.isDirectory())
        stack.push(path.join(entry.parentPath, entry.name));
    }
  }
  return false;
};

/**
 * What a parsed round supports, plus the declared flash tree.
 *
 * ⚠ `machineVoting` READS THE VOTES, NOT THE MACHINE COUNT. A section can carry machines
 * whose rows the era does not publish per ticket, and „there were machines here" is not
 * the question a paper/machine split asks — the split renders `machineVotes`, so what
 * matters is whether any exist. Measured 2026-09-05: the two agree on all ten rounds
 * (2016 has 500 sections and 41,585 machine votes, 2021 has 9,607 and 2,305,407), so this
 * is a choice between two currently-equal readings and the votes are the one the consumer
 * uses.
 */
export const roundCapabilities = (
  round: PresidentialRound,
  tally: RoundTally,
  flashTree: string | undefined,
): PresidentialRoundInfo => ({
  machineVoting: round.sections.some((s) =>
    s.votes.some((v) => (v.machineVotes ?? 0) > 0),
  ),
  flashRecords: flashTree ? flashTreeHasRecords(flashTree) : false,
  // ⚠ The caller's tally, not a second one computed here. `undefined` is the era's answer
  // rather than a missing measurement — `tallyRound` leaves it absent when the form did
  // not ask, which is the distinction this flag carries — and re-deriving it beside the
  // one `decideCycle` already holds creates a second opinion about the same round.
  noneOfTheAbove: tally.noneOfTheAbove !== undefined,
  // ⚠ ROUNDED TO TWO PLACES SO THE FILE IS BYTE-STABLE. A raw double re-serialises
  // identically today and would not survive a change in how the sum is accumulated; the
  // band renders one decimal, so nothing is lost and the committed diff stays reviewable.
  turnoutPct:
    tally.turnout === null ? null : Math.round(tally.turnout * 10000) / 100,
  // ⚠ DERIVED FROM THE SENTENCE the corpus rule produces, because that rule is the one
  // definition of when abroad falls out of the ratio — re-deriving the condition here would
  // be a second opinion about 2006 that nothing keeps in step.
  turnoutBasis: tally.turnoutBasis.includes("само в страната")
    ? "domestic-only"
    : "all-sections",
});

/**
 * Build one cycle's catalogue entry.
 *
 * ⚠ IT READS THE REPO'S OWN `raw_data/`, WITH NO OVERRIDE. A `rawRoot` parameter would be
 * honoured by the round reads and ignored by `flashTreeHasRecords`, which resolves against
 * the repo — so a fixture run would take votes from the fixture and flash records from the
 * working copy, and `flashRecords` is the one field whose output cannot betray the mix.
 * Both callers read the real corpus by design.
 *
 * @param cycle - A cycle id, e.g. `2016_11_06_pvr`.
 * @throws If the cycle is unknown, if round 1 is missing, or if any guard downstream fires
 *   — a catalogue row that quietly fell back to a default is a wrong claim on the
 *   navigation bar.
 */
export const buildCatalogueEntry = (
  cycle: string,
): PresidentialElectionEntry => {
  const source = presidentialSource(cycle);
  if (!source) {
    throw new Error(
      `--catalogue: no cycle "${cycle}" — one of ${PRESIDENTIAL_CYCLES.join(", ")}`,
    );
  }
  const rawRoot = path.join(PROJECT_ROOT, "raw_data");
  const roundDir = (round: RoundNumber): string =>
    path.join(rawRoot, cycle, roundFolderName(round));
  // ⚠ Round 1 is read OUTSIDE the optional path, so its type is non-optional and no `!`
  // hides the reason. A cycle with no first round is a broken tree, and treating it like
  // an absent runoff would produce a catalogue row describing a runoff as the whole
  // election.
  const dir1 = roundDir(1);
  if (!fs.existsSync(dir1)) {
    throw new Error(`--catalogue: ${cycle} has no ${dir1}`);
  }
  const round1 = readPresidentialRound(cycle, 1, dir1);
  const dir2 = roundDir(2);
  const runoff = fs.existsSync(dir2)
    ? readPresidentialRound(cycle, 2, dir2)
    : undefined;

  const tally1 = tallyRound(round1);
  const tally2 = runoff ? tallyRound(runoff) : undefined;
  const outcome = decideCycle(tally1, tally2);
  const rounds: PresidentialElectionEntry["rounds"] = {
    1: roundCapabilities(round1, tally1, source.rounds[1].flashRecords),
  };
  if (runoff && tally2) {
    rounds[2] = roundCapabilities(
      runoff,
      tally2,
      source.rounds[2].flashRecords,
    );
  }
  return {
    name: cycle,
    round1Date: round1.date,
    round2Date: runoff ? runoff.date : null,
    decidedInRound: outcome.decidedInRound,
    winnerTicket: {
      number: outcome.winner.number,
      president: outcome.winner.president,
      vicePresident: outcome.winner.vicePresident,
    },
    tickets: round1.tickets.length,
    rounds,
  };
};

/**
 * Every cycle, NEWEST FIRST.
 *
 * ⚠ The order is the file's, and it matches `elections.json` and `local_elections.json` —
 * every selector in this repo renders `[0]` as „the latest". A catalogue sorted the other
 * way puts 2001 at the top of the dropdown with nothing failing.
 */
export const buildCatalogue = (): PresidentialElectionEntry[] =>
  PRESIDENTIAL_CYCLES.map((c) => buildCatalogueEntry(c));

const main = (): void => {
  const built = buildCatalogue();
  for (const e of built) {
    console.log(
      `[catalogue] ${e.name}: ${e.tickets} ticket(s), decided in round ` +
        `${e.decidedInRound} by ${e.winnerTicket.president}; ` +
        Object.entries(e.rounds)
          .map(
            ([r, c]) =>
              // ⚠ THE TURNOUT IS IN THE LINE. Report-only mode exists so an operator can
              // see what a regenerate would change; the two fields the head band actually
              // renders were the ones it could not show.
              `r${r} [${
                [
                  c.machineVoting ? "machines" : null,
                  c.flashRecords ? "flash" : null,
                  c.noneOfTheAbove ? "никого" : null,
                ]
                  .filter(Boolean)
                  .join(" ") || "paper only"
              }` +
              `${c.turnoutPct === null ? " · no rate" : ` · ${c.turnoutPct}%`}` +
              `${c.turnoutBasis === "domestic-only" ? " (domestic)" : ""}]`,
          )
          .join(" "),
    );
  }
  const next = `${JSON.stringify(built, null, 2)}\n`;
  // ⚠ THE RAW BYTES, because that is what `build_catalogue.test.ts` compares. A
  // re-serialised comparison calls a reformatted file „unchanged" — a merge tool's
  // four-space indent, a lost trailing newline — while the gate calls it stale, so the
  // report-only run would disagree with the gate it fronts. Reading the file cannot throw
  // here: an unparseable catalogue is exactly the state `--write` exists to repair, and a
  // `JSON.parse` before the write is what would stop it running.
  const onDisk = fs.existsSync(CATALOGUE_PATH)
    ? fs.readFileSync(CATALOGUE_PATH, "utf8")
    : null;
  console.log(
    onDisk === next
      ? "[catalogue] unchanged"
      : onDisk === null
        ? "[catalogue] no file on disk — pass --write to create it"
        : "[catalogue] DIFFERS from the committed file — pass --write to rewrite it",
  );
  if (!process.argv.includes("--write")) {
    console.log("[catalogue] report only — pass --write to rewrite the file");
    return;
  }
  fs.mkdirSync(path.dirname(CATALOGUE_PATH), { recursive: true });
  fs.writeFileSync(CATALOGUE_PATH, next);
  console.log(`[catalogue] wrote ${CATALOGUE_PATH}`);
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
