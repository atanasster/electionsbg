// Regression net for the CUSTOMS sector — the /governance/sectors tile, the
// /sector/customs dashboard (CustomsPack) behind it, and the excise-warehouse
// register that pack ranks. Audit 2026-08-19,
// docs/plans/customs-sector-audit-v1.md.
//
//   npm run test:data
//
// Its own file, like the revenue / social / environment / regional siblings,
// because what it reads — an AGENCY budget file rather than a ministries node, a
// single-EIK awarder set, a Митническа хроника revenue composition and a
// procurement-enriched register — is not what sector_stats.data.test.ts covers.
// Before this file, `customs` appeared in no data test at all.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE FULLY DECOUPLED, as on revenue. The tile
// reads Агенция „Митници“'s own годишен уточнен план from
// data/budget/agencies/customs.json, so a wrong EIK cannot move it by a cent —
// and the register block reads a THIRD source neither of the others touches.
//
// What each block guards:
//
//  · BASIS — `basis === 'budget'`, `note === 'adjusted'`, and an EXACT reconcile
//    against the agency file on value, year AND `unavailable`, across every
//    scope. `note` is not decoration: it makes the caption say „уточнен план"
//    rather than implying a ЗДБРБ-приет figure like the first-level ПРБ tiles,
//    and Агенция „Митници“ — второстепенен разпоредител по бюджета на МФ — has
//    no ЗДБРБ line to be приет from.
//  · GENERATOR — `AGENCY_BUDGET_FILE` must keep its `customs` key. That map is
//    what makes this tile budget-basis: `scopeStats` seeds every SECTOR_EIKS
//    sector with a procurement value and THEN overwrites from `budgetByYear`,
//    so the budget write is what wins. Drop the key and the tile falls back to
//    whatever procurement figure is left — €262.0M across the WHOLE corpus
//    against one year of budget, i.e. the Култура €3k-vs-€234M failure again.
//  · EIK-SET — lockstep across the three copies, plus an ANTI-allowlist. The
//    copies all derive from one CUSTOMS_EIK constant so comparing them is close
//    to a tautology; the anti-allowlist is the block that does the work.
//  · REGISTER MONEY BASIS — the gate on the audit's F1, with a mutation check.
//    The enrichment query read `contracts_list` with NO tag or consortium
//    filter, so the register over-stated by €6,779,063 across 14 amendment rows
//    and credited 48 €0 consortium-member rows as won contracts. Both surfaces
//    that render it say „стойност на спечелените обществени поръчки".
//  · COMPOSITION — every Митническа хроника year's four lines must sum to its
//    own `total_collected`, so a future year losing a second line fails.
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
import { CUSTOMS_EIK, CUSTOMS_YEARS } from "@/lib/customsReferenceData";
import { ministryYearSeriesEur } from "@/data/budget/ministrySeries";
import { stripComments } from "../../lib/strip_comments";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../");

/** Read a TRACKED input, failing loudly if it is gone.
 *
 *  ⚠️ Deliberately NOT a `skipIf(!exists(…))`. Every input here —
 *  `agencies/customs.json`, `revenue_breakdown/customs/*.json`,
 *  `customs/excise_register.json` — is COMMITTED, so "missing" is never a clone
 *  state: it is a tracked file that moved or vanished, which is exactly the
 *  defect this gate exists for. Skipping would turn it into a green PASS. */
const readTracked = <T>(rel: string): T => {
  const abs = path.join(ROOT, rel);
  assert.ok(
    fs.existsSync(abs),
    `${rel} is TRACKED and missing — that is the defect, not a reason to skip`,
  );
  return JSON.parse(fs.readFileSync(abs, "utf-8")) as T;
};

/** Source text with own-line comments removed. Prose that MENTIONS a pattern is
 *  not an occurrence of it — this file's own header quotes `AGENCY_BUDGET_FILE`
 *  and `tag = 'contract'`, and a naive `includes()` reads each as the real
 *  thing. Same primitive the i18n and entry-graph gates use. */
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
// field read here would fail on entirely correct data the day АМ gets one.
type BudgetYear = {
  fiscalYear: number;
  expenditure?: { amountEur?: number | null } | null;
  expenditureLaw?: { amountEur?: number | null } | null;
};

