// Regression net for the AUDITED curated procurement dossiers (Хемус, Русе–В.
// Търново). It re-runs the real membership resolver (resolveMembers — the same
// seed → УНП lineage → lot-guard the dossier page uses) against the loaded
// `contracts` table and pins the exact false-positives the audits removed and
// the true-positives they kept, so a future change to the guard, the seed, or
// the corpus can't silently re-introduce the leaks or over-trim.
//
//   npm run test:data
//
// Auto-skips when Postgres is unreachable or the contracts table is absent
// (CI / fresh checkout), exactly like invariants_pg.data.test.ts.
//
// The two bugs this guards (see the audits):
//  · Fix 1 (lot fan-out guard): an un-linked lot-per-oblast framework whose one
//    matching region lot dragged in every OTHER region's lot + a fuel-supply lot
//    (Русе) / other motorways АМ Тракия/Марица (Хемус). Pinned by asserting those
//    framework УНПs are ABSENT and the genuine route/archaeology УНПs PRESENT.
//  · Fix 2 (value-weighted €/km): a plain median sank to a survey contract's rate
//    (€156k/km on the "golden motorway"). Pinned by a €/km floor.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { allRows, end } from "../lib/pg";
import {
  resolveMembers,
  summarize,
  type Spec,
  type CRow,
} from "../../procurement/build_project_members";
import { computeCorpusEurPerKm } from "@/data/procurement/projectRoadBenchmark";

// The real /api/db/table engine — driven directly to prove the globalFtsOnly
// seed flag at the corpus level (see the trigram-pollution audit).
const { runDbTable } = createRequire(import.meta.url)(
  "../../../functions/db_table.js",
) as {
  runDbTable: (
    q: (sql: string, params: unknown[]) => Promise<unknown[]>,
    req: {
      resource: string;
      page: number;
      pageSize: number;
      sort: Array<{ id: string; desc: boolean }>;
      filters: Record<string, unknown>;
    },
  ) => Promise<{ rows: Array<{ title?: string | null }>; total: number }>;
};
const dbq = (sql: string, params: unknown[]) => allRows(sql, params);

// Anchor to the module, not the cwd, so a read failure can't escape the PG-skip.
const DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../data/procurement/projects",
);

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

interface Resolved {
  contracts: CRow[];
  summary: ReturnType<typeof summarize>;
  contractorEiks: Set<string>;
  eurPerKm: number | null;
  /** Count of member SPEND rows (tag='contract') on a given procedure УНП — the
   *  fan-out signal: a leaked framework brings back all its region lots. */
  unpCount: (unp: string) => number;
  maxContractEur: number;
}

const resolveDossier = async (slug: string): Promise<Resolved> => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(DIR, `${slug}.json`), "utf-8"),
  ) as Spec & { title: { bg?: string; en?: string }; thesis?: unknown };
  const { contracts, tenderCount } = await resolveMembers(spec);
  const summary = summarize(
    { title: spec.title, thesis: spec.thesis as never },
    contracts,
    tenderCount,
  );
  const spend = contracts.filter((c) => (c.tag ?? "contract") === "contract");
  return {
    contracts,
    summary,
    contractorEiks: new Set(
      contracts.map((c) => c.contractorEik).filter((e): e is string => !!e),
    ),
    eurPerKm: computeCorpusEurPerKm(contracts)?.eurPerKmMedian ?? null,
    unpCount: (unp) => spend.filter((c) => c.unp === unp).length,
    maxContractEur: Math.max(0, ...spend.map((c) => c.amountEur ?? 0)),
  };
};

// Resolve once (only when the DB is up).
const RUSE = skip ? null : await resolveDossier("ruse-veliko-tarnovo");
const HEMUS = skip ? null : await resolveDossier("hemus");
const SAN = skip ? null : await resolveDossier("sanirane-jilishta");

// ── Русе–Велико Търново ─────────────────────────────────────────────────────

test.skipIf(skip)(
  "ruse: total contracted stays in the deleaked band (over-expansion / over-trim guard)",
  () => {
    // Was €896.1M before Fix 1 (fuel + regional frameworks); €823M after. A
    // regression that re-expands blows the ceiling; a gross over-trim the floor.
    // Widen if a genuinely new Русе construction contract lands.
    const eur = RUSE!.summary.contractedEur;
    assert.ok(
      eur > 780_000_000 && eur < 875_000_000,
      `ruse contractedEur €${(eur / 1e6).toFixed(0)}M outside [780M, 875M]`,
    );
  },
);

