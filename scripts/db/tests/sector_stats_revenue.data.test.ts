// Regression net for the REVENUE sector — the /governance/sectors tile and the
// /sector/revenue dashboard (NapPack) behind it. Audit 2026-08-19,
// docs/plans/revenue-sector-audit-v1.md.
//
//   npm run test:data
//
// Its own file, like the social / environment / regional nets, because what it
// reads — an AGENCY budget file rather than a ministries node, a single-EIK
// awarder set, and a КФП tax composition — is not what sector_stats.data.test.ts
// covers. Before this file, `revenue` appeared in no data test at all.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE FULLY DECOUPLED HERE, more so than in any
// sibling. The tile reads НАП's own годишен уточнен план from
// data/budget/agencies/nap.json, so a wrong EIK cannot move it by a cent — and the
// composition card the audit actually fixed reads a THIRD source (kfp.json) that
// neither of the other two touches. Three independent blocks, three sources.
//
// What each block guards:
//
//  · BASIS — `basis === 'budget'`, `note === 'adjusted'`, and an EXACT reconcile
//    against the НАП agency file on value, year AND `unavailable`, across every
//    scope. `note` is not decoration: it is what makes the caption say „уточнен
//    план" rather than implying a ЗДБРБ-приет figure like the first-level ПРБ
//    tiles, and НАП has no clean ЗДБРБ line to be приет from.
//  · GENERATOR — `AGENCY_BUDGET_FILE` must keep its `revenue` key. That map is
//    what makes this tile budget-basis at all: `scopeStats` seeds every
//    `SECTOR_EIKS` sector with a procurement value and THEN overwrites from
//    `budgetByYear`, so the budget write is what wins. Drop the key and the
//    overwrite stops happening — the tile falls back to whatever procurement
//    figure is left, which for НАП is ~€192M across the WHOLE corpus (two decades
//    against one year), i.e. the Култура €3k-vs-€234M failure in a new place.
//    (An earlier draft of this file guarded the opposite edit — a `revenue` key
//    ADDED to `SECTOR_EIKS` — which cannot flip anything, because the budget
//    loop runs after it and overwrites the entry.)
//  · EIK-SET — lockstep across the three copies, plus an ANTI-allowlist. The
//    copies all derive from one `NAP_EIK` constant so comparing them is close to
//    a tautology; the anti-allowlist is the block that does the work, and it is
//    aimed at a real near-miss: a `%НАП%` name sweep over this corpus returns
//    Напоителни системи (€212.7M), НАПОО, НЧ „Напредък“ and Направление
//    „Социални услуги“ before it returns anything of НАП's.
//  · COMPOSITION — over the REAL kfp.json: every leaf the card counts must sit
//    under „Данъчни приходи“ EXACTLY, never „Неданъчни приходи“. This is the gate
//    on the audit's F1, and it runs against live data rather than the synthetic
//    fixture in src/data/procurement/useNap.test.ts.
//  · PERIMETER — kfp.json is `constituentBudget: "state"`. The card's copy says so
//    in words; if the corpus ever becomes consolidated, that copy is wrong and
//    this fails rather than letting the page quietly widen its claim.
//  · OVERLAP — the Митници double-attribution the footnote discloses, asserted as
//    a live relationship between two corpora rather than as the numbers the audit
//    happened to measure.
//  · BENEFICIARY — the top contractor's SHARE, never a rank or an absolute €.
//    Both move on every fortnightly reload; a leaderboard reordering is the one
//    thing about it that is not a defect.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { NAP_EIK, TAX_REVENUE_GROUP, TAX_TYPES } from "@/lib/napReferenceData";
import { ministryYearSeriesEur } from "@/data/budget/ministrySeries";
import { stripComments } from "../../lib/strip_comments";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../");
/** Read a TRACKED input, failing loudly if it is gone.
 *
 *  ⚠️ Deliberately NOT a `skipIf(!exists(…))`, unlike the environment sibling.
 *  That skip is right there because `data/budget/ministries/` is GITIGNORED, so a
 *  fresh clone legitimately lacks it. Every input this file reads —
 *  `agencies/nap.json`, `kfp.json`, `revenue_breakdown/customs/2025.json` — is
 *  COMMITTED (`git ls-files` confirms), so "missing" is never a clone state here:
 *  it is a tracked file that moved or vanished, i.e. exactly the defect the gate
 *  exists for. Skipping would turn it into a green PASS and silently retire the
 *  30-scope headline reconcile. */
