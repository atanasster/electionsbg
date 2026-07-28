// Rebuild awarder_risk_grade_scoped — the per-pscope leaderboard table the UI
// reads (via awarder_risk_grade_top). It has THREE upstream writers that all
// change its inputs: a contract load (load_pg), a TR load (load_tr_pg, fresh
// company_politicians via 041), and the КЗК ingest (kzk_appeals.ts --apply,
// fresh buyer_appeal_stats). Each must call this after refreshing
// awarder_risk_grade_ranking so the served leaderboard doesn't go stale and
// contradict the live per-entity grade on /company/:eik (FINDING-007).
//
// Uses DELETE (not TRUNCATE): row-level locks let live awarder_risk_grade_top()
// readers keep the old snapshot until COMMIT, instead of TRUNCATE's ACCESS
// EXCLUSIVE stalling the leaderboard endpoint for the whole ~26-window recompute
// (FINDING-008).

import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  allScopeWindows,
  type ElectionRef,
} from "../../../src/data/scope/windows";

const COLS =
  "eik, name, total_eur, supplier_count, linked_eur, score, grade, " +
  "connection_share, single_share, direct_share, conc_share, upheld_share";

export const rebuildRiskGradeScoped = async (
  c: PoolClient,
): Promise<number> => {
  // The scope windows the UI can request. Derived by the SAME function the React hook
  // calls (src/data/scope/windows) rather than re-implemented here: a precompute keyed on
  // a window the UI computes differently serves the wrong period under the right label,
  // which no test of this file alone would catch.
  const elections = JSON.parse(
    readFileSync(
      new URL("../../../src/data/json/elections.json", import.meta.url),
      "utf8",
    ),
  ) as ElectionRef[];
  // 'all' is inserted separately below from the already-refreshed corpus matview, so it is
  // filtered out of the windowed loop rather than recomputed.
  const windows = allScopeWindows(elections, new Date().getFullYear()).filter(
    (w) => w.key !== "all",
  );

  await c.query("BEGIN");
  try {
    await c.query("DELETE FROM awarder_risk_grade_scoped");
    // 'all' reuses the just-refreshed corpus matview (no recompute).
    await c.query(
      `INSERT INTO awarder_risk_grade_scoped SELECT 'all', ${COLS} FROM awarder_risk_grade_ranking`,
    );
    for (const w of windows) {
      await c.query(
        `INSERT INTO awarder_risk_grade_scoped
           SELECT $1, ${COLS} FROM awarder_risk_grade_window($2::text, $3::text)`,
        [w.key, w.from, w.to],
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
  return windows.length + 1;
};