test.skipIf(skip)(
  "ruse: nationwide frameworks are trimmed to their one matching lot, not fanned out",
  () => {
    // Each framework legitimately keeps ONE seeded region lot (it names Русе +
    // В.Търново); the fix removes the OTHER region lots. Pre-fix these carried
    // 4 / 8 / 4 member contracts — a re-expansion pushes any back over 3.
    for (const unp of [
      "00044-2018-0034", // Юпитер 05 fuel-supply framework (was 4)
      "00044-2018-0057", // regional-service framework (was 8)
      "00044-2019-0030", // regional-service framework (was 4)
    ]) {
      assert.ok(
        RUSE!.unpCount(unp) <= 3,
        `framework ${unp} fanned out (${RUSE!.unpCount(unp)} member lots) — lot guard regressed`,
      );
    }
    // The Юпитер 05 fuel lots were purely other-region → the firm must be gone.
    assert.ok(
      !RUSE!.contractorEiks.has("115578467"),
      "Юпитер 05 (fuel-supply framework) leaked back into Русе",
    );
  },
);

test.skipIf(skip)(
  "ruse: the core route contractor is present and leads by value (over-trim guard)",
  () => {
    // ДЗЗД ХЕМУС-16320 built the €448M Русе–Бяла section — must stay, and rank as
    // a leading contractor by spend (not pinned to exact rank 0, to survive a
    // future maintenance contractor).
    assert.ok(
      RUSE!.contractorEiks.has("177201764"),
      "ДЗЗД ХЕМУС-16320 (€448M core section) missing from Русе",
    );
    const core = RUSE!.summary.topContractors.find(
      (r) => r.eik === "177201764",
    );
    assert.ok(
      core != null && core.eur > 300_000_000,
      `ДЗЗД ХЕМУС-16320 not a leading Русе contractor (${core ? `€${(core.eur / 1e6).toFixed(0)}M` : "absent from top list"})`,
    );
  },
);

test.skipIf(skip)(
  "ruse: €/km reads as a real motorway rate, not a survey outlier (Fix 2)",
  () => {
    // Value-weighted €/km ≈ €11M/km; the pre-fix plain median was €156k/km.
    assert.ok(
      RUSE!.eurPerKm != null && RUSE!.eurPerKm > 1_000_000,
      `ruse €/km €${((RUSE!.eurPerKm ?? 0) / 1e6).toFixed(2)}M too low — value-weighting regressed`,
    );
  },
);

// ── Магистрала „Хемус“ ──────────────────────────────────────────────────────

test.skipIf(skip)(
  "hemus: total contracted stays in the deleaked band (АМ Тракия/Марица removed)",
  () => {
    // €524.8M before Fix 1 (АМ Тракия/Марица + other-road lots wrongly included);
    // €484.5M after. Ceiling catches the re-leak; floor catches an over-trim.
    const eur = HEMUS!.summary.contractedEur;
    assert.ok(
      eur > 455_000_000 && eur < 515_000_000,
      `hemus contractedEur €${(eur / 1e6).toFixed(0)}M outside [455M, 515M]`,
    );
  },
);

test.skipIf(skip)(
  "hemus: the multi-motorway framework keeps only its АМ Хемус lot",
  () => {
    // 00044-2018-0092 has an АМ Хемус lot (kept, legitimate) plus АМ Тракия / АМ
    // Марица lots (must be trimmed). Pre-fix all 4 lots leaked in; now only 1.
    assert.ok(
      HEMUS!.unpCount("00044-2018-0092") <= 2,
      `АМ Тракия/Марица lots leaked into Хемус (${HEMUS!.unpCount("00044-2018-0092")} member lots on 00044-2018-0092)`,
    );
  },
);

test.skipIf(skip)(
  "hemus: the single-contractor route archaeology is KEPT (carve-out guard)",
  () => {
    // A НАИМ archaeology campaign (~18 null-lot sub-contracts under one procedure)
    // — the single-contractor carve-out keeps the whole campaign; a regression to
    // matched-only would strip it back to the one seeded contract.
    assert.ok(
      HEMUS!.unpCount("03461-2015-0006") >= 5,
      `Хемус route archaeology (03461-2015-0006) wrongly trimmed — only ${HEMUS!.unpCount("03461-2015-0006")} lots kept`,
    );
  },
);

test.skipIf(skip)(
  "hemus: no Русе-sized construction leaked in, and the in-house builder is present",
  () => {
    // The €448M / €337M Русе construction contracts must never appear here — the
    // biggest genuine Хемус contract is ~€104M (maintenance).
    assert.ok(
      HEMUS!.maxContractEur < 200_000_000,
      `a €${(HEMUS!.maxContractEur / 1e6).toFixed(0)}M contract leaked into Хемус (Русе construction?)`,
    );
    // Автомагистрали ЕАД — the in-house builder the dossier's thesis is about.
    assert.ok(
      HEMUS!.contractorEiks.has("831646048"),
      "Автомагистрали ЕАД (the in-house builder) missing from Хемус",
    );
  },
);

