// Regression net for the SOCIAL sector — the /governance/sectors tile and the
// /sector/social dashboard behind it. Audit 2026-08-15,
// docs/plans/social-sector-audit-v1.md.
//
//   npm run test:data
//
// Its own file, like the environment and regional nets, because the sources it
// reads (a ministry budget node, an eight-EIK group, a beneficiary rollup) are not
// the ones sector_stats.data.test.ts covers.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE DECOUPLED, same shape as environment. The tile
// reads the МТСП appropriation, so a wrong EIK does not move it by a cent and one
// assertion cannot gate both. Note this sector goes one step further than
// environment: ДАЗД is an operator-approved member whose budget is NOT in that node
// at all (ПРБ to the Министерски съвет), so the two sides are not merely computed
// from different sources — they cover different sets of bodies on purpose.
//
// What each block guards:
//
//  · BASIS — `basis === 'budget'` and an EXACT reconcile against the МТСП node on
//    value, year AND `unavailable`, across all 30 scopes. A €-band on one scope
//    would miss a wrong year or a lost flag (the environment precedent).
//  · Σ(programs) == the node's expenditure per fiscal year. This is what makes
//    SocialBudgetBridgeTile's stacked columns reconcile to the hub tile; the two
//    read the same file through different fields and nothing else pairs them.
//  · EIK-SET — lockstep across the three copies (social has three, not four: the
//    generator's SECTOR_EIKS has no social entry, because the headline is budget
//    basis), every member a real awarder, and an ANTI-allowlist. Comparing the
//    copies is close to a tautology since they all derive from one constant, so the
//    anti-allowlist is the block that does the work.
//  · CLASSIFIER — the two audit fixes stated as properties rather than as labels,
//    so a future re-bucketing cannot quietly restore either.
//  · BENEFICIARY — the top contractor's SHARE and its classification, never a rank
//    or an absolute €. Both of those move on every fortnightly reload; a leaderboard
//    reordering is the one thing about it that is not a defect.
//
// NOT here: anything that pins ФМФИБ at #1 or at €33.0M. It is #1 today because a
// single 2026 contract is 10% of the corpus; when the corpus grows past it that is
// the corpus working, not a regression.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  SOCIAL_SECTOR_EIKS,
  SOCIAL_ENTITIES,
  SOCIAL_STATE_BODY_CONTRACTORS,
  SOCIAL_BUDGET_NODE,
  SOCIAL_EIK,
  ASP_EIK,
} from "@/lib/socialReferenceData";
import { categoryOfCpv, categoryLabel } from "@/lib/socialAttributes";
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

// `test.skipIf(bool)`, never `test(name, { skip }, fn)` — Vitest's `skip` option is
// typed `boolean`, so passing `false | string` is 6 TS2769s and `npm run build` is
// `tsc -b && vite build`. Vitest does not typecheck, so the file runs green while
// the build is red. Every one of the 106 sibling files here uses skipIf.
const haveDb = await reachable();
const noDb = !haveDb;

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
type BudgetYear = {
  fiscalYear: number;
  expenditure?: { amountEur?: number | null } | null;
  // ⚠ READ VIA ministryYearSeriesEur, never `expenditure` directly. When a node
  // gains an `expenditureLaw` the generator switches to it, and МОСВ already has
  // one for 2024 (+72.8% from `expenditure`) — so a hand-retyped field read here
  // would fail this test on entirely correct data the day МТСП gets its own.
  expenditureLaw?: { amountEur?: number | null } | null;
  programs?: {
    nameBg: string;
    planned?: { amountEur?: number | null } | null;
  }[];
};

const STATS = "data/procurement/derived/sector_stats.json";
const NODE = `data/budget/ministries/${SOCIAL_BUDGET_NODE}.json`;

const budgetYears = (): BudgetYear[] =>
  readJson<{ years: BudgetYear[] }>(NODE).years.filter(
    (y) => (ministryYearSeriesEur(y) ?? 0) > 0,
  );
