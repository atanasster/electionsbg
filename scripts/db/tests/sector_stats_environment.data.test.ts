// Regression net for the ENVIRONMENT sector — the /governance/sectors tile and
// the /sector/environment dashboard behind it. Audit 2026-08-13,
// docs/plans/environment-sector-audit-v1.md.
//
//   npm run test:data
//
// A separate file from sector_stats.data.test.ts on purpose: a concurrent
// session held uncommitted work in that file while this was written, and the
// environment gates read a different set of sources (a budget node, the
// gitignored ministries tree, a beneficiary rollup) than the four sectors there.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE DECOUPLED HERE, which is what makes this
// sector's net a different shape from water's and transport's — read this before
// extending it. Those two reconcile the headline exactly to a live sum over
// their EIK-set, so ONE assertion gates both. Environment moved to basis='budget'
// in b54514e8ac: the tile now reads a ministry appropriation, and a wrong EIK
// does not move it by a cent. So the two need separate gates, and the EIK one
// cannot lean on a sum.
//
// The headline still gets an EXACT reconcile — against the МОСВ budget node
// rather than the corpus, over all 30 scopes and on value, year AND the
// `unavailable` flag (a €-band on one scope would miss a wrong year or a lost
// flag entirely). 30/30 exact, measured 2026-08-13.
//
// The EIK set gets three gates, because comparing the four copies is a tautology
// (they all import one constant): every member must be a REAL awarder, must LOOK
// like an МОСВ body, and the known-adjacent bodies must stay out. Mutation-checked,
// all four discriminate — a typo'd digit passes lockstep and fails the first;
// МВР's ДУССД 129010157 (the defense audit's €301M near-miss) passes both
// lockstep and the ghost check, and fails the second.
//
// What each block guards:
//
//  · BASIS — `basis === 'budget'`, asserted UNCONDITIONALLY (it reads only the
//    committed artifact). It catches three things at once: a revert of the
//    editorial decision, a `SECTOR_EIKS` re-entry, and — the quiet one — an
//    artifact nobody regenerated, since the pre-change file says 'procurement'.
//  · EIK-SET — lockstep, every member real, every member plausibly МОСВ, and an
//    ANTI-allowlist. The excluded bodies are not hypothetical: ДП РАО carries
//    €47M and lives in the energy set, the Шипка-Бузлуджа park-MUSEUM and the 11
//    ПРИРОДНИ (not national) парка are what a „парк"/„отпадъци" name sweep
//    surfaces, and admitting any of them double-counts across two sectors.
//  · BENEFICIARY — the audit's Phase 2b found this side clean (top contractor
//    3.7%, intra-group 0.08%, zero self-dealing). Cleanliness is exactly what
//    needs pinning: a rollup change that credited a consortium's full value to
//    every member would show up here as a SHARE long before anyone noticed a
//    total. Shares and classifications only — never a rank or an absolute €,
//    both of which move on every fortnightly reload.
// NOT here: the budget programme grain. Σ(programmes) ≤ its unit's total is the
// systemic half of 0de88e2ad0, and it is gated PER UNIT-YEAR against the cached
// laws by scripts/budget/lawProgramSums.data.test.ts. A copy here could only
// compare GRAND totals, because data/budget/reconciliation/by-program.json names
// no owning unit — and measured, that comparison is vacuous: ДФЗ's legitimately
// partial programme list (−91%) drags the 2024 ratio to 88%, so МОСВ's +25.1%
// and ДА „Държавен резерв"'s +100.0% are invisible inside it. A gate that cannot
// see the defect it names is worse than no gate, so this file does not carry one.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  ENV_SECTOR_EIKS,
  ENV_ENTITIES,
  ENV_ALIAS_EIKS,
  MOSV_EIK,
  IAOS_EIK,
  PUDOOS_EIK,
  NDEF_EIK,
  MOSV_BUDGET_NODE,
} from "@/lib/environmentReferenceData";
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
const MINISTRY_NODE = `data/budget/ministries/${MOSV_BUDGET_NODE}.json`;

// ── the hub headline ───────────────────────────────────────────────────────

