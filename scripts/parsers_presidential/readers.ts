// One entry point for all five eras.
//
// Every cycle DECLARES its era in `sources.ts`, and this is the only place that turns
// that declaration into a reader. Callers name a cycle and a round; they never pick a
// reader, and adding a sixth era is a line here plus a `PresidentialEra` member — which
// the exhaustiveness check below turns into a compile error rather than a runtime
// surprise.
//
// Plan: docs/plans/presidential-elections-v1.md T2.6, T3.1.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEra2001Round } from "./era2001";
import { readEra2006Round } from "./era2006";
import { readEra2011Round } from "./era2011";
import { readEra2016Round } from "./era2016";
import { readEra2021Round } from "./era2021";
import {
  PRESIDENTIAL_CYCLES,
  presidentialSource,
  roundFolderName,
  type PresidentialEra,
  type PresidentialSource,
  type RoundNumber,
} from "./sources";
import type { PresidentialRound } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type EraReader = (
  dir: string,
  source: PresidentialSource,
  round: RoundNumber,
) => PresidentialRound;

/**
 * Era → reader.
 *
 * ⚠ `Record<PresidentialEra, …>` on purpose, not a partial map with a runtime fallback:
 * a new era added to the union fails to compile here, which is the one place where
 * „somebody will remember" is not good enough — a missing reader would otherwise surface
 * as an absent cycle in the catalogue, which reads as „that election is not covered"
 * rather than as a defect.
 */
export const PRESIDENTIAL_READERS: Record<PresidentialEra, EraReader> = {
  "2001": readEra2001Round,
  "2006": readEra2006Round,
  "2011": readEra2011Round,
  "2016": readEra2016Round,
  "2021": readEra2021Round,
};

/**
 * The cycle ids, OLDEST FIRST — the order these gates iterate in.
 *
 * ⚠ Derived from `sources.ts`'s own `PRESIDENTIAL_CYCLES`, which is NEWEST first
 * (it feeds a selector, where the latest election belongs at the top). Exporting a
 * second constant under the same name from the same directory is how two files end up
 * disagreeing about an order they both document; this one is named for its direction
 * and is a reversal of the gated list rather than an independent derivation.
 */
export const PRESIDENTIAL_CYCLES_OLDEST_FIRST: string[] = [
  ...PRESIDENTIAL_CYCLES,
].reverse();

/** Where a cycle's round lives under `raw_data/`. */
const presidentialRoundDir = (cycle: string, round: RoundNumber): string =>
  path.join(PROJECT_ROOT, "raw_data", cycle, roundFolderName(round));

/**
 * Read one round of one cycle, through its declared era's reader.
 *
 * @param cycle - A cycle id, e.g. `2011_10_23_pvr`.
 * @param round - 1 or 2.
 * @param dir - Override the folder; defaults to the committed `raw_data/` tree. There is
 *   no caller today — it exists so a gate can point the dispatcher at a mutated copy
 *   without reaching past it to an era reader, which is what the per-era suites do.
 * @throws If the cycle is not in `sources.ts`.
 */
export const readPresidentialRound = (
  cycle: string,
  round: RoundNumber,
  dir: string = presidentialRoundDir(cycle, round),
): PresidentialRound => {
  // ⚠ Through `presidentialSource`, not a fresh `find`: that helper carries the
  // prototype-pollution guard its own header explains (a bare index answers
  // `PRESIDENTIAL_SOURCES["toString"]` with a truthy function) and the ЦИК-slug
  // fallback. Re-implementing the lookup here would quietly drop both.
  const source = presidentialSource(cycle);
  if (!source) {
    throw new Error(
      `readPresidentialRound: no cycle "${cycle}" in sources.ts — known cycles are ` +
        `${PRESIDENTIAL_CYCLES.join(", ")}`,
    );
  }
  return PRESIDENTIAL_READERS[source.era](dir, source, round);
};
