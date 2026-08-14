// Regression net for the REGIONAL sector — the /governance/sectors tile and the
// /sector/regional dashboard behind it. Audit 2026-08-14.
//
//   npm run test:data
//
// Its own file rather than an extension of sector_stats.data.test.ts, for the same
// reason sector_stats_environment.data.test.ts is: regional is budget-basis, so its
// headline and its EIK-set are DECOUPLED and need separate gates. A wrong EIK does
// not move the tile by a cent, and a wrong budget node does not move the group total.
//
// The three defects this audit found, and what guards each:
//
//  · THE HEADLINE lost 2019 entirely. The 2019 budget law spells the ministry with a
//    U+00AD soft hyphen, `slugify` turned it into a word break, and the year landed
//    on a second admin node — so the only budget-basis sector missing 2019 showed
//    „няма данни за 2019" while its real €264,181,243 sat in the repo. Gated by an
//    EXACT per-scope reconcile against the node (a band on one scope cannot see a
//    wrong year or a lost `unavailable` flag), a named assertion on y:2019, and a
//    no-split-node check that catches the CLASS rather than this instance.
//  · THE EIK SET listed 27 of Bulgaria's 28 областни администрации, because it was
//    curated by measuring the corpus and Търговище has never awarded anything. The
//    roster SHAPE is gated in src/lib/regionalReferenceData.test.ts (a bijection with
//    the canonical oblast buckets, plus the АПИ/ВиК exclusions — all pure array
//    checks needing no Postgres). What lives HERE is only what the corpus can answer.
//  · THE HERO divided a full-year appropriation by a part-year of contracts. A pure
//    function, gated in src/data/budget/ministrySeries.test.ts and
//    RegionalPassThroughHero.test.tsx.
//
// Beneficiary side: the audit found it clean (top contractor 4.2% all-time, zero
// intra-group circulation, no self-dealing), so the gates are CEILINGS, shares and
// basis-agreement — never a rank or an absolute €. A leaderboard is supposed to
// reorder; that is the one thing about it which is not a defect.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  REGIONAL_BUDGET_NODE,
  REGIONAL_EIK,
  REGIONAL_ENTITIES,
  REGIONAL_SECTOR_EIKS,
} from "@/lib/regionalReferenceData";
import { ministryYearSeriesEur } from "@/data/budget/ministrySeries";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const readJson = <T>(rel: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")) as T;
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

const reachable = async (): Promise<boolean> => {
  try {
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
// GITIGNORED (0 of 54 files tracked) — only the reconcile below reads it, and only
// that test may skip on it.
const NODE = `data/budget/ministries/${REGIONAL_BUDGET_NODE}.json`;
// TRACKED, so these carry no skip: a missing tracked file is a real defect.
const ADMIN_REGISTRY = "data/budget/classification/admin.json";
const PROGRAM_REGISTRY = "data/budget/classification/program.json";

// `g` is required by `.replace()` and POISONS `.test()` — `lastIndex` is stateful,
// so consecutive tests over different strings resume from a stale offset and the
// offender list comes back partial ([true, false, true] over three offenders,
// measured). Membership gets its own non-global copy.
const INVISIBLE = /[\p{Cf}͏︀-️]/gu;
const HAS_INVISIBLE = /[\p{Cf}͏︀-️]/u;

// ── the hub headline ───────────────────────────────────────────────────────

describe("regional sector — the hub headline is a BUDGET", () => {
  // No PG skip in this block: it reads the COMMITTED artifact, and a stale
  // artifact is one of the states these assertions exist to catch.
  test("basis is 'budget', not the МРРБ group's tender flow", () => {
    const stats = readJson<SectorStats>(STATS);
    const r = stats["all"]?.regional;
    assert.ok(r, "no `regional` entry in sector_stats.json at scope `all`");
    assert.equal(
      r.basis,
      "budget",
      "regional is back on a procurement headline. МРРБ is a PASS-THROUGH " +
        "ministry: it directs ~€1.06bn a year and procures ~€226M all-time " +
        "across the whole 31-EIK group, so a procurement headline understates " +
        "the sector ~5× and buries its own thesis. If the code is right, the " +
        "artifact is stale: run db:gen-sector-stats.",
    );
    assert.equal(r.kind, "eur");
  });

  test("every scope carries a regional entry", () => {
    const stats = readJson<SectorStats>(STATS);
    const missing = Object.keys(stats).filter((s) => !stats[s]?.regional);
    assert.deepEqual(missing, [], "scopes with no regional tile");
    // Guards against a one-scope artifact making this block vacuous.
    assert.ok(
      Object.keys(stats).length >= 25,
      `expected ~30 scopes, got ${Object.keys(stats).length}`,
    );
  });

  test("y:2019 serves the real figure — the soft-hyphen regression", () => {
    // THE named gate, and deliberately NOT skipped on the gitignored ministries
    // tree: every assertion here is answerable from the committed
    // sector_stats.json alone. Guarding it on a file it never reads is how the
    // one gate named for this audit's defect would have been off on CI, on a
    // fresh clone, and on any machine that has not run update-budget.
    //
    // Before the slugify fix this scope carried `unavailable: true` with the
    // latest year's value, so the tile read „няма данни за 2019" while
    // €264,181,243 sat in the repo under a second node id minted from a U+00AD
    // in the ministry's name. A band alone would pass on the wrong year, so the
    // flag and the year are asserted and the value only loosely.
    const r = readJson<SectorStats>(STATS)["y:2019"]?.regional;
    assert.ok(r, "no regional entry at scope y:2019");
    assert.equal(
      r.unavailable,
      undefined,
      "y:2019 is unavailable again — the 2019 slice has been orphaned onto a " +
        "second admin node. Check scripts/lib/slug.ts strips invisible marks " +
        "and re-run npm run budget:ingest.",
    );
    assert.equal(r.year, 2019);
    assert.ok(
      r.value > 2e8 && r.value < 4e8,
      `y:2019 headline €${Math.round(r.value)} is outside the band for the ` +
        `2019 ЗДБ line (~€264M)`,
    );
  });

  test.skipIf(!exists(NODE))(
    "EVERY scope reconciles EXACTLY to the МРРБ node — value, year, kind and unavailable",
    () => {
      // A €-band on one scope cannot see a wrong YEAR, a lost `unavailable`
      // flag, a `kind` that stops being € (which turns the tile's € into a bare
      // number), or a scope→year resolver that drifts. So all 30 are re-derived
      // from the source and compared whole.
      //
      // This is the ONE test in the file that genuinely reads the gitignored
      // ministries tree, so it is the one that may skip on its absence — the
      // same absent-tolerance the generator's own loadBudgetSeries() uses.
      const stats = readJson<SectorStats>(STATS);
      const node = readJson<{
        years?: Array<{
          fiscalYear: number;
          expenditure?: { amountEur?: number | null };
          expenditureLaw?: { amountEur?: number | null } | null;
        }>;
      }>(NODE);

      const byYear = new Map<number, number>();
      for (const y of node.years ?? []) {
        const v = ministryYearSeriesEur(y);
        if (v) byYear.set(y.fiscalYear, v);
      }
      assert.ok(byYear.size >= 8, `МРРБ node carries ${byYear.size} year(s)`);
      assert.ok(
        byYear.has(2019),
        "the МРРБ node has no 2019 — the soft-hyphen split is back",
      );
      // Floor on the STATS side too, so an empty artifact cannot satisfy the
      // loop below by having nothing to iterate.
      assert.ok(
        Object.keys(stats).length >= 25,
        `expected ~30 scopes, got ${Object.keys(stats).length}`,
      );
      const latest = Math.max(...byYear.keys());

      const wrong: string[] = [];
      for (const [scope, row] of Object.entries(stats)) {
        const r = row.regional;
        const y = /^y:(\d{4})$/.exec(scope);
        // annual(): a y:<year> scope resolves to that year when the series has
        // it, else falls back to the latest AND flags itself unavailable.
        const known = !!y && byYear.has(Number(y[1]));
        const year = known ? Number(y![1]) : latest;
        const want = {
          kind: "eur",
          basis: "budget",
          year,
          value: byYear.get(year),
          unavailable: !!y && !known,
        };
        const got = {
          kind: r?.kind,
          basis: r?.basis,
          year: r?.year,
          value: r?.value,
          unavailable: !!r?.unavailable,
        };
        if (JSON.stringify(got) !== JSON.stringify(want))
          wrong.push(
            `${scope}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`,
          );
      }
      assert.deepEqual(wrong, [], "scopes that disagree with the МРРБ node");
    },
  );

  test("no spending unit or programme is split across two nodes", () => {
    // The CLASS gate rather than the instance one. МРРБ's 2019 was orphaned
    // because an invisible character in its name minted a second node id — and
    // the SAME character split МОН's „Администрация" programme in the same run,
    // which is why the programme grain is checked here too rather than only the
    // admin one. Comparing names with invisible marks NORMALISED catches any
    // future occurrence, whichever unit and whichever character.
    for (const [rel, floor] of [
      [ADMIN_REGISTRY, 40],
      [PROGRAM_REGISTRY, 90],
    ] as const) {
      const registry = readJson<{
        nodes: { id: string; nameBg: string; ownerAdminId?: string }[];
      }>(rel);
      assert.ok(
        registry.nodes.length > floor,
        `${rel} looks truncated (${registry.nodes.length} nodes)`,
      );

      const byName = new Map<string, string[]>();
      for (const n of registry.nodes) {
        // Programme names repeat legitimately across ministries („Администрация"
        // exists 18 times), so the identity is (owner, name) — exactly the key
        // the generator's own programId() uses.
        const key =
          `${n.ownerAdminId ?? ""}|` +
          (n.nameBg ?? "").replace(INVISIBLE, "").trim().toLowerCase();
        byName.set(key, [...(byName.get(key) ?? []), n.id]);
      }
      const split = [...byName.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([name, ids]) => `${rel} ${name}: ${ids.join(" + ")}`);
      assert.deepEqual(split, [], "units split across two node ids");

      // …and no node's RENDERED name still carries such a character, which is
      // what puts the wrong spelling on the page even once the ids are merged.
      const marked = registry.nodes
        .filter((n) => HAS_INVISIBLE.test(n.nameBg ?? ""))
        .map((n) => `${rel} ${n.id}`);
      assert.deepEqual(
        marked,
        [],
        "nodes whose nameBg holds an invisible mark",
      );
    }
  });
});

// ── the EIK set ────────────────────────────────────────────────────────────

describe("regional sector — the EIK set", () => {
  test("the copies stay in lockstep", () => {
    // A tautology today — every copy imports REGIONAL_SECTOR_EIKS — and that is
    // the point: it fails the moment one re-hardcodes its own digits, which is
    // the drift this class of audit keeps finding.
    const dash = SECTOR_DASHBOARDS.regional;
    assert.ok(dash, "no `regional` entry in SECTOR_DASHBOARDS");
    const pack = SECTOR_BROWSE_PACKS.regional;
    assert.ok(pack, "no `regional` entry in SECTOR_BROWSE_PACKS");

    const ref = [...REGIONAL_SECTOR_EIKS].sort();
    assert.deepEqual([...dash.members.map((m) => m.eik)].sort(), ref);
    assert.deepEqual([...pack.eiks].sort(), ref);
    assert.equal(dash.leadEik, REGIONAL_EIK);
  });

  test("`regional` has not re-entered the generator's procurement EIK map", () => {
    // Read from the generator's SOURCE, because the artifact CANNOT answer this:
    // scopeStats() writes the procurement sectors first and the budget loop
    // overwrites them, so `regional` being in SECTOR_EIKS would still emit
    // basis='budget' and any artifact-level assertion would pass. SECTOR_EIKS is
    // module-private, hence the text read.
    const gen = fs.readFileSync(
      path.join(ROOT, "scripts/db/gen_procurement/sector_stats.ts"),
      "utf-8",
    );
    const map = /const SECTOR_EIKS[^{]*\{([\s\S]*?)\n\};/.exec(gen)?.[1];
    assert.ok(
      map,
      "could not find SECTOR_EIKS in the generator — grep drifted",
    );
    assert.ok(
      /\broads\s*:/.test(map),
      "SECTOR_EIKS parsed but looks empty — the regex matched the wrong block",
    );
    assert.ok(
      !/^\s*regional\s*:/m.test(map),
      "`regional` is back in the generator's SECTOR_EIKS map — that restores a " +
        "procurement headline for a pass-through ministry",
    );
  });

  test.skipIf(skip)("every member that spends is a real awarder", async () => {
    // A typo'd digit passes lockstep (all copies read one constant) and fails
    // here. Търговище is exempt BY ITS OWN FLAG rather than by name, so the
    // exemption cannot silently cover a second, accidental ghost.
    const expected = REGIONAL_ENTITIES.filter((e) => !e.noAwarderPage).map(
      (e) => e.eik,
    );
    assert.ok(expected.length > 25, `only ${expected.length} members expected`);
    const rows = await allRows<{ eik: string }>(
      `SELECT DISTINCT awarder_eik AS eik FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
      [expected],
    );
    const live = new Set(rows.map((r) => r.eik));
    assert.deepEqual(
      expected.filter((e) => !live.has(e)),
      [],
      "members with no contracts and no noAwarderPage flag — either a typo'd " +
        "EIK, or a body that genuinely never awards and needs the flag",
    );
  });

  test.skipIf(skip)("the МВР directorates stay out", async () => {
    // The АПИ/ВиК exclusions live in regionalReferenceData.test.ts — pure array
    // membership, no Postgres needed. These two are here because the point is
    // their €: they sit in the 1290* Булстат range adjacent to bodies this set
    // does contain, and folding them in was the defense audit's €370M
    // near-miss. Asserting the money is what shows why the allowlist exists.
    const MVR = ["129010157", "129010698"];
    for (const eik of MVR)
      assert.ok(
        !REGIONAL_SECTOR_EIKS.includes(eik),
        `МВР directorate ${eik} is in the regional set`,
      );
    const [row] = await allRows<{ eur: number }>(
      `SELECT COALESCE(SUM(amount_eur), 0)::float8 AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
      [MVR],
    );
    assert.ok(
      row.eur > 1e8,
      `the МВР directorates carry €${Math.round(row.eur)} — if this has ` +
        `collapsed the anti-allowlist has stopped meaning anything`,
    );
  });

  test.skipIf(skip)(
    "the group total stays in its order of magnitude",
    async () => {
      // A BAND, not a figure: the corpus grows fortnightly. The floor catches an
      // over-trim or a corpus that failed to load.
      //
      // ⚠ What the CEILING can and cannot see, measured 2026-08-14: АПИ
      // (€8.80bn) would blow through it 9×, so the roads guard is real. ВиК
      // холдинг is €636,908 — folding it in moves the total 0.28% and this band
      // would never notice. That is why the ВиК exclusion is pinned by EIK in
      // regionalReferenceData.test.ts rather than left to this number.
      const [row] = await allRows<{ eur: number; n: string }>(
        `SELECT COALESCE(ROUND(SUM(amount_eur)), 0)::float8 AS eur, COUNT(*) AS n
           FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
        [REGIONAL_SECTOR_EIKS],
      );
      assert.ok(
        row.eur > 1.5e8 && row.eur < 1.0e9,
        `group all-time total €${Math.round(row.eur)} is outside the band ` +
          `(€226M measured 2026-08-14; АПИ leaking in would exceed it)`,
      );
      assert.ok(Number(row.n) > 1500, `only ${row.n} contracts in the group`);
    },
  );
});

// ── the beneficiary side ───────────────────────────────────────────────────

describe.skipIf(skip)(
  "regional sector — the top-contractors leaderboard",
  () => {
    test("no single contractor dominates the all-time window", async () => {
      // A CEILING, never a rank. Measured 2026-08-14 the top beneficiary is
      // Хидрострой АД at 4.2% — a genuinely spread leaderboard, unlike energy's
      // 32.7%. The ceiling would catch a rollup change that starts crediting a
      // consortium's FULL value to every member, which shows up as a share long
      // before it shows up as a total.
      //
      // Rows with no contractor EIK are EXCLUDED: `GROUP BY contractor_eik`
      // collapses them into one bucket that then competes for the LIMIT 1 slot.
      // It is the register's unattributed residue, not a contractor — 25 rows /
      // €265,910 / 0.12% today — and if it ever outgrew the real leader while
      // staying under the ceiling, this test would pass on a phantom and examine
      // no real contractor at all.
      const [row] = await allRows<{
        pct: string | null;
        name: string | null;
        n: string;
      }>(
        `WITH w AS (
         SELECT * FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
            AND contractor_eik IS NOT NULL AND contractor_eik <> ''
       )
       SELECT MIN(contractor_name) AS name,
              ROUND((100.0 * SUM(amount_eur)
                     / NULLIF((SELECT SUM(amount_eur) FROM w), 0))::numeric, 2) AS pct,
              (SELECT COUNT(DISTINCT contractor_eik) FROM w) AS n
         FROM w GROUP BY contractor_eik
        ORDER BY SUM(amount_eur) DESC NULLS LAST LIMIT 1`,
        [REGIONAL_SECTOR_EIKS],
      );
      // `Number(null)` is 0 and `0 < 25` passes, so an empty window would satisfy
      // the ceiling silently. Require a real population and a real share first.
      assert.ok(
        Number(row?.n) > 400,
        `only ${row?.n} contractors — set shrank?`,
      );
      assert.ok(row?.pct != null, "no contractor money at all in the group");
      assert.ok(
        Number(row.pct) < 25,
        `top contractor ${row.name} holds ${row.pct}% of the sector all-time — ` +
          `over the 25% ceiling. Either a real concentration worth a caption, or ` +
          `a consortium/parent double-count in the rollup.`,
      );
    });

    test("the SERVING rollup shares the headline's basis", async () => {
      // Failure mode O: both halves individually correct, on two different bases,
      // so the page contradicts itself and no other gate here can see it.
      //
      // ⚠ It has to call `awarder_group_model()` — the function /sector/regional
      // actually renders. Comparing a raw SUM against the same SUM regrouped is a
      // mathematical identity that cannot fail (measured: both €226,013,024),
      // which is what this assertion was before review. Now the model's own total
      // must equal its own supplier rollup plus the no-EIK residue, so a
      // serving-side tag or window change (`tag='contract'` excludes amendments)
      // breaks it.
      const [row] = await allRows<{
        total: number;
        suppliers: number;
        no_eik: number;
        n: number;
      }>(
        `WITH m AS (SELECT awarder_group_model($1::text[], NULL, NULL) AS j)
       SELECT (j->>'totalEur')::float8 AS total,
              (SELECT COALESCE(SUM((s->>'totalEur')::numeric), 0)
                 FROM jsonb_array_elements(j->'suppliers') s)::float8 AS suppliers,
              (SELECT COALESCE(SUM(amount_eur), 0) FROM contracts
                WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
                  AND (contractor_eik IS NULL OR contractor_eik = ''))::float8 AS no_eik,
              jsonb_array_length(j->'suppliers')::float8 AS n
         FROM m`,
        [REGIONAL_SECTOR_EIKS],
      );
      assert.ok(row.total > 1.5e8, `group model total is €${row.total}`);
      assert.ok(row.n > 400, `group model returned ${row.n} suppliers`);
      // ~€6 of float association across 726 supplier aggregations, measured.
      assert.ok(
        Math.abs(row.total - (row.suppliers + row.no_eik)) < 100,
        `the group model's total (€${Math.round(row.total)}) ≠ its suppliers ` +
          `(€${Math.round(row.suppliers)}) + the no-EIK residue ` +
          `(€${Math.round(row.no_eik)}) — the serving rollup and the raw corpus ` +
          `are on different bases`,
      );
    });

    test("no body contracts with itself", async () => {
      // A register artifact (the buyer landing in the supplier field) rather than
      // a sector defect — 29 rows / €3.87M corpus-wide — but it would be a real
      // €-inflating self-deal if it appeared here, so it is pinned at zero.
      const [row] = await allRows<{ n: string }>(
        `SELECT COUNT(*) AS n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
          AND awarder_eik = contractor_eik`,
        [REGIONAL_SECTOR_EIKS],
      );
      assert.equal(
        Number(row.n),
        0,
        "self-contracting rows in the regional group",
      );
    });

    test("almost nothing circulates inside the group", async () => {
      // Zero today. BANDED rather than pinned at zero, because one governor buying
      // anything from АГКК is a legitimate corpus event and the remedy for it is
      // editorial — the headline stays arithmetically right (each row is counted
      // once, awarder-side) but „the sector procured €X" starts implying an
      // external market that part of X did not reach, which is a pack footnote,
      // not a filter. The edge list is kept in the message so the signal is
      // actionable rather than a bare percentage.
      const rows = await allRows<{ a: string; c: string; eur: number }>(
        `SELECT awarder_name AS a, contractor_name AS c,
              COALESCE(SUM(amount_eur), 0)::float8 AS eur
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
          AND contractor_eik = ANY($1::text[])
        GROUP BY 1, 2`,
        [REGIONAL_SECTOR_EIKS],
      );
      const [tot] = await allRows<{ eur: number }>(
        `SELECT COALESCE(SUM(amount_eur), 0)::float8 AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
        [REGIONAL_SECTOR_EIKS],
      );
      assert.ok(
        tot.eur > 1.5e8,
        "no group money at all — the corpus is not loaded",
      );
      const inner = rows.reduce((s, r) => s + r.eur, 0);
      const pct = (100 * inner) / tot.eur;
      assert.ok(
        pct < 0.5,
        `intra-group circulation is ${pct.toFixed(2)}% (€${Math.round(inner)}): ` +
          rows.map((r) => `${r.a} → ${r.c} €${Math.round(r.eur)}`).join("; "),
      );
    });
  },
);