describe("environment sector — the hub headline is a BUDGET", () => {
  // No PG skip: this reads the committed artifact, and a stale artifact is one
  // of the states the assertion exists to catch.
  test("basis is 'budget', not the МОСВ group's tender flow", () => {
    const stats = readJson<SectorStats>(STATS);
    const e = stats["all"]?.environment;
    assert.ok(e, "no `environment` entry in sector_stats.json at scope `all`");
    assert.equal(
      e.basis,
      "budget",
      "environment is back on a procurement headline. The 28-EIK МОСВ group's " +
        "own tender flow is €1.8M on the hub's default scope against a €77.8M " +
        "enacted line — see docs/plans/environment-sector-audit-v1.md Tier 1. " +
        "If the code is right, the artifact is stale: run db:gen-sector-stats.",
    );
    assert.equal(e.kind, "eur");
    assert.ok(
      e.year && e.year >= 2024,
      `expected a recent fiscal year on the headline, got ${e.year}`,
    );
  });

  test("every scope carries an environment entry", () => {
    const stats = readJson<SectorStats>(STATS);
    const missing = Object.keys(stats).filter((s) => !stats[s]?.environment);
    assert.deepEqual(missing, [], "scopes with no environment tile");
    // Guards against a one-scope artifact making the rest of this block vacuous.
    assert.ok(
      Object.keys(stats).length >= 25,
      `expected ~30 scopes, got ${Object.keys(stats).length}`,
    );
  });

  test.skipIf(!exists(MINISTRY_NODE))(
    "EVERY scope reconciles EXACTLY to the МОСВ node — value, year and unavailable",
    () => {
      // The budget analogue of the water/transport exact-reconcile, and the
      // reason this file does not settle for a band: a €-band on one scope
      // cannot see a wrong YEAR, a lost `unavailable` flag, or a scope→year
      // resolver that drifts. This re-derives all 30 from the source and
      // compares whole stats. Measured 2026-08-13: 30/30 exact.
      //
      // data/budget/ministries/ is GITIGNORED, hence the skip — the same
      // absent-tolerance the generator's own loadBudgetSeries() uses.
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
      assert.ok(byYear.size >= 5, `МОСВ node carries ${byYear.size} year(s)`);
      const latest = Math.max(...byYear.keys());

      const wrong: string[] = [];
      for (const [scope, row] of Object.entries(stats)) {
        const e = row.environment;
        const y = /^y:(\d{4})$/.exec(scope);
        // annual(): a y:<year> scope resolves to that year when the series has
        // it, else falls back to the latest AND flags itself unavailable.
        const known = !!y && byYear.has(Number(y[1]));
        const year = known ? Number(y![1]) : latest;
        const want = {
          basis: "budget",
          year,
          value: byYear.get(year),
          unavailable: !!y && !known,
        };
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
      assert.deepEqual(wrong, [], "scopes that disagree with the МОСВ node");
    },
  );

  // ⚠ NOT asserted here, on purpose: that `y:2024` reads the ЗДБ's €60,325,488
  // rather than the отчет's €104,230,071. Both this file and the generator read
  // ONE source (`ministryYearSeriesEur` over the ministries tree), so the
  // reconcile above is true either way and cannot see the difference — the tree
  // simply has no `expenditureLaw` yet. That the RULE prefers the ЗДБ is pinned
  // unconditionally, on synthetic input, by src/data/budget/ministrySeries.test.ts;
  // that it is not yet in the tree is the operator gap in the plan's Tier 1.
});

// ── the EIK set ────────────────────────────────────────────────────────────

describe("environment sector — the EIK set", () => {
  test("the copies stay in lockstep", () => {
    const dash = SECTOR_DASHBOARDS.environment;
    assert.ok(dash, "no `environment` entry in SECTOR_DASHBOARDS");
    const pack = SECTOR_BROWSE_PACKS.environment;
    assert.ok(pack, "no `environment` entry in SECTOR_BROWSE_PACKS");

    const ref = [...ENV_SECTOR_EIKS].sort();
    assert.deepEqual([...dash.members.map((m) => m.eik)].sort(), ref);
    assert.deepEqual([...pack.eiks].sort(), ref);
    assert.equal(dash.leadEik, MOSV_EIK);

    // ENV_ALIAS_EIKS is the fan-out useEnvironment spreads after the lead on the
    // МОСВ awarder page. It is derived, so this catches a filter that stops
    // excluding the lead (double-counting it) or starts excluding more.
    assert.deepEqual(
      [...ENV_ALIAS_EIKS].sort(),
      ENV_SECTOR_EIKS.filter((e) => e !== MOSV_EIK).sort(),
    );

    assert.equal(new Set(ENV_SECTOR_EIKS).size, ENV_SECTOR_EIKS.length);
    assert.equal(ENV_ENTITIES.length, ENV_SECTOR_EIKS.length);
    assert.ok(
      ENV_SECTOR_EIKS.length >= 28,
      `the set shrank to ${ENV_SECTOR_EIKS.length}`,
    );
    for (const e of ENV_ENTITIES)
      assert.match(e.eik, /^\d{9,13}$/, `malformed EIK ${e.eik} (${e.name})`);
  });

  test.skipIf(skip)(
    "every member is a REAL awarder in the corpus",
    async () => {
      // The check the lockstep above structurally cannot do. All four copies read
      // one constant, so a mistyped digit propagates identically and they stay
      // equal — but it matches no awarder.
      const rows = await allRows<{ eik: string }>(
        `SELECT DISTINCT awarder_eik AS eik FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
        [ENV_SECTOR_EIKS],
      );
      const seen = new Set(rows.map((r) => r.eik));
      const ghosts = ENV_ENTITIES.filter((e) => !seen.has(e.eik)).map(
        (e) => `${e.eik} (${e.name})`,
      );
      assert.deepEqual(ghosts, [], "EIKs in the set that award nothing");
    },
  );

  test.skipIf(skip)(
    "the four signature members clear a spend floor",
    async () => {
      const FLOORS: Array<[string, string, number]> = [
        [MOSV_EIK, "МОСВ", 50_000_000],
        [IAOS_EIK, "ИАОС", 40_000_000],
        [PUDOOS_EIK, "ПУДООС", 5_000_000],
        // НДЕФ is small by design (€410k) — the floor proves the audit's
        // addition is still attached, not that it is material.
        [NDEF_EIK, "НДЕФ", 100_000],
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
    },
  );

  test.skipIf(skip)(
    "every member LOOKS like an environment body in the corpus",
    async () => {
      // The ghost check above catches a FAKE EIK. This catches a real-but-wrong
      // one — a body that exists, awards money and is not МОСВ. That failure is
      // quieter here than in any procurement-basis sector: with a budget
      // headline the hub tile does not move at all, while the dashboard, the
      // browse pack and the group model all silently gain a stranger.
      //
      // Every one of the 28 members' corpus names matches; the pattern is
      // deliberately narrow (an МВР directorate, a hospital, a nature park or a
      // municipality does not).
      const ENV_NAME =
        /околн(а|ата) среда|екофонд|национален парк|басейнова дирекция|метеорология|хидрология|ПУДООС|РИОСВ|ИАОС/i;
      const rows = await allRows<{ eik: string; name: string }>(
        `SELECT awarder_eik AS eik, MIN(awarder_name) AS name
           FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
          GROUP BY awarder_eik`,
        [ENV_SECTOR_EIKS],
      );
      assert.ok(
        rows.length >= 25,
        `only ${rows.length} members resolved — set shrank?`,
      );
      const odd = rows
        .filter((r) => !ENV_NAME.test(r.name))
        .map((r) => `${r.eik} — ${r.name}`);
      assert.deepEqual(
        odd,
        [],
        "members whose corpus name does not read as an МОСВ body. If one is " +
          "genuinely environment, widen ENV_NAME and say why in the commit.",
      );
    },
  );

  test("the excluded bodies stay excluded", () => {
    // Each is a live double-count risk, not a hypothetical — see the header.
    const BANNED: Array<[string, string]> = [
      ["131218471", 'ДП „Радиоактивни отпадъци" — energy set (dbff131d02)'],
      ["000804161", 'Национален парк-МУЗЕЙ „Шипка — Бузлуджа"'],
      ["121486802", "ИА по горите (МЗХ)"],
      // The 11 ПРИРОДНИ парка — МЗХ, not МОСВ. Only the three NATIONAL ones
      // (Рила, Пирин, Централен Балкан) belong here.
      ["130044740", "ПП Витоша"],
      ["107554738", "ПП Българка"],
      ["121017961", "ПП Шуменско плато"],
      ["117085508", "ПП Русенски лом"],
      ["102664798", "ПП Странджа"],
      ["114546416", "ПП Персина"],
      ["119607289", "ПП Сините камъни"],
      ["175544209", "ПП Беласица"],
      ["121148188", "ПП Врачански балкан"],
      ["121148195", "ПП Златни пясъци"],
      ["109514872", "ПП Рилски манастир"],
    ];
    const inSet = new Set(ENV_SECTOR_EIKS);
    const leaked = BANNED.filter(([eik]) => inSet.has(eik)).map(
      ([eik, why]) => `${eik} — ${why}`,
    );
    assert.deepEqual(
      leaked,
      [],
      "excluded bodies found in the environment set",
    );
  });
});

// ── the beneficiary side ───────────────────────────────────────────────────

describe("environment sector — who the money reaches", () => {
  test.skipIf(skip)(
    "no single contractor dominates the all-scope leaderboard",
    async () => {
      // 3.7% today. The ceiling is loose on purpose: a leaderboard is SUPPOSED
      // to reorder, and pinning a rank would fail on every reload. What it
      // catches is a rollup that starts crediting a consortium's full value to
      // each member — visible as a share long before a total looks wrong.
      const [row] = await allRows<{ pct: number; n: number }>(
        `WITH w AS (
           SELECT contractor_eik, SUM(amount_eur) AS eur
             FROM contracts
            WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
              AND contractor_eik IS NOT NULL AND contractor_eik <> ''
            GROUP BY contractor_eik)
         SELECT (100.0 * MAX(eur) / NULLIF(SUM(eur), 0))::float8 AS pct,
                COUNT(*)::int AS n
           FROM w`,
        [ENV_SECTOR_EIKS],
      );
      assert.ok(row && row.n > 200, `only ${row?.n} contractors — set shrank?`);
      // `null < 15` is true, so an empty corpus would pass silently. Require a
      // real number first.
      assert.equal(typeof row.pct, "number", "no contractor money at all");
      assert.ok(
        row.pct < 15,
        `top contractor holds ${row.pct.toFixed(1)}% of the sector (was 3.7%)`,
      );
    },
  );

  test.skipIf(skip)(
    "intra-group circulation stays a rounding error, and nobody contracts with itself",
    async () => {
      // €197,615 = 0.08% today (МОСВ→НИМХ only). „The sector procured €X"
      // implies an external market; this is the part that never reached one.
      // Self-dealing is a register artifact (awarder_eik = contractor_eik) and
      // the environment set has none — if it grows one, it is worth seeing.
      const [row] = await allRows<{ pct: number; self: number }>(
        `SELECT (100.0 * COALESCE(SUM(amount_eur) FILTER (
                   WHERE contractor_eik = ANY($1::text[])), 0)
                 / NULLIF(SUM(amount_eur), 0))::float8 AS pct,
                COUNT(*) FILTER (WHERE awarder_eik = contractor_eik)::int AS self
           FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
        [ENV_SECTOR_EIKS],
      );
      assert.equal(typeof row.pct, "number", "no sector money at all");
      // 0.5% against a measured 0.08% — 6x headroom, where 2% needed €5.14M to
      // fire and would have slept through an order-of-magnitude change.
      assert.ok(
        row.pct < 0.5,
        `intra-group circulation is ${row.pct.toFixed(2)}% (was 0.08%)`,
      );
      assert.equal(row.self, 0, "a body is contracting with itself");
    },
  );

  test.skipIf(skip)(
    "the group model's supplier rollup shares the headline's basis",
    async () => {
      // Failure mode O. Both halves are individually correct, so nothing else
      // sees a divergence: the awarders total and the leaderboard beneath it
      // must be one number, or the page contradicts itself.
      const [row] = await allRows<{
        total: number;
        suppliers: number;
        no_eik: number;
      }>(
        `WITH m AS (SELECT awarder_group_model($1::text[], NULL, NULL) AS j)
         SELECT (j->>'totalEur')::float8 AS total,
                (SELECT COALESCE(SUM((s->>'totalEur')::numeric), 0)
                   FROM jsonb_array_elements(j->'suppliers') s)::float8 AS suppliers,
                (SELECT COALESCE(SUM(amount_eur), 0) FROM contracts
                  WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
                    AND (contractor_eik IS NULL OR contractor_eik = ''))::float8 AS no_eik
           FROM m`,
        [ENV_SECTOR_EIKS],
      );
      // Without this, 0 − 0 − 0 < 50 passes on an empty corpus and the whole
      // assertion is decoration.
      assert.ok(
        row.total > 100_000_000,
        `group model totals €${Math.round(row.total)} — corpus shrank?`,
      );
      // The rollup legitimately omits rows with no contractor EIK; everything
      // else must be accounted for. €5 of rounding across ~2,276 rows; the €50
      // ceiling is ~6σ against a measured spread of ~€8.
      const unexplained = Math.abs(row.total - row.suppliers - row.no_eik);
      assert.ok(
        unexplained < 50,
        `€${unexplained.toFixed(0)} of the group total is in neither the ` +
          `supplier rollup nor the no-EIK residue`,
      );
    },
  );
});
