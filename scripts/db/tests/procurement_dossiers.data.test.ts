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
import { usesCorpusTotal } from "@/data/procurement/projectFile";

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
  /** Top-N member fold total (before any program-total override) — to prove the
   *  corpus basis lifts a distributed program clear of its fold. */
  foldContractedEur: number;
  /** Member procedure УНПs (contracts ∪ tenders) — to pin a tender-only member
   *  (e.g. an unawarded flagship design tender) that carries no contract row. */
  unps: Set<string>;
}

const resolveDossier = async (slug: string): Promise<Resolved> => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(DIR, `${slug}.json`), "utf-8"),
  ) as Spec & { title: { bg?: string; en?: string }; thesis?: unknown };
  const {
    contracts,
    unps,
    tenderCount,
    corpusContractedEur,
    corpusContractCount,
  } = await resolveMembers(spec);
  // MIRROR the offline builder: a program dossier's headline is the corpus total.
  const summary = summarize(
    { title: spec.title, thesis: spec.thesis as never },
    contracts,
    tenderCount,
    usesCorpusTotal(spec)
      ? {
          contractedEur: corpusContractedEur,
          contractCount: corpusContractCount,
        }
      : undefined,
  );
  const foldContractedEur = summarize(
    { title: spec.title, thesis: spec.thesis as never },
    contracts,
    tenderCount,
  ).contractedEur;
  const spend = contracts.filter((c) => (c.tag ?? "contract") === "contract");
  return {
    contracts,
    summary,
    foldContractedEur,
    contractorEiks: new Set(
      contracts.map((c) => c.contractorEik).filter((e): e is string => !!e),
    ),
    eurPerKm: computeCorpusEurPerKm(contracts)?.eurPerKmMedian ?? null,
    unpCount: (unp) => spend.filter((c) => c.unp === unp).length,
    maxContractEur: Math.max(0, ...spend.map((c) => c.amountEur ?? 0)),
    unps: new Set(unps),
  };
};

