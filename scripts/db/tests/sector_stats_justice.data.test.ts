// Regression net for the JUSTICE sector — the /governance/sectors „Съдебна власт"
// tile and the /judiciary dashboard behind it. Audit 2026-08-19.
//
//   npm run test:data
//
// A separate file per sector, following the security / environment / regional
// precedent.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE DECOUPLED, the same shape as security and
// environment — and here the decoupling is TOTAL, which is what made the roster
// drift this file exists to catch invisible to every other check. The tile reads
// the `VSS_BUDGET_NODE` ПРБ node's enacted appropriation, so `justice` has no
// `SECTOR_EIKS` entry at all and a wrong or missing judicial EIK cannot move it by
// a cent. Reconciling the headline — which is what a sector audit does first —
// therefore proves NOTHING about the roster. What each block guards:
//
//  · BASIS + VALUE — `basis === 'budget'` at every scope, and an EXACT reconcile
//    against the съдебна власт budget node on value, year AND the `unavailable`
//    flag. Exact rather than a band because it is a file lookup, not an aggregate:
//    a band would miss a wrong year or a lost flag entirely. 30/30 exact, measured.
//  · CROSS-ARTIFACT — the hub reads `budget/ministries/<VSS_BUDGET_NODE>.json`
//    while /judiciary's cost-per-case tile reads a SEPARATE artifact,
//    `budget/vss/budget.json` (the eight ЗДБРБ „Органи на съдебната власт" rows).
//    Two files describing one appropriation is two chances to disagree, and the
//    page and the tile that links to it would then contradict each other at a 200.
//    Measured 2026-08-19: equal to the euro (max delta €1, rounding) on all eight
//    shared years.
//  · EIK-SET — lockstep with the browse pack, every member a real awarder or
//    buyer, and every member's DECLARED id matching the name the corpus knows it by.
//  · COMPLETENESS — the arm that would have caught the defect. See its own note.
//  · BENEFICIARY — Phase 2b found this side clean (top contractor 5.5% all-scope,
//    intra-group circulation ZERO). Cleanliness is what needs pinning.
//
//    ⚠ THE SHARE CEILING CANNOT SEE THE CONSORTIUM MUTATION, and an earlier
//    version of this header claimed it could — the same claim the security sibling
//    already had to correct once. Measured: member rows carry €0 and the top
//    contractor is not a consortium member, so crediting every member the largest
//    carrier's value moves the top share 5.54% → 4.34%, i.e. AWAY from the ceiling.
//    That mutation is asserted directly instead, by the member-rows arm below.
//    What the ceiling does catch is the other shape: one contractor swallowing the
//    sector through a real award, a key merge, or a fold that stops splitting.
//
// Roster SHAPE (duplicate keys, tier headers, alias collapse) is
// src/lib/vssReferenceData.test.ts's job — it needs no database, so it still
// guards on a fresh clone and on a database-less CI leg, where this file skips.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import {
  JUDICIAL_EIKS,
  COURT_LEVEL,
  COURT_COUNT,
  JUDICIAL_BODIES,
  VSS_BUDGET_NODE,
  VSS_EIK,
  VSS_ALIAS_EIKS,
  PRB_EIK,
  VSS_SUPPLIER_CONTEXT,
} from "@/lib/vssReferenceData";
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
/** Derived from the roster's own export, never restated — `data/budget/ministries/`
 *  is gitignored, so a hardcoded slug turns a node RENAME into a silent skip. */
const NODE = `data/budget/ministries/${VSS_BUDGET_NODE}.json`;
const MINISTRIES_DIR = "data/budget/ministries";
/** The per-body artifact /judiciary reads. Committed, unlike the node above. */
const VSS_BUDGET = "data/budget/vss/budget.json";

type BudgetYear = {
  fiscalYear: number;
  expenditure?: { amountEur?: number | null };
  expenditureLaw?: { amountEur?: number | null } | null;
};

/** fiscalYear → € exactly as the generator's `budgetSeries` builds it. Memoised —
 *  two call sites, one parse. */