const STATS = "data/procurement/derived/sector_stats.json";
const AGENCY = "data/budget/agencies/customs.json";
const REGISTER = "data/customs/excise_register.json";
const breakdown = (y: number) =>
  `data/budget/revenue_breakdown/customs/${y}.json`;

/** Bodies a roster-widening NAME SWEEP returns that must never become members.
 *
 *  ⚠ The trap is PER TOKEN, not one query: `%митниц%` is clean — it returns only
 *  000627597 itself, because the territorial units award under the agency's own
 *  EIK — so the real risk is a sweep on a ТМУ's PLACE token. Each entry names the
 *  sweep that actually returns it. No € figures here: this file's own beneficiary
 *  block explains why an absolute € goes stale, and the money floor in the test
 *  is where the size claim belongs. */
const ANTI_ALLOWLIST = [
  "101522447", // МБАЛ „Югозападна болница" ООД — %Югозападна%, vs ТМУ Митница Югозападна
  "000312587", // ПГ по селско стопанство „Дунавска земя" — %Дунавска%, vs ТД Дунавска
  "175685416", // Регионален център … Югоизточна Европа (ЮНЕСКО) — a bare %юго% only
];

/** The agency file's publishable years. The `> 0` restates `budgetSeries`'s own
 *  truthiness drop (sector_stats.ts) rather than importing it — the two agree on
 *  every realistic value and diverge only on a negative figure, which no budget
 *  file carries. Deliberate, and noted because a rule restated in a second place
 *  is exactly what this file's siblings exist to catch. */
const agencyYears = (): BudgetYear[] =>
  readTracked<{ years: BudgetYear[] }>(AGENCY).years.filter(
    (y) => (ministryYearSeriesEur(y) ?? 0) > 0,
  );

// ── the hub headline ───────────────────────────────────────────────────────

describe("customs sector — the hub headline is АМ's OWN agency budget", () => {
  test("basis is 'budget' with the 'adjusted' qualifier", () => {
    const s = readTracked<SectorStats>(STATS)["all"]?.customs;
    assert.ok(s, "no `customs` entry at scope `all`");
    assert.equal(s.basis, "budget");
    assert.equal(s.kind, "eur");
    assert.equal(s.note, "adjusted");
    // A FLOOR AGAINST A ZEROED SOURCE, not against a basis flip — €262.0M of
    // all-corpus procurement clears any floor an annual €183M budget could
    // carry, so no threshold separates the two. The flip is caught exactly, by
    // the `basis` and `note` equalities above.
    assert.ok(
      s.value > 60_000_000,
      `headline ${s.value} looks like a zeroed or collapsed source`,
    );
  });

  test("every scope reconciles EXACTLY to the АМ agency file", () => {
    const stats = readTracked<SectorStats>(STATS);
    const years = agencyYears();
    // Before the reduce: with no initial value an empty array throws a TypeError
    // that points at this test rather than at the zeroed agency file.
    assert.ok(years.length, `${AGENCY} carries no year with a positive figure`);
    const latest = years.reduce((a, b) =>
      b.fiscalYear > a.fiscalYear ? b : a,
    );

    let checked = 0;
    for (const [scopeKey, sectors] of Object.entries(stats)) {
      const s = sectors.customs;
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
      // figure captioned 2011 instead of „няма данни за 2011".
      assert.equal(
        !!s.unavailable,
        !!want && !hit,
        `${scopeKey}: \`unavailable\` disagrees with the file's coverage`,
      );
    }
    // EXACT, not a floor: a budget-basis sector is written for EVERY scope
    // unconditionally (unlike a procurement one, which can legitimately have no
    // rows in a window), so a missing entry is always a defect. The `>= 25` below
    // is the separate guard, against the artifact itself collapsing.
    assert.equal(
      checked,
      Object.keys(stats).length,
      "a scope lost its customs entry",
    );
    assert.ok(checked >= 25, `only ${checked} scopes carried a customs entry`);
  });

  test("the generator still routes customs through AGENCY_BUDGET_FILE", () => {
    const src = source("scripts/db/gen_procurement/sector_stats.ts");
    const block = /const AGENCY_BUDGET_FILE[\s\S]*?\n};/.exec(src);
    assert.ok(block, "could not locate AGENCY_BUDGET_FILE in the generator");
    assert.match(
      block[0],
      /["']?customs["']?\s*:\s*["']customs["']/,
      "AGENCY_BUDGET_FILE no longer maps customs → customs; the tile loses its budget basis",
    );
    // Non-vacuity: the same scan must NOT find a sector that is not in the map.
    assert.ok(
      !/["']?roads["']?\s*:/.test(block[0]),
      "the AGENCY_BUDGET_FILE scan is matching too broadly to prove anything",
    );
  });

  test("customs is NOT in SECTOR_EIKS — the basis is budget, not procurement", () => {
    const src = source("scripts/db/gen_procurement/sector_stats.ts");
    const block = /const SECTOR_EIKS[\s\S]*?\n};/.exec(src);
    assert.ok(block, "could not locate SECTOR_EIKS in the generator");
    // Non-vacuity first: the block must really hold the procurement sectors.
    assert.match(block[0], /roads:/, "the SECTOR_EIKS scan found nothing real");
    assert.ok(
      !/\bcustoms\s*:/.test(block[0]),
      "customs joined SECTOR_EIKS — harmless today (the budget loop overwrites it) but it means the basis is being reconsidered",
    );
  });
});