const readTracked = <T>(rel: string): T => {
  const abs = path.join(ROOT, rel);
  assert.ok(
    fs.existsSync(abs),
    `${rel} is TRACKED and missing — that is the defect, not a reason to skip`,
  );
  return JSON.parse(fs.readFileSync(abs, "utf-8")) as T;
};

/** Source text with own-line comments removed, for the static-analysis gates
 *  below. Prose that MENTIONS a pattern is not an occurrence of it — this file's
 *  own header quotes both `/sector/customs` and the retired heading, and a naive
 *  `includes()` reads each as the real thing (proven: deleting both `<Link>` arms
 *  left the disclosure gate green). Same primitive the i18n and entry-graph gates
 *  use, for the same reason. */
const source = (rel: string): string =>
  stripComments(fs.readFileSync(path.join(ROOT, rel), "utf-8"));

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

// `test.skipIf(bool)`, never `test(name, { skip }, fn)` — Vitest's `skip` option
// is typed `boolean`, so a `false | string` is a TS2769 and `npm run build` is
// `tsc -b && vite build`. Vitest does not typecheck, so the file would run green
// while the build is red. Every sibling here uses skipIf.
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
  note?: string;
  unavailable?: boolean;
};
type SectorStats = Record<string, Record<string, SectorStat>>;
// ⚠ READ VIA ministryYearSeriesEur, never `expenditure` directly — the generator
// switches to `expenditureLaw` the moment a file gains one, so a hand-retyped
// field read here would fail on entirely correct data the day НАП gets one.
type BudgetYear = {
  fiscalYear: number;
  expenditure?: { amountEur?: number | null } | null;
  expenditureLaw?: { amountEur?: number | null } | null;
};

const STATS = "data/procurement/derived/sector_stats.json";
const AGENCY = "data/budget/agencies/nap.json";
const KFP = "data/budget/kfp.json";

const agencyYears = (): BudgetYear[] =>
  readTracked<{ years: BudgetYear[] }>(AGENCY).years.filter(
    (y) => (ministryYearSeriesEur(y) ?? 0) > 0,
  );

// ── the hub headline ───────────────────────────────────────────────────────