// Resolve once (only when the DB is up).
const RUSE = skip ? null : await resolveDossier("ruse-veliko-tarnovo");
const HEMUS = skip ? null : await resolveDossier("hemus");
const SAN = skip ? null : await resolveDossier("sanirane-jilishta");
const NCH = skip ? null : await resolveDossier("national-childrens-hospital");
const SOFIA = skip ? null : await resolveDossier("sofia-metro");
const GRAF = skip ? null : await resolveDossier("graf-ignatievo");

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
  "sanirane: the headline is the WHOLE-corpus programme total, not the top-N fold",
  () => {
    // totalBasis:"corpus" → "Договорено (ЗОП)" is the sum over the whole seed
    // WHERE (~€975M / ~4,539 contracts at audit time), an order of magnitude
    // above the ~€168M top-60 fold. This is what stops the headline reading a
    // misleadingly tiny slice of a national programme.
    const eur = SAN!.summary.contractedEur;
    assert.ok(
      eur > 700_000_000 && eur < 1_400_000_000,
      `sanirane corpus contractedEur €${(eur / 1e6).toFixed(0)}M outside [700M, 1400M]`,
    );
    assert.ok(
      SAN!.summary.contractCount > 3_500 && SAN!.summary.contractCount < 6_500,
      `sanirane corpus contractCount ${SAN!.summary.contractCount} outside [3500, 6500]`,
    );
    // The corpus basis must clear the fold by a wide margin (else the program
    // override silently regressed to the members total).
    assert.ok(
      eur > SAN!.foldContractedEur * 3,
      `corpus €${(eur / 1e6).toFixed(0)}M not >> fold €${(SAN!.foldContractedEur / 1e6).toFixed(0)}M — program-total override regressed`,
    );
    // The fold (the top-N members driving the breakdowns) stays a modest slice.
    assert.ok(
      SAN!.foldContractedEur > 100_000_000 &&
        SAN!.foldContractedEur < 320_000_000,
      `sanirane fold €${(SAN!.foldContractedEur / 1e6).toFixed(0)}M outside [100M, 320M]`,
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

// ── Национална детска болница ────────────────────────────────────────────────
// A single-buyer SPV dossier. The audit fixed TWO failure modes at once:
//  · Fix G (scope): the distinctive token `детска` is a generic word (детска
//    градина / ясла / площадка / церебрална парализа), so the UNSCOPED seed
//    auto-included ~€1.22M of kindergartens, nurseries, playgrounds and a
//    cerebral-palsy rehab hospital across 10 unrelated buyers. `buyerEik`
//    206218659 ("Здравна инвестиционна компания за детска болница" ЕАД — the
//    special-purpose company built solely for this hospital) removes all of it.
//  · Fix D (recall): the project was RENAMED, so its two most important records
//    carry no „детска болница" in the title and were dropped — the €5.04M
//    flagship design/supervision tender (06008-2026-0001, „…Национална
//    многопрофилна болница за активно лечение на деца") and the €35k prep study
//    (contract ced05ae42f50 / tender 06008-2024-0001). Pulled back via `includes`.

test.skipIf(skip)(
  "national-childrens-hospital: total is the whole-SPV set, not the €1.22M kindergarten pollution",
  () => {
    // The scoped SPV fold is ~€2.37M (demolition €2.30M + prep €35k + banking).
    // A dropped/broken buyerEik scope re-admits the ~€1.22M of детска-градина /
    // площадка / церебрална-парализа false positives (plus lineage), blowing the
    // ceiling; an over-trim of the €2.3M demolition sinks the floor.
    const eur = NCH!.summary.contractedEur;
    assert.ok(
      eur > 2_000_000 && eur < 3_000_000,
      `nch contractedEur €${(eur / 1e6).toFixed(2)}M outside [2.0M, 3.0M]`,
    );
  },
);

test.skipIf(skip)(
  "national-childrens-hospital: the €5M flagship design tender is a member (recall fix)",
  () => {
    // Tender-only (unawarded) → pinned via the member УНП set, not a contract row.
    assert.ok(
      NCH!.unps.has("06008-2026-0001"),
      "flagship design/supervision tender 06008-2026-0001 missing — the includes recall fix regressed",
    );
    // The prep study (both its contract and tender) — the other title-missed member.
    assert.ok(
      NCH!.unps.has("06008-2024-0001"),
      "prep-study procedure 06008-2024-0001 missing from the member set",
    );
    // 7 SPV procedures total (3 from contracts + 4 tender-only) — a broken include
    // for a tender-only procedure drops this below 7.
    assert.ok(
      NCH!.summary.procedureCount >= 7,
      `nch procedureCount ${NCH!.summary.procedureCount} < 7 — a tender-only member was dropped`,
    );
  },
);

test.skipIf(skip)(
  "national-childrens-hospital: no kindergarten / playground buyer leaks in (scope fix)",
  () => {
    // Every member must be an SPV award — its biggest is the €2.30M demolition
    // (Консорциум техноком). None of the audit's false-positive buyers'
    // contractors may appear, and no member may exceed the demolition.
    assert.ok(
      NCH!.contractorEiks.has("176059792"),
      "Консорциум техноком (the €2.3M demolition contractor) missing — over-trim",
    );
    assert.ok(
      NCH!.maxContractEur < 2_500_000,
      `a €${(NCH!.maxContractEur / 1e6).toFixed(2)}M member exceeds the €2.3M demolition — a foreign buyer leaked in`,
    );
    // A cheap cleanliness invariant: no member title is a kindergarten / nursery /
    // playground / cerebral-palsy object (the audit's false-positive shapes).
    const leak = NCH!.contracts.find((c) =>
      /детска градина|детска ясла|детски ясли|детск(а|и) площадк|церебрална парализа/i.test(
        c.title ?? "",
      ),
    );
    assert.ok(
      leak == null,
      `kindergarten/playground contract leaked into nch: "${leak?.title?.slice(0, 60)}"`,
    );
  },
);

// ── Софийско метро (buyer-anchored: whole „Метрополитен" ЕАД corpus) ─────────
// The audit that produced this dossier replaced a fuzzy `terms:"метро"` search
// (which pulled cross-buyer noise — метрология, N-метрови buses, a 50-метров
// pool, railway trigram junk — AND missed €258M of the buyer's own non-"метро"-
// titled tunnel work) with a buyer-anchored thread scoped to EIK 000632256. The
// member set is now the WHOLE buyer. These pins catch a regression to the term.

test.skipIf(skip)(
  "sofia-metro: contracted total is the whole-buyer figure, not the term slice",
  () => {
    // Buyer-anchored = ~€1.69bn over ~372 contracts. A revert to `terms:"метро"`
    // collapses to ~240 contracts / ~€1.43bn, so a floor well above €1.43bn is the
    // primary anchoring guard; the ceiling catches a corpus-wide over-inclusion.
    const eur = SOFIA!.summary.contractedEur;
    assert.ok(
      eur > 1_550_000_000 && eur < 2_300_000_000,
      `sofia-metro contractedEur €${(eur / 1e6).toFixed(0)}M outside [1550M, 2300M] — buyer-anchoring may have regressed to a term slice`,
    );
    assert.ok(
      SOFIA!.contracts.length >= 360,
      `sofia-metro has only ${SOFIA!.contracts.length} member contracts (< 360) — whole-buyer paging under-collected`,
    );
    // ~356 procedures — proves the lineage walk paged past the engine's 100 cap.
    // (contractedEur here is the member FOLD total; usesCorpusTotal is false for a
    // buyer-anchored dossier, but the fold == the whole-buyer sum, so the band holds.)
    assert.ok(
      SOFIA!.unps.size >= 300,
      `sofia-metro has only ${SOFIA!.unps.size} member procedures (< 300) — lineage truncated at the page cap`,
    );
  },
);

test.skipIf(skip)(
  "sofia-metro: anchoring recovers the buyer's own non-'метро'-titled core work",
  () => {
    // ДЗЗД Граждански дружество ДВУ built the €99.8M tunnel-boring section titled
    // "Tунелен участък… ТПМ" — NO "метро" in the title, so a term search misses it
    // entirely. Its presence proves the buyer (not a landmark word) is the predicate.
    assert.ok(
      SOFIA!.contractorEiks.has("176918485"),
      "ДЗЗД ДВУ (€99.8M ТПМ tunnel — no 'метро' in title) missing → anchoring regressed to a term",
    );
    // Siemens (EIK 121746004) built the €213.9M rolling-stock contract — the
    // signature true-positive AND the largest single member. Assert the Siemens
    // contract itself carries a €200M+ value (a floor: catches a drop or a
    // value-collapse) rather than pinning the GLOBAL max to a tight ceiling, which
    // a future metro-extension award could breach while Siemens is still correct.
    const siemens = SOFIA!.contracts.find(
      (c) => c.contractorEik === "121746004",
    );
    assert.ok(
      siemens != null && (siemens.amountEur ?? 0) > 200_000_000,
      `Сименс (€213.9M metro trains) missing or under €200M in sofia-metro — over-trim`,
    );
  },
);

// ── Авиобаза „Граф Игнатиево“ ────────────────────────────────────────────────
// Audit (2026-07-23): the base is military unit 28000; its procurement splits
// across TWO buyers — МО (000695324) for the €12.17M capital autopark + ATC
// software, and Командване на ВВС (129010189) for day-to-day upkeep. The initial
// spec scoped ONLY to МО (2 contracts / €14.1M) and missed the 23 Air Force
// operational contracts. The distinctive token "игнатиево" is heavily polluted
// (town Игнатиево near Varna, village Граф Игнатиево municipal works, "ул. Граф
// Игнатиев" streets/schools) — the two-buyer scope is what keeps that €33M+ of
// noise out, so these pins double as a buyer-scope regression net.

test.skipIf(skip)(
  "graf-ignatievo: both buyer threads resolve (МО capital + ВВС upkeep), no pollution leak",
  () => {
    // €16.99M across МО + ВВС. Floor catches loss of a thread / gross over-trim;
    // ceiling catches the town/street pollution leaking back if the buyer scope
    // breaks (unscoped, "игнатиево" pulls €33M+ of Ямбол/Аксаково/Марица noise).
    const eur = GRAF!.summary.contractedEur;
    assert.ok(
      eur > 15_000_000 && eur < 20_000_000,
      `graf-ignatievo contractedEur €${(eur / 1e6).toFixed(1)}M outside [15M, 20M] — a thread dropped or pollution leaked`,
    );
    // ВВС thread present: МО alone is 2 contracts; the airbase's operational
    // corpus lifts this well past 20. A drop back toward 2 = the ВВС thread lost.
    assert.ok(
      GRAF!.summary.contractCount >= 20,
      `graf-ignatievo has only ${GRAF!.summary.contractCount} contracts (< 20) — the ВВС Command thread regressed`,
    );
  },
);

test.skipIf(skip)(
  "graf-ignatievo: both buyers' signature contractors present; no oversized off-base leak",
  () => {
    // ПАРСЕК ГРУП (МО) built the €12.17M автопарк с горивозарядна станция — the
    // single largest member and the МО-thread signature.
    assert.ok(
      GRAF!.contractorEiks.has("203215490"),
      "ПАРСЕК ГРУП (€12.17M autopark) missing → МО thread regressed",
    );
    // ЛОГ-СИБЕРИЯ built the €1.38M „кабел-кука“ arrestor system — reachable ONLY
    // via the Командване на ВВС buyer, so its presence proves the second thread.
    assert.ok(
      GRAF!.contractorEiks.has("121502690"),
      "ЛОГ-СИБЕРИЯ (€1.38M arrestor cable) missing → the ВВС Command thread is not resolving",
    );
    // The autopark (€12.17M) is the biggest genuine member; anything larger would
    // be an off-base pollution leak (the €10-11M Ямбол/Аксаково aggregates).
    assert.ok(
      GRAF!.maxContractEur < 13_000_000,
      `graf-ignatievo largest member is €${(GRAF!.maxContractEur / 1e6).toFixed(1)}M (>= €13M) — an off-base contract leaked in`,
    );
  },
);