// ── the EIK set ────────────────────────────────────────────────────────────

describe("customs sector — the awarder set", () => {
  test("all three copies are the same single EIK", () => {
    const dash = SECTOR_DASHBOARDS.customs;
    assert.ok(dash, "no `customs` SECTOR_DASHBOARDS entry");
    assert.deepEqual(
      dash.members.map((m) => m.eik),
      [CUSTOMS_EIK],
    );
    assert.equal(dash.leadEik, CUSTOMS_EIK);
    assert.deepEqual(
      [...(SECTOR_BROWSE_PACKS.customs?.eiks ?? [])],
      [CUSTOMS_EIK],
    );
  });

  test.skipIf(noDb)(
    "CUSTOMS_EIK is a real awarder, and the ТМУ award under it",
    async () => {
      const [row] = await allRows<{ n: number; eur: number; names: number }>(
        `select count(*)::int n,
                coalesce(sum(amount_eur),0)::float8 eur,
                count(distinct awarder_name)::int names
           from contracts
          where tag = 'contract' and awarder_eik = $1`,
        [CUSTOMS_EIK],
      );
      assert.ok(row.n > 500, `only ${row.n} contracts under CUSTOMS_EIK`);
      assert.ok(row.eur > 100_000_000, `only €${row.eur} under CUSTOMS_EIK`);
      // The territorial units (ТМУ Митница Югозападна, ТД Северна морска) award
      // under the agency's own EIK rather than their own, which is why a
      // single-member roster is complete. More than one awarder_name spelling on
      // one EIK is the shape that proves it.
      assert.ok(row.names > 1, "expected several awarder_name spellings");
    },
  );

  test("no copy hardcodes digits instead of importing CUSTOMS_EIK", () => {
    // The premise the lockstep test above rests on, and nothing else establishes
    // it: a copy that spells the number out stops tracking the reference data the
    // day it changes, and the lockstep comparison then passes on two stale
    // literals that happen to agree.
    for (const rel of [
      "src/screens/sector/sectorDashboards.ts",
      "src/screens/components/procurement/sectorPacks.tsx",
    ]) {
      const src = source(rel);
      assert.ok(
        src.includes("CUSTOMS_EIK"),
        `${rel} does not import CUSTOMS_EIK`,
      );
      // The DIGITS must not appear at all, in any quote style — testing for
      // `"<eik>"` was defeated by single quotes and by a backtick. Comments are
      // stripped first, so an EIK cited in prose is not a hardcode.
      assert.ok(
        !src.includes(CUSTOMS_EIK),
        `${rel} hardcodes ${CUSTOMS_EIK} instead of using CUSTOMS_EIK`,
      );
    }
  });

  test("the anti-allowlist: no substring near-miss is a member", () => {
    // ⚠ NOT DB-gated, unlike its non-vacuity half below. This is the block that
    // does the work — the lockstep test above is close to a tautology, since all
    // three copies import one constant — and it is a pure in-memory check over an
    // imported roster. Behind skipIf(noDb) it would not run on a fresh clone, in
    // CI without the docker Postgres, or before `db:pg:up`, leaving the tautology
    // as the only EIK-set assertion that executes.
    const members = new Set(
      SECTOR_DASHBOARDS.customs.members.map((m) => m.eik),
    );
    for (const eik of ANTI_ALLOWLIST)
      assert.ok(!members.has(eik), `${eik} must not be a customs member`);
  });

  test.skipIf(noDb)(
    "…and each is a real awarder, so that block is not decoration",
    async () => {
      // On the site's money basis, like everything else this file asserts: a body
      // left holding only `contractAmendment` rows is not an awarder a roster
      // sweep would plausibly pull in.
      const rows = await allRows<{ awarder_eik: string; eur: number }>(
        `select awarder_eik, coalesce(sum(amount_eur), 0)::float8 eur
           from contracts
          where tag = 'contract' and awarder_eik = any($1)
          group by awarder_eik`,
        [ANTI_ALLOWLIST],
      );
      assert.equal(
        rows.length,
        ANTI_ALLOWLIST.length,
        "an anti-allowlist entry is not in the corpus; re-pick it or this test is decoration",
      );
      // …and big enough to still be the kind of leak the list protects against.
      // The corpus is already at that boundary: 000312587 is ONE contract at
      // €42,001, so without a floor a single re-key silently retires two thirds
      // of the list while `rows.length` stays right.
      for (const r of rows)
        assert.ok(
          r.eur > 20_000,
          `${r.awarder_eik} is down to €${r.eur} — too small to prove anything`,
        );
    },
  );
});

