// The ONE reader of the MP↔company link set, for the two cross-reference builders that join
// it against money: `procurement/cross_reference.ts` (contractor rollups →
// data/procurement/derived/mp_connected.json) and `funds/cross_reference.ts` (ИСУН
// beneficiaries → data/funds/derived/mp_connected.json).
//
// Both replaced `data/parliament/companies-index.json`, whose registry arm matched an MP by
// NAME with no people-per-name guard. See docs/plans/company-page-consolidation-v1.md (Tier 5).
//
// ⚠️ THE TWO BUILDERS NEED DIFFERENT POPULATIONS, AND THAT IS THE WHOLE REASON THIS MODULE
// EXISTS RATHER THAN ONE SHARED QUERY. `company_politicians` is CONTRACT-RESTRICTED — its
// loader inner-joins procurement money, so every row is "a politically linked CONTRACTOR",
// which is what the A-F contract grade and every MP-tied procurement figure mean by it. The
// procurement builder's join population IS contractors, so that is the right source there.
// The funds builder's is ИСУН beneficiaries, where an MP-linked company that took EU money
// and never won a public contract is exactly the row to report: measured 2026-08-20, the
// restricted set answers **43 of that payload's 303 pairs**. It therefore reads the same gate
// live, through `MP_ARM_ALL_SQL`, which is `MP_ARM_SQL` minus the money join and nothing else.
//
// Both are the same gate: `person_role` at source tr/ngo through Bridge A/B, refused on a
// `tr_name_fold_people` fold the registry says belongs to more than one human, unioned with
// 096's confirmed declared stakes. Neither is "looser"; they differ in what they are joined to.

import { allRows, dbReachable } from "../db/lib/pg";
import { MP_ARM_ALL_SQL } from "../db/load_tr_pg";

export interface MpLinkRow {
  eik: string;
  /** Already parsed and validated — see readMpLinkRows. */
  mpId: number;
  mpName: string;
  relations: unknown[];
}

interface RawRow {
  eik: string;
  ref: string | null;
  politician: string;
  relations: unknown[] | null;
}

/** Which population the caller is joining against. `contractors` reads the served
 *  `company_politicians`; `all` re-derives the same gate live, without the money join. */
export type MpLinkScope = "contractors" | "all";

const SQL: Record<MpLinkScope, string> = {
  contractors: `SELECT cp.eik, cp.ref, cp.politician, cp.relations
                  FROM company_politicians cp
                 WHERE cp.kind = 'mp' AND cp.eik <> ''`,
  all: MP_ARM_ALL_SQL,
};

// Is the link set REACHABLE? — a different question from „does it hold rows", and the split is
// the whole point.
//
//   absent   → no Postgres, or company_politicians was never created: a fresh clone. Both
//              builders SKIP, and the raw corpus they were joining still lands.
//   present  → a load ran. If it then yields no mp rows that is a BROKEN load, and
//              readMpLinkRows throws rather than letting a builder rewrite mp_connected.json
//              empty — which reads as „no MP is linked to anything" at exit 0.
//
// It probes `company_politicians` for BOTH scopes deliberately: the `all` scope reads the
// person layer instead, but a database carrying one and not the other is a half-built state
// nothing here should try to publish from.
export const mpLinkageAvailable = async (): Promise<boolean> => {
  if (!(await dbReachable())) return false;
  const rows = await allRows<{ present: boolean }>(
    "SELECT to_regclass('public.company_politicians') IS NOT NULL AS present",
  );
  return rows[0]?.present === true;
};

// Every mp-arm row for `scope`, with the numeric mpId already parsed out of the `/candidate/
// mp-<id>` ref. `emptyMeans` is the sentence the caller wants in the error — the two corpora
// publish different claims when this silently returns nothing.
//
// ⚠️ THE mpId PARSE LIVES HERE, ONCE, AND IT REJECTS RATHER THAN COERCES. `Number(null)` is
// `0`, which is finite — so a `Number.isFinite` guard over a nullable ref accepts a row with
// no MP as MP id 0. Every entry then collapses onto one id, and `writeMpConnectedShards`
// prunes the real per-MP shards while writing a single `0.json`, at exit 0. That is not
// hypothetical: `company_politicians.ref` is scheduled to stop being a URL string.
const REF_MP_ID = /^\/candidate\/mp-(\d+)$/;

export const readMpLinkRows = async (
  emptyMeans: string,
  scope: MpLinkScope = "contractors",
): Promise<MpLinkRow[]> => {
  const raw = await allRows<RawRow>(SQL[scope]);
  const rows: MpLinkRow[] = [];
  let unparsed = 0;
  for (const r of raw) {
    const m = REF_MP_ID.exec(r.ref ?? "");
    if (!m) {
      unparsed++;
      continue;
    }
    rows.push({
      eik: r.eik,
      mpId: Number(m[1]),
      mpName: r.politician,
      relations: r.relations ?? [],
    });
  }
  if (rows.length === 0) {
    // Name the input the SCOPE actually read. „Run db:load:tr:pg" is the fix for an empty
    // company_politicians and no fix at all for an empty person layer, which is what the
    // 'all' scope reads — and the loader would fail the same way on it.
    const fix =
      scope === "contractors"
        ? "Run db:load:tr:pg (which needs a resolved person layer) first."
        : "The gated person layer is empty — run db:resolve:persons, then " +
          "db:load:declarations:pg -- --resolve.";
    throw new Error(
      `the MP↔company link set (scope=${scope}) yielded no usable mp rows ` +
        `(${raw.length} read, ${unparsed} with an unparseable ref) — ${emptyMeans} ${fix}`,
    );
  }
  // A ref shape change is a silent halving, not a failure, so it is reported rather than
  // inferred from a smaller payload later.
  if (unparsed > 0) {
    console.warn(
      `  ⚠️ ${unparsed}/${raw.length} mp link row(s) carry a ref that is not ` +
        `/candidate/mp-<id> — dropped`,
    );
  }
  return rows;
};