const nodeEur = (y: BudgetYear): number => ministryYearSeriesEur(y)!;

// ── the hub headline ───────────────────────────────────────────────────────

describe("social sector — the hub headline is the МТСП BUDGET", () => {
  // No PG skip: this reads committed artifacts, and a stale artifact is one of the
  // states the assertion exists to catch.
  test("basis is 'budget', not the group's thin tender flow", () => {
    const stats = readJson<SectorStats>(STATS);
    const s = stats["all"]?.social;
    assert.ok(s, "no `social` entry at scope `all`");
    assert.equal(s.basis, "budget");
    assert.equal(s.kind, "eur");
    // The group procures ~€325M cumulatively against a €2.1bn ANNUAL budget, so a
    // procurement basis here would understate the sector by an order of magnitude
    // — the Култура €3k-vs-€234M failure that moved these tiles onto budgets.
    assert.ok(
      s.value > 1_000_000_000,
      `headline ${s.value} looks like a procurement figure, not a budget`,
    );
  });

  // skipIf, NOT an `if (…) return` — an early return reports a green PASS on any
  // machine without the gitignored ministries tree, which is the shape where a
  // regression net quietly stops being one.
  test.skipIf(!exists(NODE))(
    "every scope reconciles EXACTLY to the МТСП node",
    () => {
      const stats = readJson<SectorStats>(STATS);
      const years = budgetYears();
      const latest = years.reduce((a, b) =>
        b.fiscalYear > a.fiscalYear ? b : a,
      );

      let checked = 0;
      for (const [scopeKey, sectors] of Object.entries(stats)) {
        const s = sectors.social;
        if (!s) continue;
        checked++;
        assert.equal(s.basis, "budget", `${scopeKey}: basis drifted`);

        const want = /^y:(\d{4})$/.exec(scopeKey);
        const hit = want
          ? years.find((y) => y.fiscalYear === Number(want[1]))
          : undefined;
        const expected = hit ?? latest;

        assert.equal(
          s.value,
          nodeEur(expected),
          `${scopeKey}: value does not match the node's FY${expected.fiscalYear}`,
        );
        assert.equal(s.year, expected.fiscalYear, `${scopeKey}: wrong year`);
        // The flag is as load-bearing as the number: without it a y:2011 scope shows
        // a 2026 figure captioned 2011 instead of „няма данни".
        assert.equal(
          !!s.unavailable,
          !!want && !hit,
          `${scopeKey}: \`unavailable\` disagrees with the node's coverage`,
        );
      }
      assert.ok(checked >= 25, `only ${checked} scopes carried a social entry`);
    },
  );

  // SocialBudgetBridgeTile sums the node's PROGRAMS while the hub tile reads its
  // EXPENDITURE. Nothing else pairs those two fields, and if they diverge the page
  // shows one total in its bar chart and another in the tile above it.
  test.skipIf(!exists(NODE))(
    "Σ(programs) equals the node's expenditure, per fiscal year",
    () => {
      for (const y of budgetYears()) {
        const sum = (y.programs ?? []).reduce(
          (a, p) => a + (p.planned?.amountEur ?? 0),
          0,
        );
        const exp = nodeEur(y);
        assert.ok(
          Math.abs(sum - exp) <= 2,
          `FY${y.fiscalYear}: Σ(programs) ${sum} vs expenditure ${exp}`,
        );
      }
    },
  );
});

// ── the EIK set ────────────────────────────────────────────────────────────