// ── Саниране на жилищни сгради (многофамилн) ────────────────────────────────

test.skipIf(skip)(
  "sanirane: total contracted stays in the multifamily-programme band",
  () => {
    // €167.8M at audit time (top-60 seed of the многофамилн programme + УНП
    // lineage). Floor catches an over-trim / a regression that re-breaks the
    // stem term; ceiling catches a re-leak. Widen as the corpus grows.
    const eur = SAN!.summary.contractedEur;
    assert.ok(
      eur > 120_000_000 && eur < 260_000_000,
      `sanirane contractedEur €${(eur / 1e6).toFixed(0)}M outside [120M, 260M]`,
    );
  },
);

test.skipIf(skip)(
  "sanirane: the лидиращ renovation contractor is present and no road-sized contract leaked in",
  () => {
    // СК Билдинг АД leads the multifamily renovation spend (~€48M across the
    // programme). A genuine multifamily contract is never road-sized.
    assert.ok(
      SAN!.contractorEiks.has("201205309"),
      "СК Билдинг АД (leading renovation contractor) missing from sanirane",
    );
    assert.ok(
      SAN!.maxContractEur < 100_000_000,
      `a €${(SAN!.maxContractEur / 1e6).toFixed(0)}M contract leaked into sanirane (not a multifamily block)`,
    );
  },
);

test.skipIf(skip)(
  "sanirane: membership carries no gas / planning contract (cleanliness sanity)",
  () => {
    // A cheap membership invariant — no gas-pipeline (`газопреносн…`) or planning
    // (`…планиране, инвестиционно…`) contract is in the set. NB this dossier's
    // stem `многофамилн` shares no trigrams with those, so it is NOT the guard for
    // the single-token FTS-only policy — the engine test below (driven with the
    // colliding `-иране` term `саниране`) is what enforces the policy.
    const leak = SAN!.contracts.find((c) =>
      /газопреносн|планиране, инвестиционно/i.test(c.title ?? ""),
    );
    assert.ok(
      leak == null,
      `gas / planning contract in sanirane: "${leak?.title?.slice(0, 60)}"`,
    );
  },
);

test.skipIf(skip)(
  "sanirane: a buildings dossier reports no road €/km (sector-less → no benchmark)",
  () => {
    // No `sector: "roads"` → the road €/km benchmark must not apply to buildings.
    assert.ok(
      SAN!.eurPerKm == null,
      `a buildings dossier computed a €/km rate (${SAN!.eurPerKm}) — road benchmark wrongly applied`,
    );
  },
);

// ── Engine: the globalFtsOnly seed flag (trigram-pollution guard) ────────────

test.skipIf(skip)(
  "globalFtsOnly drops the trigram fuzz that inflates a single-token seed",
  async () => {
    // `саниране` (a `-иране` term) fuzzy-matches `…планиране, инвестиционно…` and
    // `…газопреносната мрежа…` via `%>` (5/6 shared trigrams). Those fuzz rows are
    // the HIGHEST-value contracts (gas-transmission works dwarf any renovation),
    // so they sit permanently at the top of the amount-desc seed window — the
    // premise guard below is durable, not a marginal-rank flake. The default seed
    // pulls them in and inflates the exact count; FTS-only drops both. Proven
    // against the real engine, not a re-implemented WHERE clause.
    const seed = (ftsOnly: boolean) =>
      runDbTable(dbq, {
        resource: "contracts",
        page: 0,
        pageSize: 60,
        sort: [{ id: "amount_eur", desc: true }],
        filters: {
          global: "саниране",
          globalCols: ["title"],
          ...(ftsOnly ? { globalFtsOnly: true } : {}),
          columns: [{ id: "tag", value: ["contract"] }],
        },
      });
    const gasIn = (rows: Array<{ title?: string | null }>) =>
      rows.filter((r) =>
        /газопреносн|планиране, инвестиционно/i.test(r.title ?? ""),
      ).length;

    const fuzzy = await seed(false);
    const fts = await seed(true);
    assert.ok(
      gasIn(fuzzy.rows) > 0,
      "expected the default seed to admit trigram-fuzz rows (test premise)",
    );
    assert.equal(
      gasIn(fts.rows),
      0,
      "globalFtsOnly still let trigram-fuzz rows into the seed window",
    );
    assert.ok(
      fts.total < fuzzy.total,
      `FTS-only banner (${fts.total}) not below the fuzzy banner (${fuzzy.total})`,
    );
  },
);
