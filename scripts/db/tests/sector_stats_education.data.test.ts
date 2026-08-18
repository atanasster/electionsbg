// Regression net for the EDUCATION sector — the /governance/sectors tile and the
// /sector/edu dashboard behind it. Audit 2026-08-18,
// docs/plans/education-sector-audit-v1.md.
//
//   npm run test:data
//
// A separate file from sector_stats.data.test.ts for the same reason the
// environment one is: this sector's gates read a different set of sources (a
// budget node, the gitignored ministries tree, a 126-EIK roster) than the four
// sectors there, and concurrent sessions routinely hold work in that file.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE DECOUPLED, exactly as in environment — the
// tile reads МОН's enacted appropriation and a wrong EIK does not move it by a
// cent, so the two need separate gates and the EIK one cannot lean on a sum. Read
// environment's header for the general shape; what follows is what is DIFFERENT
// here, and each item is a defect this audit actually found:
//
//  · THE SET IS THREE-PRINCIPAL. МОН, БАН (autonomous) and ССА (a second-level
//    unit under МЗХ). So there is no "does it look like an МОН body" name gate:
//    the honest members include „Ботаническа градина", „Институт по царевицата —
//    Кнежа" and „Опитна станция по земеделие — Лозница", none of which reads as
//    education. The name-plausibility check environment can run would reject the
//    truth here, so this file substitutes the ANTI-allowlist, both of its halves,
//    and a per-universe floor.
//
//    So the roster's own shape — the two-way anti-allowlist, institutions vs EIKs,
//    the per-universe floors, the derived footnote, the pinned display names and
//    the `packIsThematic` flag — is gated in src/lib/educationReferenceData.test.ts
//    instead. Everything there is decidable from the source alone, so it belongs in
//    the fast unit suite; READ IT TOO before changing the roster. What stays here
//    needs the corpus or the committed artifact.
//
// BENEFICIARY side: the audit's Phase 2b found it clean on the widened set (top
// contractor 2.73% all-corpus, intra-group 0.85%, zero self-dealing). Cleanliness
// is what needs pinning — a rollup change crediting a consortium's full value to
// every member shows up as a SHARE long before anyone notices a total. Shares and
// classifications only, never a rank or an absolute €, both of which move on
// every fortnightly reload.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import {
  EDU_SECTOR_EIKS,
  EDU_ENTITIES,
  EDU_LEAD_EIK,
  EDU_BUDGET_NODE,
} from "@/lib/educationReferenceData";
import { ministryYearSeriesEur } from "@/data/budget/ministrySeries";

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
const MINISTRY_NODE = `data/budget/ministries/${EDU_BUDGET_NODE}.json`;

/** The full corpus — the scope every € band below is measured on. */
const ALL = "all";

// ── the hub headline ───────────────────────────────────────────────────────

