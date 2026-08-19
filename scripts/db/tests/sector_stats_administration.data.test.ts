// Regression net for the ADMINISTRATION sector — the /governance/sectors tile and
// the bespoke /sector/administration screen behind it. Audit 2026-08-19,
// docs/plans/sector-administration-audit-v1.md.
//
//   npm run test:data
//
// Its own file, like the social / environment / regional nets, because nothing it
// reads (a headcount series, a four-body e-gov awarder group, a state-owned
// system integrator) is covered by sector_stats.data.test.ts.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE FULLY DECOUPLED, and more so here than in any
// sibling. This is the ONLY sector whose headline is a `headcount`: it counts
// people in the whole state administration, read from the annual Доклад, while the
// EIK-set buys e-government software. A wrong EIK cannot move the tile by one
// position, and a wrong headcount cannot move the group by a cent. One assertion
// could never gate both — which is exactly how ЕСМИС stayed missing from the group
// for as long as it did, with every figure on the page reconciling.
//
// What each block guards:
//
//  · BASIS — `basis === 'headcount'`, `kind === 'count'`, reconciled EXACTLY
//    against personnel.json on value, year AND `unavailable`, across all 30
//    scopes. A band on one scope would miss a wrong year or a lost flag.
//  · EIK-SET — lockstep across the copies, every member a real awarder, ЕСМИС
//    present with a € floor, and a group-total band. Comparing the copies is close
//    to a tautology now that they all derive from ADMIN_ENTITIES, so the €-backed
//    arms are the ones doing work.
//  · BENEFICIARY — that „Информационно обслужване" АД is still curated as a public
//    body AND is still reached by the group. That pair is the anti-allowlist twin:
//    either half alone can pass while the page is wrong.
//  · BASIS AGREEMENT — Σ(per-contractor) == Σ(per-awarder) for one window. Both
//    halves are individually correct in every failure mode this catches, so no
//    other gate here can see it.
//
// NOT here: any contractor's RANK or absolute €, and no assertion that ИО is #1.
// A leaderboard reordering is the one thing about it that is not a defect.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  ADMIN_SECTOR_EIKS,
  ADMIN_GROUP_EIK,
  ADMIN_STATE_BODY_CONTRACTORS,
  ESMIS_EIK,
} from "@/lib/administrationReferenceData";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const readJson = <T>(rel: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")) as T;

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
// `tsc -b && vite build`: the file would run green while the build is red.
const noDb = !(await reachable());

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
type Personnel = {
  national?: Record<string, { positions?: { filled?: number | null } }>;
};

const STATS = "data/procurement/derived/sector_stats.json";
const PERSONNEL = "data/budget/personnel.json";

/** The generator's own series: years whose `filled` is present and non-zero.
 *  2017 publishes `filled: null` and is legitimately absent. */
const filledByYear = (): Record<number, number> => {
  const out: Record<number, number> = {};
  const p = readJson<Personnel>(PERSONNEL);
  for (const [y, rec] of Object.entries(p.national ?? {})) {
    const f = rec.positions?.filled;
    if (f) out[Number(y)] = f;
  }
  return out;
};

const latestYearOf = (byYear: Record<number, number>): number =>
  Math.max(...Object.keys(byYear).map(Number));

const eikList = (eiks: readonly string[]) =>
  eiks.map((e) => `'${e}'`).join(",");

// ── the hub headline ───────────────────────────────────────────────────────

describe("administration — the hub headline is a HEADCOUNT", () => {
  // No PG skip: these read committed artifacts, and a stale artifact is one of
  // the states the assertions exist to catch.
  test("basis is 'headcount' — the one non-money tile on the hub", () => {
    const s = readJson<SectorStats>(STATS)["all"]?.administration;
    assert.ok(s, "no `administration` entry at scope `all`");
    assert.equal(s.basis, "headcount");
    assert.equal(s.kind, "count");
  });

  test("every scope reconciles EXACTLY to personnel.json", () => {
    const stats = readJson<SectorStats>(STATS);
    const byYear = filledByYear();
    const latest = latestYearOf(byYear);
    assert.ok(Object.keys(byYear).length >= 5, "personnel series too short");

    let checkedYear = 0;
    let checkedFallback = 0;
    for (const [scope, sectors] of Object.entries(stats)) {
      const s = sectors.administration;
      assert.ok(s, `no administration entry at scope ${scope}`);
      assert.equal(s.basis, "headcount", `${scope}: basis`);
      // `kind` decides FORMATTING, not selection — useSectorStats renders
      // `eur` as money, so a wrong kind publishes 133,275 as €133,275 on every
      // scope with `basis` still correct and every other assertion green.
      assert.equal(s.kind, "count", `${scope}: kind`);

      const m = /^y:(\d{4})$/.exec(scope);
      const asked = m ? Number(m[1]) : null;
      const hit = asked != null && byYear[asked] != null;
      const resolved = hit ? asked! : latest;

      // value, year AND the flag — a band on one scope would miss a wrong year
      // or a silently-dropped `unavailable`.
      assert.equal(s.value, byYear[resolved], `${scope}: value`);
      assert.equal(s.year, resolved, `${scope}: year`);
      if (hit || asked == null) {
        assert.ok(!s.unavailable, `${scope}: must not be flagged unavailable`);
        checkedYear++;
      } else {
        assert.equal(s.unavailable, true, `${scope}: must be flagged`);
        checkedFallback++;
      }
    }
    // Non-vacuity: both arms must actually be exercised, or the loop is a no-op
    // dressed as a sweep.
    assert.ok(checkedYear > 0, "no in-range scope checked");
    assert.ok(checkedFallback > 0, "no fallback scope checked");
    // …and a FLOOR on the sweep itself. Without it an artifact that collapsed
    // to two scopes passes every assertion above, because the loop only ever
    // examines what it is given.
    assert.ok(
      checkedYear + checkedFallback >= 25,
      `only ${checkedYear + checkedFallback} scopes in the artifact — expected 30`,
    );
  });

  test("a year the Доклад lacks falls back and SAYS so", () => {
    const stats = readJson<SectorStats>(STATS);
    const byYear = filledByYear();
    const missing = Object.keys(stats)
      .map((k) => /^y:(\d{4})$/.exec(k)?.[1])
      .filter((y): y is string => !!y && byYear[Number(y)] == null);
    assert.ok(
      missing.length > 0,
      "no out-of-range year scope — the fallback path is untested",
    );
    for (const y of missing) {
      const s = stats[`y:${y}`].administration;
      assert.equal(s.unavailable, true, `y:${y}`);
      assert.equal(s.year, latestYearOf(byYear), `y:${y} resolved year`);
    }
  });
});

// ── the e-gov awarder group ────────────────────────────────────────────────

describe("administration — the e-gov EIK-set", () => {
  // Only the CROSS-MODULE copies live here. The within-module invariants
  // (ADMIN_SECTOR_EIKS derived from ADMIN_ENTITIES, lead first, EIK shape) are
  // owned by src/lib/administrationReferenceData.test.ts, which runs in the fast
  // unit suite and needs no database — duplicating them here buys nothing and
  // makes the two drift.
  test("the browse pack and the dashboard config track the reference data", () => {
    assert.deepEqual(
      new Set(SECTOR_BROWSE_PACKS.administration.eiks),
      new Set(ADMIN_SECTOR_EIKS),
      "?sector=administration would filter a different set from the page",
    );
    // The dashboard config is a deliberate single-member collapse (routes.tsx
    // intercepts this slug with the bespoke screen), so it is asserted as such
    // rather than as a set — but its lead may not drift to another EIK.
    assert.equal(SECTOR_DASHBOARDS.administration.leadEik, ADMIN_GROUP_EIK);
  });

  test.skipIf(noDb)(
    "every member is a real awarder in the corpus",
    async () => {
      const rows = await allRows<{ awarder_eik: string; n: number }>(
        `SELECT awarder_eik, count(*)::int AS n FROM contracts
        WHERE tag = 'contract' AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})
        GROUP BY 1`,
      );
      const seen = new Map(rows.map((r) => [r.awarder_eik, r.n]));
      for (const eik of ADMIN_SECTOR_EIKS)
        assert.ok((seen.get(eik) ?? 0) > 0, `${eik} awards nothing`);
    },
  );

  // ЕСМИС was missing until 2026-08-19 and nothing reported it — the headline is
  // headcount so it could not move, and every other figure reconciled. The only
  // symptom was the spend chart starting at 2017.
  test.skipIf(noDb)(
    "the ЕСМИС predecessor is in and carries real money",
    async () => {
      assert.ok(ADMIN_SECTOR_EIKS.includes(ESMIS_EIK));
      const [r] = await allRows<{ eur: number; first: string }>(
        `SELECT round(sum(amount_eur))::float8 AS eur, min(date) AS first
         FROM contracts WHERE tag = 'contract' AND awarder_eik = '${ESMIS_EIK}'`,
      );
      assert.ok(r.eur > 15_000_000, `ЕСМИС at €${r.eur} — floor is €15M`);
      assert.ok(
        r.first < "2018-01-01",
        `ЕСМИС's first contract is ${r.first} — it exists to extend the history back`,
      );
    },
  );

  // ⚠ THE BAND CANNOT CATCH A DROPPED MEMBER, and pretending otherwise is how a
  // gate goes quietly vacuous. Measured 2026-08-19: dropping ЕСМИС leaves
  // €316.5M and dropping ДАЕУ €307.1M — both inside any floor loose enough to
  // survive corpus growth. Its real job is the OTHER direction: a wrong EIK
  // leaking in (the МВР-into-defense shape, which is hundreds of millions) and a
  // catastrophic collapse. A dropped member is caught by the per-member arm
  // below, by € rather than by presence.
  test.skipIf(noDb)("the group total stays in band", async () => {
    const [r] = await allRows<{ eur: number; n: number }>(
      `SELECT round(sum(amount_eur))::float8 AS eur, count(*)::int AS n
         FROM contracts WHERE tag = 'contract'
          AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})`,
    );
    assert.ok(
      r.eur > 300_000_000 && r.eur < 600_000_000,
      `group total €${r.eur} outside the €300M–€600M band`,
    );
    assert.ok(r.n > 380 && r.n < 900, `${r.n} contracts outside band`);
  });

  // The arm that DOES catch a drop. Each member's floor is well under its own
  // 2026-08-19 total (€20.2M / €29.7M / €120.6M / €166.2M) but far above zero,
  // and the two legacy bodies are closed series whose € cannot grow — so this
  // stays meaningful as the corpus does.
  test.skipIf(noDb)("every member still contributes real money", async () => {
    const rows = await allRows<{ eik: string; eur: number }>(
      `SELECT awarder_eik AS eik, round(sum(amount_eur))::float8 AS eur
         FROM contracts WHERE tag = 'contract'
          AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})
        GROUP BY 1`,
    );
    const byEik = new Map(rows.map((r) => [r.eik, r.eur]));
    assert.equal(
      byEik.size,
      ADMIN_SECTOR_EIKS.length,
      `only ${byEik.size} of ${ADMIN_SECTOR_EIKS.length} members award anything`,
    );
    for (const eik of ADMIN_SECTOR_EIKS)
      assert.ok(
        (byEik.get(eik) ?? 0) > 10_000_000,
        `member ${eik} contributes €${byEik.get(eik) ?? 0} — floor is €10M`,
      );
  });
});

// ── who the money goes to ──────────────────────────────────────────────────

describe("administration — the beneficiary side", () => {
  const IO_EIK = "831641791"; // „Информационно обслужване" АД

  // The anti-allowlist twin, and BOTH halves are needed. Curated-but-unreached
  // means the label is dead config; reached-but-uncurated means the sector's
  // biggest contractor renders as a private vendor again. Each half alone passes
  // in the state the other one catches.
  test.skipIf(noDb)(
    "ИО is curated as a public body AND still reached",
    async () => {
      assert.ok(
        ADMIN_STATE_BODY_CONTRACTORS.includes(IO_EIK),
        "ИО dropped from ADMIN_STATE_BODY_CONTRACTORS — it would render as a private vendor",
      );
      const [r] = await allRows<{ eur: number }>(
        `SELECT round(sum(amount_eur))::float8 AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})
          AND contractor_eik = '${IO_EIK}'`,
      );
      assert.ok(
        (r?.eur ?? 0) > 0,
        "ИО is curated but the group no longer pays it",
      );
    },
  );

  // A SHARE, never a rank or an absolute €. The ceiling is what would fire if a
  // rollup change started crediting a consortium's full value to every member.
  test.skipIf(noDb)("no single contractor takes half the sector", async () => {
    const rows = await allRows<{ eik: string; pct: number }>(
      `WITH w AS (
         SELECT * FROM contracts WHERE tag = 'contract'
          AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)}))
       SELECT contractor_eik AS eik,
              round((100.0 * sum(amount_eur) / (SELECT sum(amount_eur) FROM w))::numeric, 2)::float8 AS pct
         FROM w GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 1`,
    );
    assert.ok(rows.length > 0, "no contractors at all");
    assert.ok(
      rows[0].pct < 50,
      `top contractor ${rows[0].eik} holds ${rows[0].pct}% of the sector`,
    );
  });

  // Every state-body entry must be a genuine outsider, and the private regulated
  // utilities the „is this an awarder somewhere" probe over-captures must stay
  // out. Пinned by EIK: ЗОП's utilities regime makes Балкангаз and Севлиевогаз
  // contracting authorities, and they are not public bodies.
  test("the curated list is disciplined", () => {
    for (const eik of ADMIN_STATE_BODY_CONTRACTORS) {
      assert.match(eik, /^\d{9}(\d{4})?$/, `${eik} is not a plain EIK`);
      assert.ok(
        !ADMIN_SECTOR_EIKS.includes(eik),
        `${eik} is a member — it must carry the „в групата" chip instead`,
      );
    }
    for (const eik of ["130203228", "107063552"])
      assert.ok(
        !ADMIN_STATE_BODY_CONTRACTORS.includes(eik),
        `${eik} is a PRIVATE gas distributor caught by the utilities regime`,
      );
  });
});

// ── the two halves of the page must share one basis ────────────────────────

describe("administration — leaderboard basis == headline basis", () => {
  // ⚠ THIS MUST INTERROGATE `awarder_group_model()`, not two SQL sums built from
  // one WHERE clause. The first version of this test did the latter, and
  // Σ(GROUP BY contractor sums) ≡ Σ(rows) is an ALGEBRAIC IDENTITY over shared
  // inputs: it cannot detect a tag, window or current-value slip, because both
  // sides carry the slip identically. Its only reachable failure was floating
  // point — unable to catch a defect and able to fail on correct data, the worst
  // pair a gate can have.
  //
  // The function is what the page actually reads (AdministrationScreen →
  // useAwarderGroupModel → /api/db/awarder-group-model), and it computes FOUR
  // aggregates over its own scan: `totalEur` drives the KPI, `suppliers` the
  // „Топ изпълнители" leaderboard, `byYear` the spend chart, `byUnit` the
  // „Институции" count. Those are independent code paths, so a divergence
  // between them IS failure mode O — the page contradicting itself.
  //
  // Tolerance, not equality: the function rounds per row, so the four legitimately
  // differ by a few euros (measured €4 across €336.7M). Any real basis
  // disagreement is millions, so €1,000 separates the two cleanly and cannot go
  // flaky the way exact equality did.
  const TOLERANCE_EUR = 1_000;

  test.skipIf(noDb)(
    "every aggregate the page renders comes off one basis",
    async () => {
      const [m] = await allRows<{
        total: number;
        suppliers: number;
        byyear: number;
        byunit: number;
        n: number;
        direct: number;
      }>(
        `WITH m AS (
           SELECT awarder_group_model(ARRAY[${eikList(ADMIN_SECTOR_EIKS)}]::text[], NULL, NULL) AS j)
         SELECT (j->>'totalEur')::float8 AS total,
                (SELECT sum((s->>'totalEur')::float8) FROM jsonb_array_elements(j->'suppliers') s) AS suppliers,
                (SELECT sum((y->>'totalEur')::float8) FROM jsonb_array_elements(j->'byYear') y) AS byyear,
                (SELECT sum((u->>'totalEur')::float8) FROM jsonb_array_elements(j->'byUnit') u) AS byunit,
                (j->>'contractCount')::int AS n,
                (SELECT sum(amount_eur) FROM contracts
                  WHERE tag = 'contract'
                    AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})) AS direct
           FROM m`,
      );
      assert.ok(m, "awarder_group_model returned nothing");
      assert.ok(m.total > 0, "the serving function reports an empty group");

      for (const [name, v] of [
        ["suppliers (Топ изпълнители)", m.suppliers],
        ["byYear (Възложени по година)", m.byyear],
        ["byUnit (Институции)", m.byunit],
        ["contracts (the corpus itself)", m.direct],
      ] as const)
        assert.ok(
          Math.abs(v - m.total) < TOLERANCE_EUR,
          `${name} = €${v} vs headline €${m.total} — the page would contradict itself`,
        );
    },
  );

  // The serving function must also agree with the corpus on the WINDOWED path,
  // which is the one the KPIs use — a half-open [from, to) slip shows up here and
  // nowhere else.
  test.skipIf(noDb)("the windowed path agrees with the corpus", async () => {
    const [m] = await allRows<{ fn: number; direct: number; n: number }>(
      `WITH m AS (
         SELECT awarder_group_model(ARRAY[${eikList(ADMIN_SECTOR_EIKS)}]::text[],
                                    '2025-01-01', '2026-01-01') AS j)
       SELECT (j->>'totalEur')::float8 AS fn,
              (j->>'contractCount')::int AS n,
              (SELECT sum(amount_eur) FROM contracts
                WHERE tag = 'contract'
                  AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})
                  AND date >= '2025-01-01' AND date < '2026-01-01') AS direct
         FROM m`,
    );
    assert.ok(
      m.direct > 0,
      "the 2025 window is empty — the test proves nothing",
    );
    assert.ok(
      Math.abs(m.fn - m.direct) < TOLERANCE_EUR,
      `windowed function €${m.fn} vs corpus €${m.direct}`,
    );
    // And the window must be a real narrowing, or the "scoped" KPIs are not.
    assert.ok(
      m.n > 0 && m.n < 416 * 0.9,
      `${m.n} contracts in 2025 — not a window`,
    );
  });
});