// ── the excise register's money basis (audit F1) ───────────────────────────

type ExciseRegister = {
  operators: { eik: string; procurementEur: number; contractCount: number }[];
};

describe("customs sector — the excise register is on the site's money basis", () => {
  // Not DB-gated: the file is committed, and `readTracked` exists precisely to
  // fail loudly when a tracked input vanishes. Behind skipIf(noDb) a truncated or
  // missing register would go unopened on every DB-less checkout.
  test("the register snapshot is not truncated", () => {
    const reg = readTracked<ExciseRegister>(REGISTER);
    assert.ok(
      reg.operators.length > 400,
      `register holds ${reg.operators.length} operators — looks truncated`,
    );
  });

  test.skipIf(noDb)(
    "stored figures equal the tag='contract', carriers-only aggregate",
    async () => {
      const reg = readTracked<ExciseRegister>(REGISTER);
      const eiks = reg.operators.map((o) => o.eik);

      const rows = await allRows<{ eik: string; eur: number; cnt: number }>(
        `select contractor_eik eik,
                round(coalesce(sum(amount_eur), 0)::numeric, 2)::float8 eur,
                count(*)::int cnt
           from contracts
          where contractor_eik = any($1)
            and tag = 'contract'
            and consortium_role is distinct from 'member'
          group by contractor_eik`,
        [eiks],
      );
      const want = new Map(rows.map((r) => [r.eik, r]));

      // The corpus grows fortnightly while the register is a committed snapshot,
      // so a per-operator equality would be red on every reload. What must hold
      // is that the stored numbers were produced by THIS basis — assert on the
      // operators whose figures are unchanged since the snapshot, and require
      // that most of them still are.
      let agree = 0;
      let scored = 0;
      const wrong: string[] = [];
      for (const o of reg.operators) {
        const w = want.get(o.eik);
        // ⚠ The denominator below is the operators that HAVE contracts, not the
        // whole register: 494 of 565 excise warehouse keepers have never won a
        // public contract, so `reg.operators.length` floors the ratio at ~12%
        // and the assertion can never fire.
        if (!w) {
          // …and an operator with no live rows must be stored at zero. A stored
          // figure with nothing behind it is the clearest form of the over-count
          // this gate exists for.
          if (o.procurementEur !== 0 || o.contractCount !== 0)
            wrong.push(
              `${o.eik}: stored ${o.procurementEur}/${o.contractCount} against ZERO live rows`,
            );
          continue;
        }
        scored++;
        if (
          Math.abs(w.eur - o.procurementEur) < 0.01 &&
          w.cnt === o.contractCount
        )
          agree++;
        else if (w.eur < o.procurementEur - 0.01 || w.cnt < o.contractCount)
          // The corpus only ever GROWS between reloads, so a stored figure ABOVE
          // the live one cannot be staleness — it is an over-count, which is
          // exactly what the unfiltered basis produced.
          wrong.push(
            `${o.eik}: stored ${o.procurementEur}/${o.contractCount} exceeds live ${w.eur}/${w.cnt}`,
          );
      }
      assert.deepEqual(
        wrong,
        [],
        "stored register figures exceed the live basis",
      );
      assert.ok(scored > 50, `only ${scored} operators have contracts at all`);
      assert.ok(
        agree > scored * 0.5,
        `only ${agree}/${scored} contract-holding operators reconcile; the register or the basis has moved`,
      );
    },
  );

  test.skipIf(noDb)(
    "MUTATION: dropping either filter changes the answer",
    async () => {
      // Without this, the assertion above is satisfied by an implementation that
      // never filtered at all — the two arms fail differently and the second is
      // invisible to any € check, so each needs its own proof.
      const reg = readTracked<ExciseRegister>(REGISTER);
      const eiks = reg.operators.map((o) => o.eik);
      const agg = async (extra: string) =>
        (
          await allRows<{ eur: number; cnt: number }>(
            `select coalesce(sum(amount_eur),0)::float8 eur, count(*)::int cnt
               from contracts
              where contractor_eik = any($1) ${extra}`,
            [eiks],
          )
        )[0];

      const correct = await agg(
        "and tag = 'contract' and consortium_role is distinct from 'member'",
      );
      const noTag = await agg("and consortium_role is distinct from 'member'");
      const noMember = await agg("and tag = 'contract'");

      assert.ok(
        noTag.eur > correct.eur,
        "dropping the tag filter did not change the money — the mutation check is inert",
      );
      // Not assert.equal: the two aggregates sum the same money in a different
      // ROW ORDER and float addition is not associative — the live pair differs
      // in the 11th significant digit. A relative tolerance is the claim actually
      // being made („members contribute no money"), not a bit-for-bit one.
      assert.ok(
        Math.abs(noMember.eur - correct.eur) / correct.eur < 1e-9,
        `consortium members carry €${(noMember.eur - correct.eur).toFixed(2)}; they are supposed to carry €0, so the whole rollup basis has changed`,
      );
      assert.ok(
        noMember.cnt > correct.cnt,
        "dropping the consortium filter did not change the COUNT — the €0 rows make this invisible to any money check, which is why it needs its own arm",
      );
    },
  );

  test("the ingest still spells both filters", () => {
    const src = source("scripts/customs/excise_register.ts");
    assert.match(
      src,
      /tag\s*=\s*'contract'/,
      "the excise-register query lost its tag filter",
    );
    assert.match(
      src,
      /consortium_role is distinct from 'member'/,
      "the excise-register query lost its consortium filter",
    );
    // `contracts_list` narrows NOTHING, which is how the defect happened.
    assert.ok(
      !/from contracts_list/.test(src),
      "the enrichment aggregate is back on contracts_list",
    );
  });
});