describe("education sector — the hub headline is a BUDGET", () => {
  // No PG skip: this reads the committed artifact, and a stale artifact is one of
  // the states the assertion exists to catch.
  test("basis is 'budget', not the 126-EIK group's tender flow", () => {
    const stats = readJson<SectorStats>(STATS);
    const e = stats[ALL]?.edu;
    assert.ok(e, "no `edu` entry in sector_stats.json at scope `all`");
    assert.equal(
      e.basis,
      "budget",
      "edu moved onto a procurement headline. That is not a smaller change than " +
        "it looks: the group spans THREE budget principals (МОН, БАН, ССА→МЗХ) " +
        "while the budget figure spans one, so the two are different bases and " +
        "summing them means nothing — see educationReferenceData.ts's third ⚠. " +
        "If the code is right, the artifact is stale: run db:gen-sector-stats.",
    );
    assert.equal(e.kind, "eur");
    assert.ok(
      e.year && e.year >= 2024,
      `expected a recent fiscal year on the headline, got ${e.year}`,
    );
    // The exact reconcile below SKIPS when data/budget/ministries/ is absent, and
    // that tree is GITIGNORED — so on CI and on any fresh clone it always skips,
    // leaving `value` asserted nowhere. Without this band a `value: 0` artifact
    // (the generator's skip-and-warn path having written nothing) satisfies every
    // unconditional assertion here. €758.4M for FY2026; the band is wide because a
    // new fiscal year moves it.
    assert.ok(
      e.value >= 300_000_000 && e.value <= 3_000_000_000,
      `edu headline is €${e.value} — outside any plausible МОН appropriation, which ` +
        `usually means the artifact was written from an empty source`,
    );
  });

  test("every scope carries an edu entry", () => {
    const stats = readJson<SectorStats>(STATS);
    const missing = Object.keys(stats).filter((s) => !stats[s]?.edu);
    assert.deepEqual(missing, [], "scopes with no edu tile");
    // Guards against a one-scope artifact making the rest of this block vacuous.
    assert.ok(
      Object.keys(stats).length >= 25,
      `expected ~30 scopes, got ${Object.keys(stats).length}`,
    );
  });

  test.skipIf(!exists(MINISTRY_NODE))(
    "EVERY scope reconciles EXACTLY to the МОН node — value, year and unavailable",
    () => {
      // A €-band on one scope cannot see a wrong YEAR, a lost `unavailable` flag,
      // or a scope→year resolver that drifted, so this re-derives all 30 from the
      // source and compares whole stats. data/budget/ministries/ is GITIGNORED,
      // hence the skip — the same absent-tolerance the generator itself uses.
      const stats = readJson<SectorStats>(STATS);
      const node = readJson<{
        years?: Array<{
          fiscalYear: number;
          expenditure?: { amountEur?: number | null };
          expenditureLaw?: { amountEur?: number | null } | null;
        }>;
      }>(MINISTRY_NODE);

      const byYear = new Map<number, number>();
      for (const y of node.years ?? []) {
        const v = ministryYearSeriesEur(y);
        if (v) byYear.set(y.fiscalYear, v);
      }
      assert.ok(byYear.size >= 5, `МОН node carries ${byYear.size} year(s)`);
      const latest = Math.max(...byYear.keys());

      const wrong: string[] = [];
      for (const scope of Object.keys(stats)) {
        const m = /^y:(\d{4})$/.exec(scope);
        const asked = m ? Number(m[1]) : null;
        const have = asked !== null && byYear.has(asked);
        const year = have ? asked! : latest;
        const want = {
          basis: "budget",
          year,
          value: byYear.get(year)!,
          unavailable: asked !== null && !have,
        };
        const e = stats[scope]?.edu;
        const got = {
          basis: e?.basis,
          year: e?.year,
          value: e?.value,
          unavailable: !!e?.unavailable,
        };
        if (JSON.stringify(got) !== JSON.stringify(want))
          wrong.push(
            `${scope}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`,
          );
      }
      assert.deepEqual(wrong, [], "scopes that disagree with the МОН node");
    },
  );
});

// ── the EIK set ────────────────────────────────────────────────────────────