let seriesCache: Map<number, number> | null = null;
const nodeSeries = (): Map<number, number> => {
  if (seriesCache) return seriesCache;
  const node = readJson<{ years?: BudgetYear[] }>(NODE);
  const byYear = new Map<number, number>();
  for (const y of node.years ?? []) {
    const v = ministryYearSeriesEur(y);
    // ⚠ TRUTHINESS, not `!= null` — `budgetSeries` drops a €0 year deliberately
    // (an un-appropriated shell, so `annual()` falls back to the latest REAL year
    // rather than captioning „бюджет 2024: €0"). Reading it as a present year here
    // would make this arm expect 0 where the generator correctly published the
    // fallback, failing on all 30 scopes at once — on db:refresh's LAST link.
    if (v) byYear.set(y.fiscalYear, v);
  }
  seriesCache = byYear;
  return byYear;
};

/** Distinguishes "no pipeline run on this machine" from "the node was renamed".
 *  Only the first is a legitimate skip; the second must fail. */
const nodeState = (): "ok" | "no-tree" | "renamed" => {
  if (!exists(MINISTRIES_DIR)) return "no-tree";
  return exists(NODE) ? "ok" : "renamed";
};

describe("justice sector — hub headline", () => {
  test("basis is 'budget' at every scope", () => {
    const stats = readJson<SectorStats>(STATS);
    const scopes = Object.keys(stats);
    assert.ok(scopes.length >= 20, `expected ~30 scopes, got ${scopes.length}`);
    for (const k of scopes) {
      const s = stats[k]?.justice;
      assert.ok(s, `no justice stat at scope ${k}`);
      // Not merely "some money basis": an entry in the generator's SECTOR_EIKS
      // would flip this to 'procurement' and restate a €762M sector as its ~€203M
      // lifetime tender flow — or, on the current-parliament default scope, as
      // €2.4M. The judiciary buys centrally and cheaply; its budget is the story.
      assert.equal(s.basis, "budget", `scope ${k}`);
      assert.equal(s.kind, "eur", `scope ${k}`);
    }
  });

  test("value + year + unavailable reconcile EXACTLY to the съдебна власт node", (t) => {
    const state = nodeState();
    if (state === "no-tree")
      return t.skip("data/budget/ministries/ absent (gitignored tree)");
    assert.notEqual(
      state,
      "renamed",
      `${NODE} is missing while its sibling nodes exist — VSS_BUDGET_NODE is stale`,
    );
    const stats = readJson<SectorStats>(STATS);
    const byYear = nodeSeries();
    assert.ok(byYear.size >= 5, `node carries ${byYear.size} year(s)`);
    const latestYear = Math.max(...byYear.keys());
    const latestEur = byYear.get(latestYear)!;

    let checked = 0;
    for (const [scopeKey, row] of Object.entries(stats)) {
      const s = row.justice;
      if (!s) continue;
      const m = /^y:(\d{4})$/.exec(scopeKey);
      const want = m ? byYear.get(Number(m[1])) : undefined;
      if (m && want == null) {
        // A year the node does not cover must fall back to latest AND say so —
        // the flag is what stops a 2026 figure being captioned 2011. The series
        // starts at FY2018, so y:2011..y:2017 all land here.
        assert.equal(s.unavailable, true, `${scopeKey} should be unavailable`);
        assert.equal(s.value, latestEur, scopeKey);
        assert.equal(s.year, latestYear, scopeKey);
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
        // …and are NOT flagged. `annual()` only sets the flag when a specific year
        // was asked for and missed, so a flag here means the scope key stopped
        // parsing as a window — which would otherwise pass silently, since value
        // and year would still be the latest ones.
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
      "some scope carries no justice stat",
    );
    assert.ok(checked >= 28, `only ${checked} scopes checked`);
  });

  // Criterion (c) of a sector audit: the hub tile and the screen it links to must
  // agree. They read DIFFERENT FILES, so nothing but this makes them.
  test("the per-body artifact sums to the node, year by year", (t) => {
    const state = nodeState();
    if (state === "no-tree")
      return t.skip("data/budget/ministries/ absent (gitignored tree)");
    assert.notEqual(
      state,
      "renamed",
      `${NODE} is missing — VSS_BUDGET_NODE is stale`,
    );
    if (!exists(VSS_BUDGET)) return t.skip("vss/budget.json absent");
    const byYear = nodeSeries();
    const vss = readJson<{
      years: Array<{
        fiscalYear: number;
        bodies: Array<{ id: string; amount: { amountEur: number } }>;
      }>;
    }>(VSS_BUDGET);
    assert.ok(vss.years.length >= 5, "vss/budget.json carries too few years");

    let compared = 0;
    for (const by of vss.years) {
      const want = byYear.get(by.fiscalYear);
      // The two artifacts are refreshed by different skills, so one legitimately
      // runs a year ahead (the node has FY2026; the per-body table does not yet).
      // Only SHARED years are comparable — an absent year is a lag, not a defect.
      if (want == null) continue;
      const sum = by.bodies.reduce((a, b) => a + (b.amount?.amountEur ?? 0), 0);
      // ±€2 for per-body rounding: the eight rows are each rounded to the euro.
      assert.ok(
        Math.abs(sum - want) <= 2,
        `FY${by.fiscalYear}: bodies sum to €${Math.round(sum)} but the node says €${want}`,
      );
      compared++;
    }
    // 8 shared years today. A floor of 5 would tolerate losing three of them, which
    // is exactly the silent shrink of a COMMITTED artifact this arm exists to see.
    assert.ok(compared >= 7, `only ${compared} shared year(s) compared`);
  });
});

describe("justice sector — the EIK set", () => {
  test("the browse pack derives from the reference data", () => {
    const ref = new Set(JUDICIAL_EIKS);
    const pack = new Set(SECTOR_BROWSE_PACKS.judiciary?.eiks ?? []);
    assert.deepEqual([...pack].sort(), [...ref].sort(), "browse pack eiks");

    // Lockstep alone is vacuous against a roster LOSS — both copies derive from
    // COURT_LEVEL, so deleting members keeps them equal. Pin the size and the
    // composition; a bulk deletion takes a whole tier.
    assert.ok(
      JUDICIAL_EIKS.length >= 59,
      `roster is ${JUDICIAL_EIKS.length} EIKs, was 59`,
    );
    assert.ok(COURT_COUNT >= 51, `court count is ${COURT_COUNT}, was 51`);
    assert.equal(JUDICIAL_BODIES.length, 6, "central body count moved");
    for (const e of [VSS_EIK, PRB_EIK, ...VSS_ALIAS_EIKS])
      assert.ok(ref.has(e), `${e} left the roster`);
  });

  // ⚠ There are only TWO copies of this roster, not the usual four, and that is
  // correct: `justice` is budget-basis so the generator carries no SECTOR_EIKS
  // entry, and /judiciary is a bespoke screen so there is no SECTOR_DASHBOARDS
  // entry. Both ABSENCES are load-bearing, so both are asserted — the basis arm
  // above catches a SECTOR_EIKS entry only AFTER someone regenerates the committed
  // sector_stats.json, so it would sit green through the change that caused it.
  test("no second copy of the sector exists", () => {
    assert.ok(
      !("justice" in SECTOR_DASHBOARDS) && !("judiciary" in SECTOR_DASHBOARDS),
      "/judiciary is a bespoke screen — a SECTOR_DASHBOARDS entry makes it two pages",
    );
    assert.ok(
      !("justice" in SECTOR_BROWSE_PACKS),
      "a second browse pack appeared under the registry id `justice`",
    );
  });

  // The generator calls main() + process.exit() at module scope, so it cannot be
  // imported. Read its source instead — the same static-analysis shape as
  // src/entryGraph.test.ts and the roster's own pure-TS gate.
  test("the generator keeps justice on the budget basis", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "scripts/db/gen_procurement/sector_stats.ts"),
      "utf-8",
    );
    const eikSet = /const SECTOR_EIKS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    assert.ok(
      eikSet,
      "SECTOR_EIKS literal not found — did the generator move?",
    );
    assert.ok(
      !/^\s*justice\s*:/m.test(eikSet[1]),
      "justice gained a SECTOR_EIKS entry — that flips the tile to a procurement " +
        "headline and restates a €762M sector as its ~€203M lifetime tender flow",
    );
    // Non-vacuity: the regex must still be finding the real literal.
    assert.ok(/^\s*water\s*:/m.test(eikSet[1]), "SECTOR_EIKS parse went stale");
    // And the node slug really is consumed from the roster's export.
    assert.ok(
      /justice:\s*VSS_BUDGET_NODE,/.test(src),
      "the generator restated the justice node slug instead of importing it",
    );
  });

  test.skipIf(skip)(
    "every member is a real awarder or buyer in the corpus",
    async () => {
      const rows = await allRows<{ eik: string }>(
        `SELECT DISTINCT awarder_eik AS eik FROM contracts
           WHERE tag = 'contract' AND awarder_eik = ANY($1)
         UNION
         SELECT DISTINCT buyer_eik FROM tenders WHERE buyer_eik = ANY($1)`,
        [JUDICIAL_EIKS],
      );
      const seen = new Set(rows.map((r) => r.eik));
      const ghosts = JUDICIAL_EIKS.filter((e) => !seen.has(e));
      // Contracts ∪ tenders, not contracts alone: three members are tenders-only
      // (Лом, Луковит, Разлог) and a contracts-only check would call them ghosts.
      assert.deepEqual(
        ghosts,
        [],
        `EIKs absent from both corpora: ${ghosts.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)("every member's name matches its declared id", async () => {
    // A typo'd digit passes lockstep and the ghost check (it may well be a real
    // awarder) and fails here. Deliberately a NAME check on an EIK-curated set —
    // the reverse of curating BY name, which the roster forbids.
    const rows = await allRows<{ eik: string; nm: string }>(
      `SELECT eik, min(nm) AS nm FROM (
         SELECT awarder_eik AS eik, awarder_name AS nm FROM contracts
           WHERE tag = 'contract' AND awarder_eik = ANY($1)
         UNION ALL
         SELECT buyer_eik, buyer_name FROM tenders WHERE buyer_eik = ANY($1)
       ) q GROUP BY eik`,
      [JUDICIAL_EIKS],
    );
    assert.ok(rows.length >= 55, `only ${rows.length} members resolved a name`);
    // ⚠ EVERY id must be covered, central bodies included. An earlier cut mapped
    // only the four court tiers, so a typo'd VKS_EIK that happened to be a real
    // awarder passed every arm in this file — 8 of 59 keys exempt by construction.
    // Софийски ГРАДСКИ съд is an окръжен-tier court with an adjectival name (the
    // Sofia trap `foldJudicialName` documents), which is why the map is keyed on
    // the declared id rather than parsed out of the name.
    //
    // ⚠ NO `\w`, `\b` OR `\d` ANYWHERE IN THESE PATTERNS. They are ASCII-only in
    // JS, so `висш\w*\s+съд\w*` never matches „Висш съдебен съвет" — `\w*` cannot
    // cross „ебен". Caught here on the first run, and it is the same ASCII-class
    // trap the subcontracting parser's `(?![\p{L}\p{N}])` note in CLAUDE.md
    // documents. `\s` is safe; the Cyrillic literals do the work.
    const expect: Record<string, RegExp> = {
      apelativen: /апелативен/i,
      administrativen: /административен/i,
      okrazhen: /(окръжен|градски\s*съд)/i,
      rayonen: /районен/i,
      // Both ВСС rows name the council — the plain one and the 2024 interim-mandate
      // „Съдийската колегия … на Висшия съдебен съвет" alias.
      vss: /съдебен\s+съвет/i,
      ivss: /инспекторат/i,
      vks: /касационен\s+съд/i,
      vas: /административен\s+съд/i,
      // One EIK covers every prosecution unit, so the corpus name is whichever
      // окръжна/апелативна прокуратура sorts first — never „Прокуратура на РБ".
      prb: /прокуратура/i,
      nip: /(национален\s+институт|правосъди)/i,
    };
    const uncovered = [...new Set(Object.values(COURT_LEVEL))].filter(
      (l) => !(l in expect),
    );
    assert.deepEqual(
      uncovered,
      [],
      `CourtLevel ids with no name rule: ${uncovered.join(", ")}`,
    );
    const bad: string[] = [];
    for (const { eik, nm } of rows) {
      const re = expect[COURT_LEVEL[eik]];
      if (!re.test(nm))
        bad.push(`${eik} declared ${COURT_LEVEL[eik]} → "${nm}"`);
    }
    assert.deepEqual(bad, [], `id/name mismatches: ${bad.join(" · ")}`);
  });
});

// ⚠ THIS IS THE BLOCK THAT WOULD HAVE CAUGHT THE 2026-08-19 DEFECT, and the only
// one that can. Районен съд — Разлог (000025110) published its first tender four
// weeks after the cut that minted the roster; it was in Postgres and in no TS file,
// so lockstep, the ghost check and the id/name check were all green.
//
// Two rules make the pattern trustworthy:
//
//  · SPELLED-OUT institution names ONLY, never initialisms. „ВКС" also names
//    „Водоснабдяване канализация и строителство /ВКС/ ЕООД гр. Пещера", a water
//    company — an initialism arm reports it as a missing supreme court, i.e. a hole
//    that looks like a finding. Measured 2026-08-19: no abbreviated judicial
//    spelling (`РС`/`ОС`/`АдмС`/…) exists outside the roster in either corpus, so
//    the rule costs nothing today. That measurement is what makes the trade
//    reviewable — re-take it before widening the pattern.
//  · „градски" is in the alternation because Софийски градски съд is the one court
//    whose name carries no tier word. Without it the sweep is blind to exactly the
//    adjectival Sofia names that have defeated judicial-name folds twice before
//    (see the /court duplicate-body note in CLAUDE.md).
//
// Measured 2026-08-19: reaches 58 of the 59 members (all but НИП, an institute
// rather than a court or prosecution office, which matches no such pattern by
// design) and returns exactly one row outside the set.
const JUDICIAL_NAME_RE =
  "(районен|окръжен|градски|апелативен|административен|военно-окръжен|военен|специализиран|върховен|конституционен)" +
  "[[:space:]-]*(касационен[[:space:]-]*)?съд|съдебен съвет|прокуратура|следствена служба";

/** Reached by the sweep and deliberately NOT съдебна власт — asserted non-vacuous
 *  below, so a narrowing of the pattern fails instead of emptying the result. */
const EXCLUDED: Record<string, string> = {
  "000698605": "Конституционен съд — чл. 147 КРБ, not съдебна власт",
};

/** Executive bodies under the Ministry of Justice that the pattern does NOT reach
 *  today (their names lead with „Министерство" / „Главна дирекция"). Listed so the
 *  exclusion is a recorded decision rather than an accident of the regex — and
 *  asserted UNREACHED, so widening the pattern surfaces them as a decision to make
 *  again instead of a silent exemption. */
const NOT_MATCHED = ["000695349", "129010011", "129010029"];

describe("justice sector — roster completeness", () => {
  const sweep = async (known: readonly string[]) =>
    allRows<{ eik: string; nm: string }>(
      // ⚠ `bool_or` over the RAW names, not a regex against `min(name)`. 2,873 EIKs
      // in the corpus carry more than one distinct name, so collapsing first means
      // a body matches only if its alphabetically-first spelling is judicial — and
      // a new court arriving under two spellings (the mixed „Районен съд …" / „РС …"
      // shape court_load carries) would slip through. The reported name is then
      // also a name that actually MATCHED, which is what the failure message implies.
      `WITH names AS (
         SELECT awarder_eik AS eik, awarder_name AS nm FROM contracts
           WHERE tag = 'contract'
         UNION ALL
         SELECT buyer_eik, buyer_name FROM tenders)
       SELECT eik, min(nm) FILTER (WHERE nm ~* $2) AS nm
         FROM names
        WHERE eik IS NOT NULL AND NOT (eik = ANY($1))
        GROUP BY eik HAVING bool_or(nm ~* $2)
        ORDER BY eik`,
      [known, JUDICIAL_NAME_RE],
    );

  test.skipIf(skip)("no judicial buyer sits outside the roster", async () => {
    const rows = await sweep(JUDICIAL_EIKS);
    const unexplained = rows.filter((r) => !(r.eik in EXCLUDED));
    assert.deepEqual(
      unexplained.map((r) => `${r.eik} ${r.nm}`),
      [],
      "judicial bodies in the corpus but not in COURT_LEVEL — add them to " +
        "vssReferenceData.ts, or to EXCLUDED here with a reason",
    );
    const reached = new Set(rows.map((r) => r.eik));
    // The sweep must still REACH its one exemption. If the pattern narrows,
    // `unexplained` empties for the wrong reason and this file goes green while
    // guarding nothing.
    for (const eik of Object.keys(EXCLUDED))
      assert.ok(
        reached.has(eik),
        `${eik} is no longer reached by the sweep — the pattern narrowed`,
      );
    // …and the recorded-but-unreached bodies must stay unreached. A widening that
    // pulls one in would otherwise be silently absorbed by `EXCLUDED`.
    for (const eik of NOT_MATCHED) {
      assert.ok(
        !reached.has(eik),
        `${eik} is now reached — move it to EXCLUDED`,
      );
      assert.ok(
        !JUDICIAL_EIKS.includes(eik),
        `${eik} is both excluded and in the roster`,
      );
    }
  });

  test.skipIf(skip)(
    "the sweep would catch a newly-appearing court",
    async () => {
      // Non-vacuity, and specifically a REPLAY of the real defect: drop Разлог from
      // the known set and the sweep must name it. Without this the arm above passes
      // just as happily on a pattern that matches nothing at all.
      const withoutRazlog = JUDICIAL_EIKS.filter((e) => e !== "000025110");
      assert.equal(
        withoutRazlog.length,
        JUDICIAL_EIKS.length - 1,
        "000025110 is no longer in the roster — this replay tests nothing",
      );
      const rows = await sweep(withoutRazlog);
      assert.ok(
        rows.some((r) => r.eik === "000025110"),
        "the completeness sweep no longer detects a missing районен съд",
      );
    },
  );

  test.skipIf(skip)("the pattern is not narrower than the corpus", async () => {
    // The replay proves the pattern is not EMPTY and the sweep proves it is not
    // OVER-broad; nothing above proves it is not UNDER-broad. A narrowing edit that
    // still matched „районен … съд" would keep both green while going blind to, say,
    // военни съдилища. This freezes the false-negative set at the three МП bodies.
    //
    // The probe words exclude a bare „съд" on purpose — „сърдечно-съдови" hospital
    // names would otherwise flood it (two УМБАЛ carry it, at €275M and €88M).
    // „правосъд" IS included: without it the three МП bodies are unreachable by the
    // probe too, the expected set comes back empty, and the arm freezes „nothing"
    // instead of „these three" — passing while proving nothing.
    const rows = await allRows<{ eik: string }>(
      `WITH names AS (
         SELECT awarder_eik AS eik, awarder_name AS nm FROM contracts
           WHERE tag = 'contract'
         UNION ALL
         SELECT buyer_eik, buyer_name FROM tenders)
       SELECT eik FROM names
        WHERE eik IS NOT NULL AND NOT (eik = ANY($1))
          AND nm ~* '(съдилищ|прокурат|следствен|съдебн|правосъд)'
        GROUP BY eik HAVING NOT bool_or(nm ~* $2) ORDER BY eik`,
      [JUDICIAL_EIKS, JUDICIAL_NAME_RE],
    );
    assert.deepEqual(
      rows.map((r) => r.eik).sort(),
      [...NOT_MATCHED].sort(),
      "the set of judicial-sounding bodies the pattern misses has changed",
    );
  });
});

describe("justice sector — beneficiaries", () => {
  const CONTRACT_SCOPE = `tag = 'contract' AND awarder_eik = ANY($1)`;

  test.skipIf(skip)("no single contractor dominates the corpus", async () => {
    const [row] = await allRows<{ top_pct: string | null; n: string }>(
      // The three guards are the sibling's: NULL, the empty string and the
      // self-deal bucket are keys in the SQL sense and in no other. All three are
      // empty in the judicial corpus today, but corpus-wide the empty string pools
      // 623 rows / €210M — one ЦАИС batch landing under a judicial awarder would
      // otherwise make `max()` report a pool of unidentified suppliers as "the top
      // contractor", and the loose ceiling would pass it.
      //
      // The DENOMINATOR is deliberately the sector's whole spend, so this reads
      // "X% of the sector's money", not "X% of identified contractor money".
      `WITH w AS (SELECT * FROM contracts WHERE ${CONTRACT_SCOPE}),
       per AS (
         SELECT contractor_eik, sum(amount_eur) AS s FROM w
          WHERE contractor_eik IS NOT NULL AND contractor_eik <> ''
            AND contractor_eik <> awarder_eik
          GROUP BY 1)
       SELECT round((100.0 * max(s) / (SELECT sum(amount_eur) FROM w))::numeric, 2) AS top_pct,
              (SELECT count(*) FROM w)::text AS n
         FROM per`,
      [JUDICIAL_EIKS],
    );
    assert.ok(Number(row.n) > 1000, `only ${row.n} contracts — corpus shrank`);
    const top = Number(row.top_pct);
    // An all-NULL `amount_eur` would make top_pct NULL, and `Number(null)` is 0 —
    // which sails under the ceiling. Five rows already carry a NULL amount.
    assert.ok(
      Number.isFinite(top),
      "top share came back NULL — no money in scope?",
    );
    // 5.54% measured 2026-08-19. A ceiling, never an equality: the leaderboard is
    // SUPPOSED to reorder, and the absolute € moves every fortnight. What must not
    // change is that this sector's money is spread — a jump past 25% means a
    // genuine mega-contract worth a caption, a key merge, or a fold that stopped
    // splitting. (It does NOT mean a consortium rollup change — see the header.)
    assert.ok(top < 25, `top contractor holds ${top}% of the corpus`);
  });

  test.skipIf(skip)(
    "consortium member rows carry no money of their own",
    async () => {
      // The split lives on the CARRIER row; a member row is a naming record. A
      // rollup change crediting each member the carrier's whole value is invisible
      // to the share ceiling above — measured, it moves it 5.54% → 4.34%, the wrong
      // way — so the invariant is asserted directly here.
      const [row] = await allRows<{ n: string; eur: string }>(
        `SELECT count(*)::text AS n, coalesce(sum(amount_eur), 0)::text AS eur
           FROM contracts
          WHERE ${CONTRACT_SCOPE} AND consortium_role = 'member'`,
        [JUDICIAL_EIKS],
      );
      assert.ok(
        Number(row.n) > 0,
        "no member rows left — this arm has gone vacuous",
      );
      assert.equal(
        Number(row.eur),
        0,
        "a consortium member row acquired its own value",
      );
    },
  );

  test.skipIf(skip)("no member buys from another member", async () => {
    // Intra-group circulation: money the page presents as „the sector procured X"
    // that never reached an external market. Measured ZERO here, unlike energy
    // (€141.5M). A non-zero result is worth a sentence on the page rather than a
    // silent inclusion. Self-dealing (awarder_eik = contractor_eik) is the
    // degenerate case of the same predicate and needs no separate assertion — it
    // is a strict subset of these rows.
    const [row] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM contracts
        WHERE ${CONTRACT_SCOPE} AND contractor_eik = ANY($1)`,
      [JUDICIAL_EIKS],
    );
    assert.equal(Number(row.n), 0, "intra-group contracts appeared");
  });

  test.skipIf(skip)(
    "the statutory sole-source supplier is still labelled",
    async () => {
      // „Информационно обслужване" АД is the state's system integrator BY STATUTE
      // (ЗЕУ, 2019), so its e-justice awards are lawfully direct — not a
      // competition failure. `VSS_SUPPLIER_CONTEXT` carries that caveat, and this
      // pins the EIK rather than the name so a „clean up the leaderboard" change
      // cannot quietly turn a statutory monopoly back into an apparent winner.
      const ctx = VSS_SUPPLIER_CONTEXT["831641791"];
      assert.ok(ctx, "831641791 lost its statutory-supplier context");
      assert.equal(ctx.kind, "statutory");
      // …and it is still a live beneficiary, so the caveat is not dead config.
      const [row] = await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM contracts
          WHERE ${CONTRACT_SCOPE} AND contractor_eik = '831641791'`,
        [JUDICIAL_EIKS],
      );
      assert.ok(
        Number(row.n) > 0,
        "831641791 no longer wins judicial contracts",
      );
    },
  );
});