describe("social sector — the EIK set", () => {
  // ⚠ A TRIPWIRE, and it is UNFAILABLE while healthy — by construction, not by
  // accident. `SECTOR_BROWSE_PACKS.social.eiks` IS `SOCIAL_SECTOR_EIKS` (the same
  // object), so today this compares an array with itself. That is the correct
  // state; the assertion arms the moment a copy stops deriving and starts holding
  // its own digits, which is the drift it exists for. Do not read a green here as
  // evidence the copies were checked — the anti-allowlist below is the block that
  // does real work.
  test("the three copies are in lockstep", () => {
    const dash = SECTOR_DASHBOARDS.social!.members.map((m) => m.eik);
    const pack = SECTOR_BROWSE_PACKS.social!.eiks;
    assert.deepEqual([...dash].sort(), [...SOCIAL_SECTOR_EIKS].sort());
    assert.deepEqual([...pack].sort(), [...SOCIAL_SECTOR_EIKS].sort());
    assert.equal(SECTOR_DASHBOARDS.social!.leadEik, SOCIAL_EIK);
  });

  test.skipIf(noDb)(
    "every member is a real awarder in the corpus",
    async () => {
      const rows = await allRows<{ eik: string }>(
        `SELECT DISTINCT awarder_eik AS eik FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
        [SOCIAL_SECTOR_EIKS],
      );
      const found = new Set(rows.map((r) => r.eik));
      const ghosts = SOCIAL_SECTOR_EIKS.filter((e) => !found.has(e));
      assert.deepEqual(
        ghosts,
        [],
        `EIKs with no contracts: ${ghosts.join(", ")}`,
      );
    },
  );

  test("the two bodies the audit added are present", () => {
    // НИПА — КТ чл. 4а, второстепенен разпоредител към министъра на труда.
    assert.ok(SOCIAL_SECTOR_EIKS.includes("131083803"), "НИПА missing");
    // ДАЗД — an operator-approved editorial inclusion; ЗЗД чл. 17 makes it a ПРБ
    // to the МС, so it is the one member outside SOCIAL_BUDGET_NODE. Removing it
    // is a decision, not a cleanup: see socialReferenceData's header.
    assert.ok(SOCIAL_SECTOR_EIKS.includes("130453541"), "ДАЗД missing");
  });

  // The block that actually discriminates. Each of these is a body a name sweep or
  // a plausible widening would pull in, and each would be a real error.
  test("the anti-allowlist holds", () => {
    const banned: [string, string][] = [
      // Top hit of a „социал" name sweep at €309M — more than this whole group,
      // and the same class as the defense audit's €370M near-miss.
      ["129010157", 'МВР дирекция ДУССД ("социални дейности")'],
      ["129010698", "МВР ДКИС"],
      // Pensions have their own /pensions view; the `social` slot used to point AT
      // НОИ, exactly duplicating `pension`. Folding it back in restores that.
      ["121082521", "НОИ (its own /pensions view)"],
      // ИА „Военни клубове и военно-почивно дело", ex-„Социални дейности на МО" —
      // €29M, and its old name is what a name sweep matches.
      ["129008829", "МО ИА ВКВПД"],
    ];
    for (const [eik, who] of banned)
      assert.ok(
        !SOCIAL_SECTOR_EIKS.includes(eik),
        `${who} (${eik}) must not be in the social set`,
      );
  });

  test.skipIf(noDb)("АСП dominates the group's procurement", async () => {
    const [row] = await allRows<{ asp: number; total: number }>(
      `SELECT
         COALESCE(SUM(amount_eur) FILTER (WHERE awarder_eik = $2), 0) AS asp,
         COALESCE(SUM(amount_eur), 0)                                 AS total
       FROM contracts
       WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [SOCIAL_SECTOR_EIKS, ASP_EIK],
    );
    assert.ok(row.total > 200_000_000, `group total collapsed to ${row.total}`);
    const share = row.asp / row.total;
    // ~44% today. A band, because the corpus grows fortnightly — but АСП falling
    // out of the group, or swallowing it, both mean the set is wrong.
    assert.ok(
      share > 0.25 && share < 0.7,
      `АСП share ${(share * 100).toFixed(1)}% is outside the expected band`,
    );
  });
});

// ── the classifier ─────────────────────────────────────────────────────────

