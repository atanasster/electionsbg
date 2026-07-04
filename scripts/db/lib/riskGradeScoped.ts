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
import { PROCUREMENT_FIRST_YEAR } from "../../../src/data/procurement/constants";

// The scope windows the UI can request — MUST match src/data/procurement/
// useProcurementWindow: 'all' + each calendar year (from PROCUREMENT_FIRST_YEAR)
// + each parliament (election date → next-newer election).
const FIRST_YEAR = PROCUREMENT_FIRST_YEAR;
const COLS =
  "eik, name, total_eur, supplier_count, linked_eur, score, grade, " +
  "connection_share, single_share, direct_share, conc_share, upheld_share";

export const rebuildRiskGradeScoped = async (
  c: PoolClient,
): Promise<number> => {
  const elections = (
    JSON.parse(
      readFileSync(
        new URL("../../../src/data/json/elections.json", import.meta.url),
        "utf8",
      ),
    ) as Array<{ name: string }>
  )
    // Sort newest-first EXPLICITLY (names are YYYY_MM_DD, so string desc == date
    // desc). The window upper bound below reads elections[i-1] as the next-newer
    // election; if the source were ever re-sorted oldest-first, every ns: window
    // would invert (from > to) and silently return empty sets.
    .slice()
    .sort((a, b) => b.name.localeCompare(a.name));
  const dash = (d: string) => d.replace(/_/g, "-");
  const nowYear = new Date().getFullYear();
  const windows: Array<{ key: string; from: string; to: string | null }> = [];
  for (let y = FIRST_YEAR; y <= nowYear; y++)
    windows.push({ key: `y:${y}`, from: `${y}-01-01`, to: `${y + 1}-01-01` });
  elections.forEach((e, i) =>
    windows.push({
      key: `ns:${e.name}`,
      from: dash(e.name),
      to: i > 0 ? dash(elections[i - 1].name) : null,
    }),
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
