// Regression net for the TOURISM sector — the /governance/sectors tile and the
// /sector/tourism (МТ) dashboard behind it. Audit 2026-08-20,
// docs/plans/tourism-sector-audit-v1.md.
//
//   npm run test:data
//
// A separate file per sector, following the environment / regional / security
// precedent. The network-free invariants live in src/lib/tourismReferenceData.test.ts
// and src/screens/sector/sectorDashboards.test.ts; this file is the corpus half.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE DECOUPLED, the same shape as security and
// environment: the tile reads МТ's enacted appropriation, so a wrong EIK does not
// move it by a cent. What each block guards:
//
//  · BASIS + VALUE — `basis === 'budget'` at every scope, an EXACT reconcile
//    against the МТ budget node on value/year/`unavailable`, and a source scan of
//    the GENERATOR. The scan is the un-fakeable half: sector_stats.json is
//    committed, so a wrong basis can be corrected by regenerating, while a
//    `tourism` key back in SECTOR_EIKS returns on the next run.
//  · EIK-SET — the roster is МТ alone, and the anti-allowlist is IMPORTED from the
//    reference data rather than restated, so an eighth excluded body is gated the
//    day it is added. Each entry carries a money floor: an anti-allowlist over
//    bodies that hold nothing guards nothing, and „it is not in the list" would
//    stay true for ever.
//  · SERVING PATH — one arm calls `awarder_group_model()`, the function the page
//    actually renders. Tourism was the only member of this family that never did,
//    which meant a serving-side regression was invisible to its own audit.
//  · BENEFICIARY — where the audit's findings were. Shares and classifications
//    only: ranks 2–4 on the default scope are a three-way tie at €62,500 broken by
//    eik ASC, and every € moves on the fortnightly reload.
//  · THE SINGLE-BID DENOMINATOR — asserted through `singleBidN / bidKnownN`, the
//    definition `awarderModel.ts` uses, and never against a literal. The audit's
//    own first draft recorded 50.1% (168/335) where the site renders 59.6%
//    (168/282), because 53 rows carry no tenderer count and `singleBidShare`
//    excludes them. A test pinning either literal would have frozen the wrong
//    basis, so the arm asserts the definition AND that the two denominators still
//    disagree.
//  · THE CPV SPLIT — Σ(buckets) reconciled against the SERVING total, and the
//    advertising share pinned to a band. That band is the only corpus-level gate
//    on a user-facing sentence: TourismSpendVsNightsTile's caption says
//    „Рекламата е около половината от този разход по CPV", and prose cannot
//    reference a comment.
//
// ⚠ Σ(BUCKETS) MUST NOT BE COMPUTED FROM ONE LOOP. An earlier cut accumulated the
// corpus total and the per-bucket totals in the same pass over the same rows,
// which is a summation identity — true under every database state, including a
// broken one; it passed at a measured delta of 2.6e-8 and gated nothing. Same
// defect the education and regional audits each found in themselves. The two
// quantities are now independently derived: the total from 061's own head CTE, the
// buckets from its byCpv CTE folded by the TypeScript classifier.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import {
  TOURISM_MINISTRY_EIK,
  TOURISM_SECTOR_EIKS,
  TOURISM_STATE_BODY_CONTRACTORS,
  TOURISM_ANTI_ALLOWLIST,
} from "@/lib/tourismReferenceData";
import { tourismClassifier } from "@/screens/sector/tourism/tourismCategories";
import type { ProcurementContract } from "@/data/dataTypes";
import { ministryYearSeriesEur } from "@/data/budget/ministrySeries";
import {
  newestFirst,
  parliamentWindow,
  type ElectionRef,
} from "@/data/scope/windows";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const readJson = <T>(rel: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")) as T;
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

type SectorStat = {
  kind: string;
  basis: string;
  value: number;
  year?: number;
  unavailable?: boolean;
};
type SectorStats = Record<string, Record<string, SectorStat>>;
const STATS = "data/procurement/derived/sector_stats.json";
const NODE = "data/budget/ministries/admin-ministerstvo-na-turizma.json";
const GEN = "scripts/db/gen_procurement/sector_stats.ts";
const EIKS = [TOURISM_MINISTRY_EIK];

/** The default scope of both the hub tile and /sector/tourism, from
 *  `parliamentWindow` — the SAME function the generator and 061 use. Derived
 *  rather than hardcoded so the next election re-points this arm instead of
 *  quietly widening it across two parliaments, and HALF-OPEN for the same reason:
 *  a bare `date >= from` ray is accidentally correct only while this is the latest
 *  NS. `contracts.date` is TEXT (ISO-8601 sorts correctly), so both bounds go in
 *  as text — which is also why a transposed literal never raises. */
const NS_ELECTION = "2026_04_19";
const ELECTIONS = newestFirst(
  readJson<ElectionRef[]>("src/data/json/elections.json"),
);
// ⚠ `parliamentWindow` derives `from` from the STRING it is handed, and returns
// `to: null` for an index it cannot find — so an election name that is not in the
// list yields a perfectly well-formed window over nothing in particular, and a
// `?? "0000"` / `?? "9999"` fallback would then quietly widen this arm to the whole
// corpus. Resolve the name first, so „the window could not be built" fails here
// rather than three assertions later as a share.
if (!ELECTIONS.some((e) => e.name === NS_ELECTION))
  throw new Error(
    `${NS_ELECTION} is not in src/data/json/elections.json — re-point NS_ELECTION at the election whose window is the hub's default scope`,
  );
const NS = parliamentWindow(ELECTIONS, NS_ELECTION);
const NS_FROM = NS.from;
// The newest parliament has no successor, so an open end is correct — but it is
// the ONLY case in which it is, and `9999` is a real upper bound rather than a
// stand-in for „unbounded because something failed".
const NS_TO = NS.to ?? "9999-12-31";
if (!NS_FROM) throw new Error(`parliamentWindow could not date ${NS_ELECTION}`);

describe("tourism sector — hub headline", () => {
  test("basis is 'budget' at every scope", () => {
    const stats = readJson<SectorStats>(STATS);
    const scopes = Object.keys(stats);
    assert.ok(scopes.length >= 20, `expected ~30 scopes, got ${scopes.length}`);
    for (const k of scopes) {
      const s = stats[k]?.tourism;
      assert.ok(s, `no tourism stat at scope ${k}`);
      // Not merely "some money basis". Tourism's reference data asserted for a
      // month that procurement € was the honest headline here, so an edit putting
      // МТ back into the generator's SECTOR_EIKS is a live risk — and on the
      // DEFAULT scope that flips the tile from €14.5M to €312,500.
      assert.equal(s.basis, "budget", `scope ${k}`);
      assert.equal(s.kind, "eur", `scope ${k}`);
    }
  });

  test("the generator maps tourism to the МТ budget node, and to no EIK set", () => {
    // The half a stale committed artifact cannot fake. Read the generator's
    // source, not its output.
    const src = fs.readFileSync(path.join(ROOT, GEN), "utf-8");
    const noComments = (t: string) => t.replace(/\/\/[^\n]*/g, "");

    const eikBlock = /const SECTOR_EIKS[^;]*?\{([\s\S]*?)\n\};/.exec(src);
    assert.ok(eikBlock, "could not locate SECTOR_EIKS in the generator");
    const eiks = noComments(eikBlock[1]);
    // ⚠ The key pattern admits QUOTING. `\btourism\s*:` misses `"tourism":`
    // entirely — after `tourism` comes `"`, which is neither `\s` nor `:` — so one
    // prettier `quoteProps` change, or one hand-edit that skips format-on-save,
    // would blind this file's only un-fakeable guard.
    assert.ok(
      !/["']?tourism["']?\s*:/.test(eiks),
      "tourism is back in the generator's SECTOR_EIKS — the hub headline would flip to procurement",
    );
    // An OBJECT-level spread or a computed key puts a sector in the set without a
    // literal this text guard can see, so refuse the shape rather than report a
    // pass it cannot support. (A `} as const;` / `satisfies` / one-line form fails
    // the block match above instead, loudly — the safe direction.)
    //
    // ⚠ Line-anchored, because a spread INSIDE a value is legitimate and present:
    // `energy: [...ENERGY_SECTOR_EIKS]`. A bare /\.\.\./ over the block rejects the
    // generator as written today.
    assert.ok(
      !/^\s*\.\.\./m.test(eiks),
      "SECTOR_EIKS now spreads another object in — this text guard can no longer see its contents",
    );
    assert.ok(
      !/^\s*\[[^\]]+\]\s*:/m.test(eiks),
      "SECTOR_EIKS now uses a computed key — this text guard can no longer see its contents",
    );

    // …and the positive half must scan the RIGHT block. Asserting `tourism:`
    // anywhere in the file passes on the failure case above, and on a comment.
    const nodeBlock = /const BUDGET_SECTOR_NODE[^;]*?\{([\s\S]*?)\n\};/.exec(
      src,
    );
    assert.ok(
      nodeBlock,
      "could not locate BUDGET_SECTOR_NODE in the generator",
    );
    assert.match(
      noComments(nodeBlock[1]),
      /["']?tourism["']?\s*:\s*["']admin-ministerstvo-na-turizma["']/,
      "tourism is not mapped to the МТ budget node — the hub headline has no source",
    );
  });

  test("value + year + unavailable reconcile EXACTLY to the МТ budget node", (t) => {
    if (!exists(NODE)) return t.skip("МТ budget node absent");
    const stats = readJson<SectorStats>(STATS);
    const node = readJson<{
      eik?: string;
      years?: Array<{
        fiscalYear: number;
        expenditure?: { amountEur?: number | null };
        expenditureLaw?: { amountEur?: number | null } | null;
      }>;
    }>(NODE);
    // The node must be МТ's own. A wrong node is what this sector is most exposed
    // to, because every value below would still reconcile against it.
    assert.equal(node.eik, TOURISM_MINISTRY_EIK, "budget node is not МТ's");

    // `ministryYearSeriesEur`, not `expenditure.amountEur` — the helper is the ONE
    // definition of which of the node's two appropriation figures a cross-year
    // read takes (`expenditureLaw ?? expenditure`).
    const byYear = new Map<number, number>();
    for (const y of node.years ?? []) {
      const v = ministryYearSeriesEur(y);
      // ⚠ TRUTHINESS, not `!= null` — the generator's `budgetSeries` drops a €0
      // year deliberately, so reading it as present here would expect 0 where the
      // generator correctly published the fallback.
      if (v) byYear.set(y.fiscalYear, v);
    }
    assert.ok(byYear.size >= 5, `МТ node carries ${byYear.size} year(s)`);
    const latestYear = Math.max(...byYear.keys());
    const latestEur = byYear.get(latestYear)!;

    let checked = 0;
    let unavailableSeen = 0;
    for (const [scopeKey, row] of Object.entries(stats)) {
      const s = row.tourism;
      if (!s) continue;
      const m = /^y:(\d{4})$/.exec(scopeKey);
      const want = m ? byYear.get(Number(m[1])) : undefined;
      if (m && want == null) {
        // A year the node does not cover must fall back to latest AND say so —
        // the flag is what stops a 2026 figure being captioned 2011.
        assert.equal(s.unavailable, true, `${scopeKey} should be unavailable`);
        assert.equal(s.value, latestEur, scopeKey);
        assert.equal(s.year, latestYear, scopeKey);
        unavailableSeen++;
      } else if (m) {
        assert.equal(s.value, want, `${scopeKey} value`);
        assert.equal(s.year, Number(m[1]), `${scopeKey} year`);
        assert.ok(
          !s.unavailable,
          `${scopeKey} must not be flagged unavailable`,
        );
      } else {
        // `all` and every `ns:` window resolve to the latest fiscal year.
        assert.equal(s.value, latestEur, `${scopeKey} value`);
        assert.equal(s.year, latestYear, `${scopeKey} year`);
        assert.ok(
          !s.unavailable,
          `${scopeKey} must not be flagged unavailable`,
        );
      }
      assert.ok(s.value > 0, `${scopeKey} publishes a zero headline`);
      checked++;
    }
    assert.equal(
      checked,
      Object.keys(stats).length,
      "some scope carries no tourism stat",
    );
    assert.ok(checked >= 28, `only ${checked} scopes checked`);
    // ⚠ DERIVED, never a constant floor. The count is every y:<year> scope the
    // node does not cover — 7 today (y:2011…y:2017, the node starting FY2018) —
    // and it SHRINKS whenever МТ's node gains an earlier fiscal year, which is a
    // legitimate improvement. A hardcoded `>= 5` would fail on correct data, on
    // db:refresh's LAST link, the worst place to mint a false failure. Equality
    // keeps the strength without that risk; the `>= 1` guard says the fallback
    // branch is still reached at all, so the arm above cannot go vacuous.
    const expectUnavailable = Object.keys(stats).filter((k) => {
      const y = /^y:(\d{4})$/.exec(k);
      return y ? !byYear.has(Number(y[1])) : false;
    }).length;
    assert.equal(unavailableSeen, expectUnavailable, "unavailable-flag count");
    assert.ok(
      unavailableSeen >= 1,
      "no scope is flagged unavailable — the fallback arm is vacuous",
    );
  });
});

describe("tourism sector — the EIK set", () => {
  test("the roster is the ministry alone", () => {
    // Pinned directly, because the three-copy LOCKSTEP is vacuous against a roster
    // CHANGE: all three copies derive from tourismReferenceData.ts, so widening it
    // keeps them equal. This sector is single-member by a documented decision (МИЕ
    // and the state holiday operators are excluded on the record), so a change
    // here is a decision to revisit that, not a refactor.
    //
    // ⚠ The lockstep itself is asserted in src/lib/tourismReferenceData.test.ts,
    // not here, and deliberately: it needs no database, and importing
    // SECTOR_DASHBOARDS pulls the whole sector registry — whose module-scope
    // buildMemberIndex() throws on ANY cross-sector EIK collision, in any sector.
    // A data test that dies at import because two OTHER sectors disagree reports
    // nothing about this corpus.
    assert.deepEqual(
      [...TOURISM_SECTOR_EIKS].sort(),
      [TOURISM_MINISTRY_EIK],
      "the roster is МТ alone",
    );
  });

  test("МТ is a real awarder with a live procurement corpus", async (t) => {
    if (skip) return t.skip(skip);
    const [row] = await allRows<{ n: string; eur: string; d0: string }>(
      `SELECT count(*)::text AS n,
              round(sum(amount_eur))::text AS eur,
              min(date) AS d0
         FROM contracts WHERE tag = 'contract' AND awarder_eik = $1`,
      [TOURISM_MINISTRY_EIK],
    );
    assert.ok(Number(row.n) > 250, `МТ has only ${row.n} contracts`);
    assert.ok(Number(row.eur) > 20_000_000, `МТ holds only €${row.eur}`);
    // МТ was split out of МИЕ in Nov 2014. A corpus starting materially earlier
    // means the roster has absorbed a predecessor.
    assert.ok(
      row.d0 >= "2014-01-01",
      `МТ's corpus starts ${row.d0}, before the ministry existed`,
    );
  });

  test("the anti-allowlist bodies are absent — and each is still large enough to matter", async (t) => {
    if (skip) return t.skip(skip);
    // ⚠ IMPORTED, not restated. A local literal would cover only the entries
    // somebody remembered to duplicate, and the header it mirrors has grown twice
    // already.
    assert.ok(
      TOURISM_ANTI_ALLOWLIST.length >= 7,
      `anti-allowlist is ${TOURISM_ANTI_ALLOWLIST.length} entries, was 7`,
    );
    for (const e of TOURISM_ANTI_ALLOWLIST)
      assert.ok(
        !TOURISM_SECTOR_EIKS.includes(e.eik),
        `${e.eik} (${e.why}) is in the tourism roster`,
      );

    // ⚠ NON-VACUITY, and it is the load-bearing half. The membership assertions
    // above are logically IMPLIED by the single-member pin, so they cannot fail
    // independently today — they are defence in depth for the day the roster
    // legitimately widens. What actually guards anything is that each excluded
    // body is still a live awarder at roughly the scale that makes admitting it a
    // material error rather than a rounding difference.
    const rows = await allRows<{ awarder_eik: string; eur: string }>(
      `SELECT awarder_eik, round(sum(amount_eur))::text AS eur
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY 1`,
      [TOURISM_ANTI_ALLOWLIST.map((e) => e.eik)],
    );
    const by = new Map(rows.map((r) => [r.awarder_eik, Number(r.eur)]));
    for (const e of TOURISM_ANTI_ALLOWLIST)
      assert.ok(
        (by.get(e.eik) ?? 0) >= e.minEur,
        `${e.eik} (${e.why}) holds €${by.get(e.eik) ?? 0}, under the €${e.minEur} floor that makes excluding it meaningful`,
      );

    // The vocational schools are a CLASS rather than a list — a name/keyword
    // classifier is what would sweep them in — so the guard is that the class is
    // still large and still entirely outside the roster.
    const schools = await allRows<{ awarder_eik: string }>(
      `SELECT DISTINCT awarder_eik FROM contracts
        WHERE tag = 'contract'
          AND awarder_name ILIKE '%туриз%' AND awarder_name ILIKE '%гимназия%'`,
    );
    assert.ok(
      schools.length >= 25,
      `only ${schools.length} vocational schools match — the class guard is going vacuous`,
    );
    for (const s of schools)
      assert.ok(
        !TOURISM_SECTOR_EIKS.includes(s.awarder_eik),
        `vocational school ${s.awarder_eik} is in the tourism roster`,
      );
  });
});

describe("tourism sector — the serving path", () => {
  test("the group model's rollup shares the headline's basis", async (t) => {
    if (skip) return t.skip(skip);
    // Tourism was the ONLY member of this audit family that never called
    // `awarder_group_model()` — the function /sector/tourism actually renders — so
    // a serving-side regression was invisible to its own regression net. Every
    // quantity the arms below re-derive in SQL is also exposed here, and the two
    // producers are asserted equal rather than each pinned to a literal.
    const [row] = await allRows<{
      total: number;
      suppliers: number;
      no_eik: number;
      n: number;
      known: number;
      single: number;
      raw_known: number;
      raw_single: number;
    }>(
      `WITH m AS (SELECT awarder_group_model($1::text[], NULL, NULL) AS j)
       SELECT (j->>'totalEur')::float8                                   AS total,
              (j->>'bidKnownN')::int                                     AS known,
              (j->>'singleBidN')::int                                    AS single,
              jsonb_array_length(j->'suppliers')::float8                  AS n,
              (SELECT coalesce(sum((s->>'totalEur')::numeric), 0)
                 FROM jsonb_array_elements(j->'suppliers') s)::float8     AS suppliers,
              (SELECT coalesce(sum(amount_eur), 0) FROM contracts
                WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
                  AND (contractor_eik IS NULL OR contractor_eik = ''))::float8
                                                                          AS no_eik,
              (SELECT count(number_of_tenderers) FROM contracts
                WHERE tag = 'contract' AND awarder_eik = ANY($1::text[]))::int
                                                                          AS raw_known,
              (SELECT count(*) FROM contracts
                WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
                  AND number_of_tenderers = 1)::int                       AS raw_single
         FROM m`,
      [EIKS],
    );
    assert.ok(row.n > 100, `group model returned ${row.n} suppliers (was 144)`);
    // The supplier rollup plus the un-attributable residue must be the head total.
    // 061 drops no-EIK rows from `suppliers` while keeping their € in the total, so
    // this is the arm that notices if either side changes what it counts.
    assert.ok(
      Math.abs(row.total - (row.suppliers + row.no_eik)) < 100,
      `serving total €${row.total} ≠ suppliers €${row.suppliers} + no-EIK €${row.no_eik}`,
    );
    // The function's own bid counters vs the same counts taken raw — two producers
    // of the single-bid denominator, asserted equal instead of frozen at 282/168.
    assert.equal(row.known, row.raw_known, "bidKnownN");
    assert.equal(row.single, row.raw_single, "singleBidN");
  });
});

describe("tourism sector — the beneficiaries", () => {
  /** The leaderboard's own definition: 061's supplier CTE excludes €0 consortium
   *  MEMBER rows and the self-deal artifact, so a probe that does not is measuring
   *  a different set from the page. Money is cast `::text` — `amount_eur` is
   *  `double precision`, which node-postgres parses to a JS number, so an uncast
   *  column declared `string` typechecks and then throws on the first `.trim()`. */
  const SUPPLIERS = `
    SELECT contractor_eik AS eik, round(sum(amount_eur))::text AS eur
      FROM contracts
     WHERE tag = 'contract' AND awarder_eik = $1
       AND coalesce(consortium_role, '') <> 'member'
       AND contractor_eik <> awarder_eik
       AND coalesce(contractor_eik, '') <> ''`;

  test("every curated state body is still a МТ contractor", async (t) => {
    if (skip) return t.skip(skip);
    const rows = await allRows<{ eik: string; eur: string }>(
      `${SUPPLIERS} AND contractor_eik = ANY($2) GROUP BY 1`,
      [TOURISM_MINISTRY_EIK, [...TOURISM_STATE_BODY_CONTRACTORS]],
    );
    const by = new Map(rows.map((r) => [r.eik, Number(r.eur)]));
    assert.ok(
      TOURISM_STATE_BODY_CONTRACTORS.length >= 7,
      `curated state-body list is ${TOURISM_STATE_BODY_CONTRACTORS.length}, was 7`,
    );
    for (const eik of TOURISM_STATE_BODY_CONTRACTORS)
      assert.ok(
        (by.get(eik) ?? 0) > 0,
        `${eik} no longer a contractor to МТ — re-check the curated list`,
      );
    // …and each must stay OUTSIDE the roster, or the tile drops it from
    // `stateBodies` in favour of the more specific „в групата" badge.
    for (const eik of TOURISM_STATE_BODY_CONTRACTORS)
      assert.ok(
        !TOURISM_SECTOR_EIKS.includes(eik),
        `${eik} is both a curated state body and a roster member`,
      );
  });

  test("the curated list's rank-bar claim still matches the corpus", async (t) => {
    if (skip) return t.skip(skip);
    // The reference data admits five entries because they reach a DISPLAYED rank
    // (the tile shows eight) and two by extension — already badged on a sibling
    // page, or the same-page twin of an admitted entry — recording their best
    // ranks as 10 and 14. Nothing checked that against the corpus, so a rank-bar
    // entry could fall below the bar, or a below-bar one rise above it, and the
    // stated rationale would silently stop being the real one.
    const rows = await allRows<{ eik: string; rnk: number }>(
      `WITH s AS (${SUPPLIERS} GROUP BY 1),
            r AS (SELECT eik, row_number() OVER (ORDER BY eur::numeric DESC, eik) AS rnk
                    FROM s)
       SELECT eik, rnk::int AS rnk FROM r WHERE eik = ANY($2)`,
      [TOURISM_MINISTRY_EIK, [...TOURISM_STATE_BODY_CONTRACTORS]],
    );
    const rank = new Map(rows.map((r) => [r.eik, r.rnk]));
    // Ranks are volatile, so this asserts the SHAPE the file documents — that some
    // entries are on-page and some are carried — not any entry's position.
    const onPage = [...rank.values()].filter((r) => r <= 8).length;
    const carried = [...rank.values()].filter((r) => r > 8).length;
    assert.ok(
      onPage >= 1,
      "no curated state body reaches a displayed rank all-scope — the list has stopped describing the page",
    );
    assert.ok(
      carried >= 1,
      "every curated entry now reaches the top-8 all-scope — the 'below the rank bar' note in tourismReferenceData.ts is stale",
    );
  });

  test("the default scope's municipal rows are still reached by the list", async (t) => {
    if (skip) return t.skip(skip);
    // The finding this whole audit turned on: on the page's DEFAULT scope most of
    // the money goes to host cities, and unlabelled they read as private vendors
    // winning the sector.
    const rows = await allRows<{ eik: string; eur: string }>(
      `${SUPPLIERS} AND date >= $2 AND date < $3 GROUP BY 1`,
      [TOURISM_MINISTRY_EIK, NS_FROM, NS_TO],
    );
    // ⚠ NOT a skip. Every way this arm breaks returns zero rows — a mistyped date
    // literal (the column is TEXT, so Postgres accepts `2026-19-04` silently and
    // raises nothing), an inverted consortium predicate, a placeholder drift, an
    // evicted row set. Skipping on that reports GREEN on exactly the failures the
    // arm exists to catch, and this is the one arm that must not be skippable.
    assert.ok(
      rows.length >= 4,
      `${rows.length} supplier rows in the default scope (was 5) — the window predicate or the corpus moved`,
    );
    const total = rows.reduce((a, r) => a + Number(r.eur), 0);
    const badged = new Set(TOURISM_STATE_BODY_CONTRACTORS);
    const labelled = rows
      .filter((r) => badged.has(r.eik))
      .reduce((a, r) => a + Number(r.eur), 0);
    const share = labelled / total;
    // 84.0% at the audit (€262,500 of €312,500 across 4 of the 5 rows). A floor of
    // 0.70 fails if ANY ONE of the four stops being reached; 0.50 would tolerate
    // losing three of them, which is not what a floor here is for.
    assert.ok(
      share >= 0.7 && share <= 1,
      `only ${(share * 100).toFixed(1)}% of the default scope's money is labelled — the state bodies topping it have lost their chip`,
    );
  });

  test("no single contractor owns the whole all-scope leaderboard", async (t) => {
    if (skip) return t.skip(skip);
    // ⚠ THIS CEILING CANNOT SEE THE CONSORTIUM MUTATION, and an earlier version of
    // this comment claimed it could. `SUPPLIERS` excludes `consortium_role =
    // 'member'` — exactly the rows a "credit the full value to every member"
    // change would populate — so that mutation moves nothing here. It is asserted
    // directly instead, in the €0-member invariant below. What this DOES catch is
    // the other shape: one contractor swallowing the sector, through a real award,
    // a key merge, or a fold that stops splitting.
    const [row] = await allRows<{ top: string; total: string; n: string }>(
      `WITH s AS (${SUPPLIERS} GROUP BY 1)
       SELECT max(eur::numeric)::text AS top,
              sum(eur::numeric)::text AS total,
              count(*)::text          AS n
         FROM s`,
      [TOURISM_MINISTRY_EIK],
    );
    assert.ok(
      Number(row.n) > 100,
      `only ${row.n} suppliers — arm going vacuous`,
    );
    // Both sides from ONE CTE, so numerator and denominator share a basis. (The
    // page's own HHI divides by the ATTRIBUTED total, which also carries the 7
    // no-EIK rows / €27,735 — 0.1%, and the serving arm above reconciles it.)
    const share = Number(row.top) / Number(row.total);
    // 7.3% at the audit; 0.20 keeps ~2.7x headroom, matching the security model's
    // 0.15 against a measured 5.9%.
    assert.ok(
      share < 0.2,
      `top contractor holds ${(share * 100).toFixed(1)}% of the corpus — a dominated total needs a caption, not a leaderboard`,
    );
  });

  test("МТ never contracts with itself", async (t) => {
    if (skip) return t.skip(skip);
    // 0 today. 061 drops these from `suppliers` while leaving the € in the totals,
    // so a new one would deflate every share on the page with no row count moving.
    // The register artifact is real (29 rows / €3.87M corpus-wide), just not here.
    const [row] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = $1
          AND contractor_eik = awarder_eik`,
      [TOURISM_MINISTRY_EIK],
    );
    assert.equal(Number(row.n), 0, `${row.n} self-contracting row(s) on МТ`);
  });

  test("consortium member rows carry no money, so no rollup can double-count them", async (t) => {
    if (skip) return t.skip(skip);
    // Corpus-wide rather than МТ-scoped: the rule belongs to the ingest, and 061's
    // supplier CTE drops these rows only because they are worth €0.
    const [row] = await allRows<{
      n: string;
      nonzero: string;
      nulls: string;
      total: string;
    }>(
      `SELECT count(*)::text                                     AS n,
              count(*) FILTER (WHERE amount_eur <> 0)::text      AS nonzero,
              count(*) FILTER (WHERE amount_eur IS NULL)::text   AS nulls,
              coalesce(sum(amount_eur), 0)::text                 AS total
         FROM contracts WHERE tag = 'contract' AND consortium_role = 'member'`,
    );
    assert.ok(
      Number(row.n) > 1000,
      `only ${row.n} member rows — arm going vacuous`,
    );
    assert.equal(
      Number(row.nonzero),
      0,
      "a consortium MEMBER row carries money",
    );
    // ⚠ `amount_eur <> 0` is NULL-BLIND (NULL <> 0 → NULL → not counted), and the
    // column is nullable. „unknown" is a different and equally unsafe claim from
    // „€0", and €0 is what the 061 exclusion is licensed on.
    assert.equal(
      Number(row.nulls),
      0,
      "a consortium MEMBER row has a NULL amount",
    );
    assert.equal(Number(row.total), 0, "member rows sum to more than zero");
  });
});

describe("tourism sector — the derived figures the copy quotes", () => {
  test("the single-bid share uses the bidKnown denominator", async (t) => {
    if (skip) return t.skip(skip);
    // `awarderModel.ts`: singleBidShare = singleBidN / bidKnownN, with a null
    // tenderer count meaning "bid data unknown" rather than "several bids". The
    // audit's own first draft published 168/335 = 50.1% against the site's
    // 168/282 = 59.6%, a 9.4-point gap in the direction that flatters the sector.
    // Asserting the DEFINITION rather than either literal is what stops that
    // recurring — a band would admit both.
    const [row] = await allRows<{
      total: string;
      known: string;
      single: string;
    }>(
      `SELECT count(*)::text AS total,
              count(number_of_tenderers)::text AS known,
              count(*) FILTER (WHERE number_of_tenderers = 1)::text AS single
         FROM contracts WHERE tag = 'contract' AND awarder_eik = $1`,
      [TOURISM_MINISTRY_EIK],
    );
    const total = Number(row.total);
    const known = Number(row.known);
    const single = Number(row.single);
    assert.ok(
      known > 0 && known < total,
      `${known}/${total} carry a bid count`,
    );
    // The two denominators must still DISAGREE, or this arm proves nothing.
    const rendered = single / known;
    const overAllRows = single / total;
    assert.ok(
      rendered - overAllRows > 0.02,
      `the two denominators now agree to ${(rendered - overAllRows).toFixed(4)} — this arm is vacuous`,
    );
    assert.ok(
      rendered > 0.4 && rendered < 0.8,
      `single-bid share is ${(rendered * 100).toFixed(1)}% — outside the band the sector's prose assumes`,
    );
  });

  test("the CPV buckets reconcile to the serving total, and advertising stays about half", async (t) => {
    if (skip) return t.skip(skip);
    // TWO INDEPENDENTLY DERIVED QUANTITIES — see the ⚠ in this file's header. The
    // total comes from 061's head CTE; the buckets come from its byCpv CTE folded
    // by the TypeScript classifier, which is imported rather than transcribed into
    // SQL (a SQL copy would be a second definition of the rule, the drift this
    // sector already suffered once).
    const [m] = await allRows<{ total: number; bycpv: string }>(
      `WITH j AS (SELECT awarder_group_model($1::text[], NULL, NULL) AS m)
       SELECT (m->>'totalEur')::float8 AS total, (m->'byCpv')::text AS bycpv
         FROM j`,
      [EIKS],
    );
    const byCpv = JSON.parse(m.bycpv) as { cpv: string; totalEur: number }[];
    assert.ok(
      byCpv.length > 50,
      `only ${byCpv.length} CPV groups — the serving rollup is not being built`,
    );

    const byCat = new Map<string, number>();
    for (const g of byCpv) {
      const cat = tourismClassifier.categoryOf({
        cpv: g.cpv,
      } as ProcurementContract);
      byCat.set(cat, (byCat.get(cat) ?? 0) + g.totalEur);
    }
    const summed = [...byCat.values()].reduce((a, b) => a + b, 0);
    // A tag/window drift inside the function, a byCpv basis change, or a classifier
    // that stops covering a CPV all break this. Tolerance is per-CPV ROUNDing.
    assert.ok(
      Math.abs(summed - m.total) < 100,
      `Σ(categories) €${summed} vs group-model total €${m.total}`,
    );
    assert.ok(byCat.size >= 5, `only ${byCat.size} buckets are populated`);

    // ⚠ THE ONLY CORPUS-LEVEL GATE ON TWO USER-FACING SENTENCES, and prose cannot
    // reference a comment, so if the corpus drifts to 35% or 65% both go false with
    // nothing else failing:
    //   · TourismSpendVsNightsTile's caption („Рекламата е около половината от този
    //     разход по CPV") — its own unit test asserts the string EXISTS, which
    //     catches a removal and not the claim becoming untrue; and
    //   · the PRERENDERED /sector/tourism intro and meta description
    //     (scripts/prerender/routes.ts, SECTOR_PAGES → tourism), which is the
    //     higher-stakes one: it is server-rendered HTML that Google indexes and it
    //     cannot self-correct client-side. It said „над половината … ~27 млн. €"
    //     until this audit — a figure 7% stale and a claim clearing „over half" by
    //     one point.
    // 51.03% at the audit.
    const advShare = (byCat.get("advertising") ?? 0) / m.total;
    assert.ok(
      advShare >= 0.45 && advShare <= 0.6,
      `advertising is ${(advShare * 100).toFixed(1)}% of МТ's corpus — „около половината" is no longer true, so fix the caption (and tourismCategories.ts's header) rather than this band`,
    );

    // The two documented leaks OUT of `advertising`, which are why every surface
    // quoting that share has to say „по CPV". Both are recorded in
    // tourismCategories.ts's header; if either stops landing where it says, the
    // 22-point gap between the narrow and wide readings has moved and the header
    // is stale.
    const cpvOf = (c: string) =>
      byCpv.find((g) => g.cpv.replace(/\D/g, "") === c)?.totalEur ?? 0;
    const stands = cpvOf("39154100"); // trade-fair stands → `production`
    const adSpace = cpvOf("98000000"); // rented advertising space → `other`
    assert.ok(
      stands > 1_000_000 && adSpace > 100_000,
      `the documented CPV leaks have moved: stands €${stands}, rented ad space €${adSpace}`,
    );
    assert.equal(
      tourismClassifier.categoryOf({ cpv: "39154100" } as ProcurementContract),
      "production",
      "CPV 39154100 no longer lands in `production` — tourismCategories.ts's header is stale",
    );
    assert.equal(
      tourismClassifier.categoryOf({ cpv: "98000000" } as ProcurementContract),
      "other",
      "CPV 98000000 no longer lands in `other` — tourismCategories.ts's header is stale",
    );
  });
});