describe("education sector — the EIK set", () => {
  test.skipIf(skip)(
    "every member is a REAL awarder in the corpus",
    async () => {
      // The check lockstep structurally cannot do: all three copies read one
      // constant, so a mistyped digit propagates identically and they stay equal —
      // but it matches no awarder, and its chip in the awarders tile lands nowhere.
      const rows = await allRows<{ eik: string }>(
        `SELECT DISTINCT awarder_eik AS eik FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
        [EDU_SECTOR_EIKS],
      );
      const seen = new Set(rows.map((r) => r.eik));
      const ghosts = EDU_ENTITIES.filter((e) => !seen.has(e.eik)).map(
        (e) => `${e.eik} (${e.name})`,
      );
      assert.deepEqual(
        ghosts,
        [],
        "EIKs in the roster that award nothing — every member currently has " +
          "contracts, which is why none carries `noAwarderPage`",
      );
    },
  );

  test.skipIf(skip)("the signature members clear a spend floor", async () => {
    const FLOORS: Array<[string, string, number]> = [
      [EDU_LEAD_EIK, "МОН", 400_000_000],
      ["000670680", "Софийски университет", 100_000_000],
      ["831917453", "ССО ЕАД", 50_000_000],
      ["000662018", "БАН (централа)", 25_000_000],
      ["000662107", "Селскостопанска академия", 3_000_000],
      // Small by design (€0.65M) — the floor proves the audit's find is still
      // attached, not that it is material. It is the ДЗИ/НВО exam-paper buyer,
      // and no list built from the older agency NAMES would contain it.
      ["181260010", "Институт по образованието", 300_000],
    ];
    const rows = await allRows<{ eik: string; eur: number }>(
      `SELECT awarder_eik AS eik, COALESCE(SUM(amount_eur), 0)::float8 AS eur
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
        GROUP BY awarder_eik`,
      [FLOORS.map(([e]) => e)],
    );
    const by = new Map(rows.map((r) => [r.eik, r.eur]));
    for (const [eik, name, floor] of FLOORS)
      assert.ok(
        (by.get(eik) ?? 0) >= floor,
        `${name} (${eik}) at €${Math.round(by.get(eik) ?? 0)}, below the €${floor} floor`,
      );
  });

  test.skipIf(skip)("the group € stays in band", async () => {
    // A ceiling catches re-leakage (a university HOSPITAL would blow it — УМБАЛ
    // „Св. Георги" alone is €1.39bn); a floor catches an over-trim or a roster
    // collapsed back to МОН. Measured €2,112.0M on 2026-08-18; the corpus grows
    // fortnightly, so the band is wide and only the shape is pinned.
    const [row] = await allRows<{ eur: number }>(
      `SELECT COALESCE(SUM(amount_eur), 0)::float8 AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
      [EDU_SECTOR_EIKS],
    );
    const eur = row?.eur ?? 0;
    assert.ok(
      eur >= 1_700_000_000,
      `group total €${Math.round(eur)} is below the floor — the pre-audit МОН-only set was €506M`,
    );
    // The ceiling is what a HOSPITAL leak trips, and it has to be tight enough to
    // actually trip: at €4bn it did not — ВМА (€1.155bn) would have taken the group
    // to €3.27bn and passed. €2.8bn is ~33% above today's €2.112bn, so ordinary
    // corpus growth clears it while any of the four biggest university hospitals
    // (€0.70bn-€1.39bn at tag='contract') does not.
    //
    // Stated limit: no absolute ceiling catches a SMALL leak (УМБАЛ Бургас is
    // €59M). The anti-allowlist in educationReferenceData.test.ts and the
    // real-awarder check above are the precise gates; this one catches the
    // expensive mistake, and is expected to be re-measured when it fires.
    assert.ok(
      eur <= 2_800_000_000,
      `group total €${Math.round(eur)} is above the ceiling — either a university ` +
        `HOSPITAL has leaked in (the four biggest are €0.70bn-€1.39bn) or the corpus ` +
        `has outgrown the band and it needs re-measuring`,
    );
  });
});

// ── the beneficiary side ───────────────────────────────────────────────────

