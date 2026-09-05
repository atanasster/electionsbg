// `npm run data -- --pvr <cycle>` — read a presidential cycle and write its tree.
//
// Pure and offline: every input is committed — `raw_data/<cycle>/ТУР1|ТУР2`,
// `data/settlements.json`, `data/presidential/abroad_cities.json` and
// `data/presidential/party_colors.json` — so this needs no network and produces the same
// bytes on any machine. Downloading a bundle is `--pvr-download`, a separate operator
// step.
//
// ⚠ THAT LAST FILE EXISTS BECAUSE THE CLAIM WAS ONCE FALSE. `tickets.ts` read the
// parliamentary `cik_parties.json` catalogues directly, and those are GITIGNORED — 0
// tracked against 13 on disk — so on a fresh clone or a CI runner `tickets.json` lost
// every brand colour, at exit 0, with every vote figure still reconciling. The colours
// now come from a small derived table that IS committed; `build_party_colors.ts` rebuilds
// it.
//
// ⚠ THE RUN REPORTS WHAT IT COULD NOT PLACE, EVERY TIME. The per-oblast files exclude
// 2011's 1,354 refused sections — 441,328 votes, 13.1% of that round — and the abroad
// files carry sections whose country the corpus cannot name. Those are written and
// counted, never dropped, and a run that printed only „done" would leave an operator with
// no way to notice a placement regression that halved the coverage.
//
// Plan: docs/plans/presidential-elections-v1.md T3.4.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateRound, writeRound, type AggregatedRound } from "./aggregate";
import { buildNationalSummary } from "./nationalSummary";
import { describePlacement } from "./places";
import { readPresidentialRound } from "./readers";
import { PRESIDENTIAL_CYCLES } from "./sources";
import { buildTicketCatalogue } from "./tickets";
import type { PresidentialRound } from "./types";
import type { RoundNumber } from "./sources";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export interface IngestOptions {
  /** Where to write. Defaults to the repo's `data/`. */
  dataRoot?: string;
  /** JSON indent; 0 minifies, which is what `--prod` wants. */
  indent?: number;
  /** Where to read from. Defaults to the repo's `raw_data/`. */
  rawRoot?: string;
  /** Where progress and the placement residue go. Defaults to `console.log`. */
  log?: (line: string) => void;
}

export interface IngestResult {
  cycle: string;
  files: string[];
  rounds: { round: RoundNumber; sections: number; placedShort: number }[];
}

const writeJson = (file: string, value: unknown, indent: number): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(value, null, indent > 0 ? indent : undefined)}\n`,
  );
};

/**
 * Read a cycle and write `data/<cycle>/`.
 *
 * @param cycle - A cycle id, e.g. `2011_10_23_pvr`.
 * @param options - See `IngestOptions`.
 * @returns The files written and a per-round summary.
 * @throws If the cycle is unknown, if a round's raw folder is missing, or if any of the
 *   guards downstream fire — a half-written tree is worse than a failed run, so nothing
 *   is written until every round has been read and aggregated.
 */
export const ingestPresidentialCycle = (
  cycle: string,
  options: IngestOptions = {},
): IngestResult => {
  const dataRoot = options.dataRoot ?? path.join(PROJECT_ROOT, "data");
  const rawRoot = options.rawRoot ?? path.join(PROJECT_ROOT, "raw_data");
  const indent = options.indent ?? 2;
  const log = options.log ?? ((line: string) => console.log(line));

  if (!PRESIDENTIAL_CYCLES.includes(cycle)) {
    throw new Error(
      `--pvr: no cycle "${cycle}" — pass "all", or one of ` +
        `${PRESIDENTIAL_CYCLES.join(", ")}`,
    );
  }

  // ⚠ READ AND AGGREGATE EVERYTHING BEFORE WRITING ANYTHING. Every guard in this
  // pipeline throws — a refused prefix, a mispaired aggregation, a renumbered ballot —
  // and a tree half-written by a run that then failed is a corpus where some files are
  // the new vintage and the rest the old, with nothing saying which.
  const rounds: PresidentialRound[] = [];
  const aggs: AggregatedRound[] = [];
  for (const round of [1, 2] as RoundNumber[]) {
    const dir = path.join(rawRoot, cycle, round === 1 ? "ТУР1" : "ТУР2");
    if (!fs.existsSync(dir)) {
      // ⚠ A cycle decided in round 1 would legitimately have no ТУР2 — none in this
      // corpus is, but the shape has to allow it, and `decideCycle` is what refuses the
      // contradiction of a round-1 win with a runoff beside it.
      if (round === 1) {
        throw new Error(`--pvr: ${cycle} has no ${dir}`);
      }
      break;
    }
    const r = readPresidentialRound(cycle, round, dir);
    rounds.push(r);
    aggs.push(aggregateRound(r));
  }

  const summary = buildNationalSummary(rounds, aggs);
  const tickets = buildTicketCatalogue(rounds);

  const files: string[] = [];
  for (const agg of aggs) {
    files.push(...writeRound(agg, dataRoot, indent));
    log(describePlacement(agg.placement));
  }
  writeJson(
    path.join(dataRoot, cycle, "national_summary.json"),
    summary,
    indent,
  );
  files.push(path.join(cycle, "national_summary.json"));
  writeJson(path.join(dataRoot, cycle, "tickets.json"), tickets, indent);
  files.push(path.join(cycle, "tickets.json"));

  log(
    `[pvr] ${cycle}: ${summary.winner.president} elected in round ` +
      `${summary.decidedInRound}; ${files.length} files`,
  );
  // ⚠ Named whenever there is something to name, and SILENT otherwise. „13.1% of this
  // round is not in the per-oblast files" is a fact an operator has to be told rather than
  // look up — and a line reporting „0 section(s) (0 votes)" on every clean round is noise
  // an operator learns to skip, which is how the one saying 1,354 gets skipped too. The
  // two halves are reported separately for the same reason: 2006 has nine abroad sections
  // with no country and no refusals at all.
  for (const r of summary.rounds) {
    if (r.unplaced.sections) {
      log(
        `[pvr] ${cycle} round ${r.round}: ${r.unplaced.sections} section(s) ` +
          `(${r.unplaced.votes} votes) are in no per-oblast file`,
      );
    }
    if (r.abroad.sectionsWithoutCountry) {
      log(
        `[pvr] ${cycle} round ${r.round}: ${r.abroad.sectionsWithoutCountry} abroad ` +
          `section(s) have no country`,
      );
    }
  }
  if (tickets.neutralTickets) {
    log(
      `[pvr] ${cycle}: ${tickets.neutralTickets} of ${tickets.tickets.length} ` +
        `tickets carry a neutral colour (no identified nominating body)`,
    );
  }

  return {
    cycle,
    files: files.sort(),
    // ⚠ Keyed off each aggregation's OWN round rather than the summary's index — the
    // positional pairing T3.2 records as a bug class, and there is no reason to
    // reintroduce it here.
    rounds: aggs.map((a) => ({
      round: a.round,
      sections: a.placement.sections,
      placedShort: a.placement.unplaced.length,
    })),
  };
};

/** Every committed cycle, oldest first. */
export const ingestAllPresidential = (
  options: IngestOptions = {},
): IngestResult[] =>
  [...PRESIDENTIAL_CYCLES]
    .sort()
    .map((cycle) => ingestPresidentialCycle(cycle, options));