// ── the Митническа хроника composition ─────────────────────────────────────

type BreakdownFile = {
  fiscalYear: number;
  lines: { id: string; amountEur: number | null }[];
};

describe("customs sector — the revenue composition reconciles", () => {
  test("each year's lines sum to its own total_collected", () => {
    const PARTS = [
      "excise_total",
      "import_vat_total",
      "customs_duties_total",
      "fines_total",
    ];
    let checked = 0;
    for (const y of CUSTOMS_YEARS) {
      const f = readTracked<BreakdownFile>(breakdown(y));
      // The one consumer of the declared `fiscalYear`, and it earns its place: the
      // path is derived from `y` and everything below reconciles the file against
      // ITSELF, so 2024's numbers mis-filed as 2025.json would pass perfectly.
      assert.equal(
        f.fiscalYear,
        y,
        `${breakdown(y)} carries FY${f.fiscalYear}`,
      );
      const at = (id: string) =>
        f.lines.find((l) => l.id === id)?.amountEur ?? 0;
      const total = at("total_collected");
      assert.ok(total > 1_000_000_000, `${y}: total_collected looks wrong`);

      // The band expresses the RULE rather than a tuned number. A Митническа
      // хроника may omit at most one of the four lines — 2025 publishes no глоби,
      // which is €10.7m or 0.145% — and everything else is source rounding
      // (2022/2023 are ~€51k, 2024 is exact). Tuning a single 0.2% literal to fit
      // 2025 would have left only 0.055pp of headroom, admitted €14.9m of silent
      // discrepancy in the other three years, and failed on CORRECT data the year
      // fines happen to be larger.
      const absent = PARTS.filter(
        (id) => f.lines.find((l) => l.id === id)?.amountEur == null,
      );
      assert.ok(
        absent.length <= 1,
        `${y}: ${absent.length} composition lines absent (${absent.join(", ")}) — a second missing line is not rounding`,
      );
      const sum = PARTS.reduce((a, id) => a + at(id), 0);
      const gapPct = Math.abs(total - sum) / total;
      const band = absent.length ? 0.002 : 0.0001;
      assert.ok(
        gapPct < band,
        `${y}: Σ(parts) ${sum} is ${(gapPct * 100).toFixed(3)}% away from total_collected ${total} (band ${(band * 100).toFixed(2)}%, ${absent.length} line(s) absent)`,
      );
      checked++;
    }
    // CUSTOMS_YEARS is UI reference data — it is what the pack's picker offers —
    // so a maintainer will narrow it for UI reasons, and this file is its ONLY
    // guard. Without a floor, narrowing it to [2025] silently reduces this gate
    // to one year and emptying it passes having asserted nothing.
    assert.ok(
      checked >= 4,
      `only ${checked} Митническа хроника years reconciled — has CUSTOMS_YEARS been narrowed?`,
    );
  });
});