describe("revenue sector — the hub headline is НАП's OWN agency budget", () => {
  // No PG skip: this reads committed artifacts, and a stale artifact is one of
  // the states the assertion exists to catch.
  test("basis is 'budget' with the 'adjusted' qualifier", () => {
    const s = readTracked<SectorStats>(STATS)["all"]?.revenue;
    assert.ok(s, "no `revenue` entry at scope `all`");
    assert.equal(s.basis, "budget");
    assert.equal(s.kind, "eur");
    // Without this the caption reads like a ЗДБРБ-приет figure. НАП is a
    // второстепенен разпоредител по бюджета на МФ and has no such line — the
    // number is its годишен уточнен план, and the tile must say so.
    assert.equal(s.note, "adjusted");
    // A FLOOR AGAINST A ZEROED SOURCE, not against a basis flip — €192M of
    // all-corpus procurement clears any floor an annual €259M budget could carry,
    // so no threshold can separate the two. The flip is caught exactly, by the
    // `basis` and `note` equalities above.
    assert.ok(
      s.value > 150_000_000,
      `headline ${s.value} looks like a zeroed or collapsed source`,
    );
  });

  // No skip guard: AGENCY is tracked, so `readTracked` asserts rather than skips.
  test("every scope reconciles EXACTLY to the НАП agency file", () => {
    const stats = readTracked<SectorStats>(STATS);
    const years = agencyYears();
    const latest = years.reduce((a, b) =>
      b.fiscalYear > a.fiscalYear ? b : a,
    );

    let checked = 0;
    for (const [scopeKey, sectors] of Object.entries(stats)) {
      const s = sectors.revenue;
      if (!s) continue;
      checked++;
      assert.equal(s.basis, "budget", `${scopeKey}: basis drifted`);
      assert.equal(s.note, "adjusted", `${scopeKey}: lost the note`);

      const want = /^y:(\d{4})$/.exec(scopeKey);
      const hit = want
        ? years.find((y) => y.fiscalYear === Number(want[1]))
        : undefined;
      const expected = hit ?? latest;

      assert.equal(
        s.value,
        ministryYearSeriesEur(expected),
        `${scopeKey}: does not match the agency file's FY${expected.fiscalYear}`,
      );
      assert.equal(s.year, expected.fiscalYear, `${scopeKey}: wrong year`);
      // As load-bearing as the number: without it a y:2011 scope shows a 2025
      // figure captioned 2011 instead of „няма данни за 2011“.
      assert.equal(
        !!s.unavailable,
        !!want && !hit,
        `${scopeKey}: \`unavailable\` disagrees with the file's coverage`,
      );
    }
    assert.ok(checked >= 25, `only ${checked} scopes carried a revenue entry`);
  });

  test("the generator still routes revenue through AGENCY_BUDGET_FILE", () => {
    // This map, not SECTOR_EIKS, is what makes the tile budget-basis: scopeStats
    // seeds procurement values and then OVERWRITES from budgetByYear, which is
    // built from AGENCY_BUDGET_FILE. Lose the key and the overwrite stops.
    // Comments stripped so the prose above cannot satisfy the match.
    const src = source("scripts/db/gen_procurement/sector_stats.ts");
    const block = /const AGENCY_BUDGET_FILE[\s\S]*?\n};/.exec(src);
    assert.ok(block, "could not locate AGENCY_BUDGET_FILE in the generator");
    assert.match(
      block[0],
      /["']?revenue["']?\s*:\s*["']nap["']/,
      "AGENCY_BUDGET_FILE no longer maps revenue → nap; the tile loses its budget basis",
    );
    // Non-vacuity: the same scan must NOT find a sector that is not in the map.
    assert.ok(
      !/["']?roads["']?\s*:/.test(block[0]),
      "the AGENCY_BUDGET_FILE scan is matching too broadly to prove anything",
    );
  });
});

// ── the EIK set ────────────────────────────────────────────────────────────

// Bodies a name sweep pulls in before it finds НАП, plus the neighbouring agency
// that has its OWN sector. Keyed by EIK, never by name.
const ANTI_ALLOWLIST: Record<string, string> = {
  "000695406": "Дирекция ЦЗФД към МФ — an МФ body, ~€898M, not НАП",
  "831160078": "Напоителни системи ЕАД — matches %НАП% as a substring, ~€213M",
  "130273618": "НАПОО — matches %НАП% as a substring",
  "000627597": "Агенция „Митници“ — its own sector, must not be folded in here",
};

describe("revenue sector — the EIK set", () => {
  test("the three copies are in lockstep", () => {
    const dash = SECTOR_DASHBOARDS.revenue;
    assert.ok(dash, "no SECTOR_DASHBOARDS.revenue");
    assert.deepEqual(dash.members.map((m) => m.eik).sort(), [NAP_EIK]);
    assert.equal(dash.leadEik, NAP_EIK);
    assert.equal(dash.browsePackId, "revenue");
    assert.deepEqual([...SECTOR_BROWSE_PACKS.revenue.eiks].sort(), [NAP_EIK]);
  });

  test("no copy hardcodes digits instead of importing NAP_EIK", () => {
    // The drift bug this whole family of tests exists for: a copy that spells the
    // number out stops tracking the reference data the day it changes.
    for (const rel of [
      "src/screens/sector/sectorDashboards.ts",
      "src/screens/components/procurement/sectorPacks.tsx",
    ]) {
      const src = source(rel);
      assert.ok(src.includes("NAP_EIK"), `${rel} does not import NAP_EIK`);
      // The DIGITS must not appear at all, in any quote style. Testing for
      // `"<eik>"` specifically was defeated by single quotes or a backtick; and
      // comments are stripped first, so an EIK cited in prose is not a hardcode.
      assert.ok(
        !src.includes(NAP_EIK),
        `${rel} hardcodes ${NAP_EIK} instead of using NAP_EIK`,
      );
    }
  });

  test.skipIf(noDb)(
    "НАП is a real awarder carrying real contracts",
    async () => {
      const [row] = await allRows<{ n: number; eur: number; name: string }>(
        `SELECT count(*)::int AS n,
              COALESCE(SUM(amount_eur), 0)::float8 AS eur,
              MIN(awarder_name) AS name
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = $1`,
        [NAP_EIK],
      );
      assert.ok(row.n > 500, `only ${row.n} contracts for НАП`);
      assert.ok(row.eur > 50_000_000, `only €${row.eur} for НАП`);
      assert.match(row.name, /приход/i, `unexpected awarder name: ${row.name}`);
    },
  );

  test.skipIf(noDb)("the anti-allowlist bodies are NOT members", async () => {
    const members = new Set(
      SECTOR_DASHBOARDS.revenue.members.map((m) => m.eik),
    );
    for (const [eik, why] of Object.entries(ANTI_ALLOWLIST))
      assert.ok(
        !members.has(eik),
        `${eik} must not be a revenue member — ${why}`,
      );

    // Non-vacuity: each must still be a real awarder carrying real money, or this
    // block asserts the absence of rows that do not exist anyway. Checked as a
    // FLOOR, not merely as presence — a body shrunk to a handful of euro is no
    // longer the kind of leak the allowlist protects against.
    const rows = await allRows<{ awarder_eik: string; eur: number }>(
      `SELECT awarder_eik, COALESCE(SUM(amount_eur), 0)::float8 AS eur
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY awarder_eik`,
      [Object.keys(ANTI_ALLOWLIST)],
    );
    assert.equal(
      rows.length,
      Object.keys(ANTI_ALLOWLIST).length,
      "an anti-allowlist EIK has no contracts — it can no longer prove anything",
    );
    for (const r of rows)
      assert.ok(
        r.eur > 20_000,
        `${r.awarder_eik} is down to €${r.eur} — too small to prove anything`,
      );
  });
});

// ── the composition card (audit F1 + F2) ───────────────────────────────────

/** The five non-tax КФП leaves that the unanchored regex used to admit. */
const NON_TAX_LEAVES = [
  /приходи и доходи\s+от собственост/i,
  /превишение на приходите/i,
  /приходи от такси/i,
  /глоби, санкции/i,
  /други неданъчни приходи/i,
];

type KfpLine = {
  labelBg: string;
  executed: { amountEur: number } | null;
  isSubtotal: boolean;
  groupLabelBg: string | null;
};
type KfpSnap = {
  fiscalYear: number;
  asOf: string;
  constituentBudget: string;
  sections: { series: string; lines: KfpLine[] }[];
};

const kfpSnapshots = (): KfpSnap[] =>
  readTracked<{ snapshots: KfpSnap[] }>(KFP).snapshots;

/** The leaves NapPack's `buildComposition` would count, for one snapshot. */
const taxLeaves = (s: KfpSnap): KfpLine[] =>
  (s.sections.find((x) => x.series === "revenue")?.lines ?? []).filter(
    (l) =>
      !l.isSubtotal &&
      l.executed != null &&
      TAX_REVENUE_GROUP.test(l.groupLabelBg ?? ""),
  );

describe("revenue sector — the КФП tax composition", () => {
  test("every counted leaf sits under „Данъчни приходи“ exactly", () => {
    let years = 0;
    for (const s of kfpSnapshots()) {
      const leaves = taxLeaves(s);
      if (leaves.length === 0) continue;
      years++;
      for (const l of leaves)
        assert.equal(
          (l.groupLabelBg ?? "").replace(/\s+/g, " ").trim(),
          "Данъчни приходи",
          `FY${s.fiscalYear}: „${l.labelBg}“ counted from group „${l.groupLabelBg}“`,
        );
    }
    assert.ok(years >= 5, `only ${years} snapshots carried a composition`);
  });

  test("no NON-tax line reaches the card, in any year", () => {
    // The audit's F1: „Неданъчни приходи“ CONTAINS „данъчни приходи“, so an
    // unanchored group regex folded fees, fines and the BNB surplus into a
    // segment labelled „Други данъци“ — 10.3%-15.8% of the headline, every year.
    for (const s of kfpSnapshots())
      for (const l of taxLeaves(s))
        for (const re of NON_TAX_LEAVES)
          assert.ok(
            !re.test(l.labelBg),
            `FY${s.fiscalYear}: non-tax line „${l.labelBg}“ is being counted as tax`,
          );
  });

  test("the residual stays a residual", () => {
    // Bound, not a literal — the point is that „Други данъци“ cannot silently
    // become a bucket of everything again. Pre-fix it was 13.7% of the 2025 card.
    // Derived from TAX_TYPES, never hand-copied — this file's whole subject is
    // that a rule restated in a second place drifts from the first.
    const KNOWN = (label: string) => TAX_TYPES.some((t) => t.match.test(label));
    let years = 0;
    for (const s of kfpSnapshots()) {
      const leaves = taxLeaves(s);
      if (leaves.length === 0) continue;
      years++;
      const total = leaves.reduce(
        (a, l) => a + (l.executed?.amountEur ?? 0),
        0,
      );
      const other = leaves
        .filter((l) => !KNOWN(l.labelBg))
        .reduce((a, l) => a + (l.executed?.amountEur ?? 0), 0);
      assert.ok(
        other / total < 0.05,
        `FY${s.fiscalYear}: residual is ${((100 * other) / total).toFixed(1)}% of the card`,
      );
    }
    assert.ok(years >= 5, `only ${years} snapshots carried a composition`);
  });

  test("the corpus is still STATE-budget scope, as the card's copy says", () => {
    // NapPack tells the reader „Държавният бюджет … Без местните данъци,
    // осигуровките и бюджетите на НОИ и НЗОК." That sentence is only true while
    // this holds; docs/budget_consolidated_kfp.md is the (unfinished) runbook for
    // ingesting the consolidated perimeter, and the day it lands the copy is wrong.
    for (const s of kfpSnapshots())
      assert.equal(
        s.constituentBudget,
        "state",
        `FY${s.fiscalYear} is ${s.constituentBudget} — NapPack's basis copy needs updating`,
      );
  });
});

// ── the Митници overlap the footnote discloses (audit F2) ──────────────────

describe("revenue sector — the Митници overlap is real and disclosed", () => {
  const CUSTOMS = (y: number) =>
    `data/budget/revenue_breakdown/customs/${y}.json`;

  test("Акцизи and Мита on the НАП card ARE the Customs Agency's own figures", () => {
    // The whole reason the card may not be headed „(НАП)“. Asserted as a
    // relationship between two independent corpora, with a tolerance for the
    // source rounding (Митници publishes BGN to 0.1m, so the EUR conversion
    // lands a few thousand euro off — it is NOT equal „to the euro“).
    const snap = kfpSnapshots()
      .filter((s) => s.fiscalYear === 2025)
      .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
    assert.ok(snap, "no FY2025 КФП snapshot");
    const leaf = (re: RegExp) =>
      taxLeaves(snap).find((l) => re.test(l.labelBg))?.executed?.amountEur ?? 0;

    const customs = readTracked<{ lines: { id: string; amountEur: number }[] }>(
      CUSTOMS(2025),
    );
    const cl = (id: string) =>
      customs.lines.find((l) => l.id === id)?.amountEur ?? 0;

    for (const [kfpRe, id] of [
      [/^акцизи/i, "excise_total"],
      [/мита и митнически/i, "customs_duties_total"],
    ] as const) {
      const a = leaf(kfpRe);
      const b = cl(id);
      assert.ok(a > 0 && b > 0, `${id}: missing on one side`);
      assert.ok(
        Math.abs(a - b) < 100_000,
        `${id}: КФП €${a} vs Митници €${b} — no longer the same series`,
      );
    }
  });

  test("the overlap is large enough that the card must disclose it", () => {
    // If this ever falls below a few percent the footnote is noise; today it is
    // ~33%, which is why the „(НАП)“ heading had to go. Bound, not a literal.
    const snap = kfpSnapshots()
      .filter((s) => s.fiscalYear === 2025)
      .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
    assert.ok(snap, "no FY2025 КФП snapshot");
    const total = taxLeaves(snap).reduce(
      (a, l) => a + (l.executed?.amountEur ?? 0),
      0,
    );
    const customs = readTracked<{ lines: { id: string; amountEur: number }[] }>(
      CUSTOMS(2025),
    );
    const overlap = [
      "excise_total",
      "import_vat_total",
      "customs_duties_total",
    ].reduce(
      (a, id) => a + (customs.lines.find((l) => l.id === id)?.amountEur ?? 0),
      0,
    );
    assert.ok(
      overlap / total > 0.2,
      `overlap is only ${((100 * overlap) / total).toFixed(1)}% — re-check the footnote`,
    );
    // …and the NapPack disclosure must still be there to say so.
    //
    // ⚠️ COMMENT-STRIPPED, and that is not tidiness. NapPack's header quotes
    // both `/sector/customs` and the retired heading in prose, so a raw
    // `includes()` reads each mention as the real thing — proven by mutation:
    // deleting BOTH `<Link>` arms left the raw form green, i.e. the one gate
    // holding the audit's F2 remedy passed with the remedy gone. The inverse
    // burns too: a comment quoting „Данъчни приходи (НАП)“ would turn the
    // negative arm red on correct code.
    const pack = source("src/screens/components/procurement/nap/NapPack.tsx");
    assert.ok(
      pack.includes("/sector/customs"),
      "NapPack no longer links the Митници disclosure to /sector/customs",
    );
    // BOTH languages: the BG heading was the one the audit changed, but an EN
    // reader saw the same false claim and only the BG half was gated at first.
    assert.ok(
      !/Данъчни приходи \(НАП\)/.test(pack),
      "the „(НАП)“ collection claim came back to the BG band-1 heading",
    );
    assert.ok(
      !/Tax revenue \(НАП\)/.test(pack),
      "the „(НАП)“ collection claim came back to the EN band-1 heading",
    );
    // The „2025 г..“ double period, fixed in the same step: the BG branch must
    // not re-acquire the abbreviation's own dot, since the sentence supplies one.
    assert.ok(
      !/\$\{comp\.year\} г\./.test(pack),
      "the `г.` template dot is back — the caption renders „2025 г..“",
    );
  });
});

// ── beneficiaries ──────────────────────────────────────────────────────────

describe("revenue sector — beneficiaries", () => {
  test.skipIf(noDb)("no single contractor dominates the corpus", async () => {
    // A SHARE ceiling, never a rank or an absolute €: a leaderboard reordering
    // is the one thing about it that is not a defect. Today the top row is
    // 11.3% (Информационно обслужване АД). A jump past 40% would most likely
    // mean a rollup change crediting a consortium's FULL value to every member,
    // which no total-based assertion can see.
    const rows = await allRows<{ eur: number; total: number }>(
      `WITH w AS (
           SELECT contractor_eik, SUM(amount_eur) AS eur
             FROM contracts
            WHERE tag = 'contract' AND awarder_eik = $1
              AND contractor_eik IS NOT NULL AND contractor_eik <> ''
            GROUP BY contractor_eik)
         SELECT eur::float8, (SELECT SUM(eur) FROM w)::float8 AS total
           FROM w ORDER BY eur DESC NULLS LAST LIMIT 1`,
      [NAP_EIK],
    );
    assert.ok(rows.length === 1, "no contractors for НАП");
    const share = rows[0].eur / rows[0].total;
    assert.ok(
      share < 0.4,
      `top contractor holds ${(100 * share).toFixed(1)}% of the sector`,
    );
  });

  test.skipIf(noDb)("no contract has НАП as its own contractor", async () => {
    // The register artifact where the buyer lands in the supplier field. Zero
    // today for this awarder; corpus-wide it is 29 rows.
    const [row] = await allRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = $1 AND contractor_eik = $1`,
      [NAP_EIK],
    );
    assert.equal(row.n, 0, `${row.n} self-dealing rows for НАП`);
  });
});