describe("social sector — the category labels say what the CPV means", () => {
  // CPV 79 is business services incl. security, printing and recruitment. Naming
  // it consultancy made „a quarter of the social agencies' procurement goes to
  // consultants" — arithmetically exact, false as a sentence.
  test("division 79 is not labelled consultancy", () => {
    const cat = categoryOfCpv("79713000"); // невъоръжена физическа охрана
    assert.equal(
      categoryOfCpv("79420000"),
      cat,
      "div 79 split across categories",
    );
    for (const lang of ["bg", "en"]) {
      const label = categoryLabel(cat, lang);
      assert.ok(
        !/консултант|consultan/i.test(label),
        `div 79 labelled "${label}" in ${lang}`,
      );
    }
  });

  // €59.0M of FEAD/ОПХ food parcels used to sit in „Офис, печат и материали".
  test("food (15) is material aid, not office supplies", () => {
    const food = categoryOfCpv("15891400");
    assert.notEqual(
      food,
      categoryOfCpv("30197630"),
      "food still with stationery",
    );
    for (const lang of ["bg", "en"]) {
      const label = categoryLabel(food, lang);
      assert.ok(
        !/офис|office/i.test(label),
        `food labelled "${label}" in ${lang}`,
      );
    }
  });

  // Telecom SERVICES (64) beside telecom EQUIPMENT (32). БТК is the group's #3
  // supplier and 71 of its 81 contracts are division 64, which used to fall into
  // the „Друго" sink — so one vendor's spend sat on two sides of the chart and led
  // the sink. €21.5M, and it had no gate at all.
  test("telecom services (64) sit with telecom equipment (32)", () => {
    assert.equal(categoryOfCpv("64200000"), categoryOfCpv("32250000"));
    // …and specifically NOT in the sink, which is where reverting would put it.
    assert.notEqual(categoryOfCpv("64200000"), categoryOfCpv(""));
  });

  test.skipIf(noDb)("that split is material, not cosmetic", async () => {
    const [row] = await allRows<{ food: number; total: number }>(
      `SELECT
         COALESCE(SUM(amount_eur) FILTER (
           WHERE left(replace(coalesce(cpv, ''), ' ', ''), 2) = '15'), 0) AS food,
         COALESCE(SUM(amount_eur), 0)                                     AS total
       FROM contracts
       WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [SOCIAL_SECTOR_EIKS],
    );
    const share = row.food / row.total;
    // ~18% today. If this ever drops near zero the split has stopped earning its
    // own category and the labels should be revisited — not silently kept.
    assert.ok(
      share > 0.08,
      `material aid is only ${(share * 100).toFixed(1)}% of the group`,
    );
  });
});

// ── the beneficiary side ───────────────────────────────────────────────────

describe("social sector — the leaderboard means what it says", () => {
  // Shares and classifications only. A rank or an absolute € would fail on every
  // fortnightly reload for no reason.
  test.skipIf(noDb)("no single contractor owns the sector", async () => {
    const [row] = await allRows<{ top: number; total: number }>(
      `WITH w AS (
         SELECT contractor_eik, SUM(amount_eur) AS eur
           FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1)
            AND contractor_eik IS NOT NULL AND contractor_eik <> ''
            AND contractor_eik <> awarder_eik
          GROUP BY contractor_eik)
       SELECT MAX(eur) AS top, SUM(eur) AS total FROM w`,
      [SOCIAL_SECTOR_EIKS],
    );
    const share = row.top / row.total;
    // 10.2% today (ФМФИБ). 0.25 rather than 0.5: the test is named "no single
    // contractor OWNS the sector" and at 49% it would still have passed, so the
    // looser ceiling did not gate the sentence it is named for. The headroom is
    // 2.5x the measured value, which a consortium-rollup regression (crediting a
    // group's FULL value to every member) clears immediately.
    assert.ok(
      share < 0.25,
      `top contractor holds ${(share * 100).toFixed(1)}% of the sector`,
    );
  });

  // The beneficiary twin of the anti-allowlist: it stops a later "clean up the
  // leaderboard" change from turning a state transfer back into an apparent
  // private vendor. Pinned by EIK, never by name or rank.
  test("the state fund manager is still classified as a public body", () => {
    assert.ok(
      SOCIAL_STATE_BODY_CONTRACTORS.includes("203740812"),
      "ФМФИБ dropped out of SOCIAL_STATE_BODY_CONTRACTORS",
    );
    // The list must never acquire a private regulated utility. ЗОП's utilities
    // regime makes these contracting authorities, so the naive
    // "contractor is also an awarder" probe returns all of them.
    for (const eik of ["130533432", "123526430", "130175000", "113012360", "116019472"]) // prettier-ignore
      assert.ok(
        !SOCIAL_STATE_BODY_CONTRACTORS.includes(eik),
        `${eik} is a PRIVATE company and must not be labelled „държавно"`,
      );
  });

  // A body cannot procure from itself; such a row is the buyer's EIK mis-keyed
  // into the supplier field. 061 excludes them from the supplier rollups, and the
  // social one names a private insurer — so unguarded it gets badged „в групата".
  // ⚠ Deliberately NOT scoped to the social EIKs. The social instance is a single
  // €35,790 row (АСП's Булстат mis-keyed onto a Булстрад motor policy, 0.011% of
  // the group), so a reload that corrects it would leave a group-scoped version
  // passing over an empty set for ever — vacuous, silently, and it is the gate the
  // 061 change most needs. Driving it from whatever self-deal rows the corpus
  // actually holds (29 today, €3.87M) keeps it self-scoping, and the guard makes
  // the vacuous state loud instead of green.
  test.skipIf(noDb)(
    "no awarder is ever listed as its own supplier",
    async () => {
      const arts = await allRows<{ eik: string; name: string }>(
        `SELECT DISTINCT awarder_eik AS eik, contractor_name AS name
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = contractor_eik
        LIMIT 25`,
      );
      assert.ok(
        arts.length > 0,
        "no self-deal rows left in the corpus — this gate no longer discriminates; " +
          "re-point it or retire it rather than leaving a green that checks nothing",
      );
      // ONE EIK per call, never the 25 as one set: 061's guard is per-ROW
      // (`contractor_eik <> awarder_eik`), and these awarders legitimately supply
      // one ANOTHER — measured, a combined set returns 7 such rows, every one of
      // them real. Asking "is X its own supplier" is the only form that means what
      // the test is named.
      const guilty: string[] = [];
      for (const a of arts) {
        const [m] = await allRows<{ hit: number }>(
          `SELECT count(*)::int AS hit
             FROM jsonb_array_elements(
                    awarder_group_model(ARRAY[$1], NULL, NULL)->'suppliers') s
            WHERE s->>'eik' = $1`,
          [a.eik],
        );
        if (m.hit > 0) guilty.push(`${a.eik} ("${a.name}")`);
      }
      assert.deepEqual(
        guilty,
        [],
        `listed as their own supplier: ${guilty.join(", ")}`,
      );
    },
  );

  // Every SOCIAL_ENTITIES member is a real awarder (asserted above), so the group
  // model's per-unit rollup must reconcile with a plain sum — the tile's units
  // list, its АСП share and its footnote total all read that rollup.
  test.skipIf(noDb)("the group model reconciles with the corpus", async () => {
    const [row] = await allRows<{ model: number; raw: number }>(
      `SELECT (awarder_group_model($1, NULL, NULL)->>'totalEur')::numeric AS model,
              COALESCE(ROUND(SUM(amount_eur)::numeric), 0)                AS raw
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [SOCIAL_SECTOR_EIKS],
    );
    assert.ok(
      Math.abs(Number(row.model) - Number(row.raw)) <= 1,
      `group model ${row.model} vs corpus ${row.raw}`,
    );
  });
});

// ── the entity list itself ─────────────────────────────────────────────────

describe("social sector — the allowlist is internally consistent", () => {
  test("no duplicate EIKs, and the lead is first", () => {
    const eiks = SOCIAL_ENTITIES.map((e) => e.eik);
    assert.equal(new Set(eiks).size, eiks.length, "duplicate EIK");
    assert.equal(eiks[0], SOCIAL_EIK);
  });
});