// ── beneficiaries ──────────────────────────────────────────────────────────

describe("customs sector — the beneficiary shape", () => {
  test.skipIf(noDb)("no single contractor dominates the corpus", async () => {
    // A SHARE, never a rank or an absolute € — both move on every reload, and a
    // leaderboard reordering is the one thing about it that is not a defect.
    // What this catches is a rollup change that starts crediting a consortium's
    // full value to every member: the top share jumps, the total does not.
    const [row] = await allRows<{ pct: number }>(
      `with w as (
         select contractor_eik, sum(amount_eur) s
           from contracts
          where tag = 'contract' and awarder_eik = $1 and amount_eur is not null
          group by contractor_eik)
       select (100.0 * max(s) / nullif(sum(s), 0))::float8 pct from w`,
      [CUSTOMS_EIK],
    );
    assert.ok(
      row.pct > 1,
      `top share ${row.pct}% — the aggregate found nothing`,
    );
    assert.ok(
      row.pct < 45,
      `top contractor holds ${row.pct.toFixed(1)}% of the corpus — was 17.5% at the audit`,
    );
  });

  test.skipIf(noDb)(
    "consortium members carry no money of their own",
    async () => {
      // The carrier holds the whole value and each member €0 (087). If that ever
      // inverts, every consortium contract is counted once per member.
      const [row] = await allRows<{ members: number; nonzero: number }>(
        `select count(*)::int members,
              count(*) filter (where coalesce(amount_eur,0) <> 0)::int nonzero
         from contracts
        where tag = 'contract' and awarder_eik = $1
          and consortium_role = 'member'`,
        [CUSTOMS_EIK],
      );
      assert.ok(
        row.members > 0,
        "no consortium member rows — check the fixture",
      );
      assert.equal(row.nonzero, 0, "a consortium member row carries money");
    },
  );
});