describe("education sector — the beneficiaries", () => {
  test.skipIf(skip)("no contractor dominates the corpus window", async () => {
    // Phase 2b measured 2.73% (Топлофикация София) on 2026-08-18. A ceiling —
    // never a rank, which is supposed to reorder. What this catches is a rollup
    // change that starts crediting a consortium's FULL value to every member: it
    // shows up as a share long before anyone notices a total.
    //
    // Worth knowing why the pre-audit number would fail it: on МОН alone at the
    // default scope one supplier held 72.3% of nine contracts. A 126-body sector
    // has no such row, and if one appears it is a defect, not a market.
    const rows = await allRows<{ pct: number; name: string }>(
      `WITH w AS (
         SELECT contractor_eik, contractor_name, amount_eur FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1::text[]))
       SELECT MIN(contractor_name) AS name,
              (100.0 * SUM(amount_eur) / NULLIF((SELECT SUM(amount_eur) FROM w), 0))::float8 AS pct
         FROM w GROUP BY contractor_eik ORDER BY SUM(amount_eur) DESC NULLS LAST LIMIT 1`,
      [EDU_SECTOR_EIKS],
    );
    const top = rows[0];
    assert.ok(top, "no contractors at all in the education corpus");
    // NULL would satisfy `< 15` silently (`null < 15` is true), so these two are
    // not padding — they stop an empty window or a divide-by-zero from reading as
    // a healthy spread.
    assert.equal(
      typeof top.pct,
      "number",
      "top-contractor share is not a number — an empty window reads as passing",
    );
    assert.ok(top.pct > 0, "top-contractor share is zero — no money to divide");
    assert.ok(
      top.pct < 15,
      `top beneficiary ${top.name} holds ${top.pct.toFixed(1)}% of the sector — it was 2.70% at the audit`,
    );
  });

  test.skipIf(skip)("intra-group circulation stays a footnote", async () => {
    // Money that never left the sector — МОН buying from „Ученически отдих и
    // спорт" ЕАД, universities from ССО. 0.85% at the audit. Not a double-count
    // (the headline sums awarder-side, so each row is counted once), but "the
    // sector procured €X" implies an external market and this part did not reach
    // one. If it ever became material the page would need to say so.
    const [row] = await allRows<{ pct: number }>(
      `WITH w AS (
         SELECT contractor_eik, amount_eur FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1::text[]))
       SELECT (100.0 * COALESCE(SUM(amount_eur) FILTER (WHERE contractor_eik = ANY($1::text[])), 0)
               / NULLIF(SUM(amount_eur), 0))::float8 AS pct FROM w`,
      [EDU_SECTOR_EIKS],
    );
    // Same NULL guard: `null < 10` passes. Zero IS legitimate here (unlike the top
    // share), so the assertion is on the type, not on the value.
    assert.equal(
      typeof row?.pct,
      "number",
      "intra-group share is not a number — an empty window reads as passing",
    );
    assert.ok(
      row!.pct < 10,
      `intra-group circulation is ${row!.pct.toFixed(2)}% — it was 0.85% at the audit`,
    );
  });

  test.skipIf(skip)("no body contracts with itself", async () => {
    // A register artifact (the buyer landing in the supplier field) — 29 rows
    // corpus-wide, none of them in this sector at the audit. Pinned at zero so
    // an ingest change that starts minting them here is visible.
    const [row] = await allRows<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
          AND awarder_eik = contractor_eik`,
      [EDU_SECTOR_EIKS],
    );
    assert.equal(
      row?.n ?? 0,
      0,
      "self-contracting rows in the education corpus",
    );
  });

  test.skipIf(skip)("the leaderboard shares the headline's basis", async () => {
    // Failure mode O, and it has to be measured against the SERVING path —
    // `awarder_group_model`, the function /sector/edu actually calls — not
    // re-derived from `contracts` here. An earlier cut of this test compared
    // SUM(x) to SUM(SUM(x) GROUP BY contractor_eik) over ONE CTE, which is a
    // GROUP BY identity: true under every database state, including a broken one.
    // It passed at a measured delta of 9.5e-6 and gated nothing.
    //
    // Two assertions, and the second is the point. The model's head total must
    // equal the raw windowed sum (a tag or window drift inside the function shows
    // up there). And the per-supplier rollup the leaderboard renders must account
    // for that total EXACTLY once the rows carrying no contractor EIK are added
    // back — 16 rows / €1,196,383 today, 0.06%. If the suppliers array stops
    // reconciling, one of the two halves has changed basis, which no other gate
    // in this file can see because each is individually correct.
    const [raw] = await allRows<{ eur: number }>(
      `SELECT COALESCE(SUM(amount_eur), 0)::float8 AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
      [EDU_SECTOR_EIKS],
    );
    const [m] = await allRows<{
      total: number;
      rolled: number;
      suppliers: number;
    }>(
      `WITH j AS (SELECT awarder_group_model($1::text[], NULL, NULL) AS m)
       SELECT (m->>'totalEur')::float8 AS total,
              (SELECT COALESCE(SUM((s->>'totalEur')::numeric), 0)
                 FROM jsonb_array_elements(m->'suppliers') s)::float8 AS rolled,
              (SELECT COUNT(*) FROM jsonb_array_elements(m->'suppliers'))::int AS suppliers
         FROM j`,
      [EDU_SECTOR_EIKS],
    );
    assert.ok(m && m.total > 0, "awarder_group_model returned no total");
    assert.ok(
      m.suppliers > 500,
      `only ${m.suppliers} suppliers in the model — the leaderboard is not being built`,
    );
    assert.ok(
      Math.abs(m.total - (raw?.eur ?? 0)) < 1,
      `group model head €${Math.round(m.total)} ≠ raw windowed sum €${Math.round(raw?.eur ?? 0)}`,
    );

    const [res] = await allRows<{ eur: number }>(
      `SELECT COALESCE(SUM(amount_eur), 0)::float8 AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
          AND (contractor_eik IS NULL OR contractor_eik = '')`,
      [EDU_SECTOR_EIKS],
    );
    const gap = m.total - m.rolled - (res?.eur ?? 0);
    // Per-supplier ROUNDing inside the model costs a euro or two across ~4k
    // rows, so this is a tolerance rather than an equality.
    assert.ok(
      Math.abs(gap) < 100,
      `leaderboard \u03a3 \u20ac${Math.round(m.rolled)} + no-EIK residue \u20ac${Math.round(res?.eur ?? 0)} ` +
        `leaves \u20ac${Math.round(gap)} unaccounted against the head \u20ac${Math.round(m.total)}`,
    );
  });
});
