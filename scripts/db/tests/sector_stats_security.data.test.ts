// Regression net for the SECURITY sector — the /governance/sectors tile and the
// /sector/security (МВР) dashboard behind it. Audit 2026-08-19,
// docs/plans/sector-security-audit-v1.md.
//
//   npm run test:data
//
// A separate file per sector, following the environment / regional precedent.
//
// ⚠ THE HEADLINE AND THE EIK-SET ARE DECOUPLED, the same shape as environment:
// the tile reads МВР's enacted appropriation, so a wrong EIK does not move it by
// a cent. The two therefore need separate gates and the EIK one cannot lean on a
// sum. What each block guards:
//
//  · BASIS + VALUE — `basis === 'budget'` at every scope, and an EXACT reconcile
//    against the МВР budget node on value, year AND the `unavailable` flag. Exact
//    rather than a band because it is a file lookup, not an aggregate: a band
//    would miss a wrong year or a lost flag entirely. 30/30 exact, measured.
//  · EIK-SET — lockstep across the three copies, every member a real awarder,
//    every member plausibly МВР, and an ANTI-allowlist that is itself checked for
//    non-vacuity. The excluded bodies are not hypothetical: the `1290*` range is
//    the whole security-services family and holds Ministry of JUSTICE penitentiary
//    units (ГД „Изпълнение на наказанията" €159M, Фонд затворно дело €97M) plus
//    ДАНС and ДАТО. Admitting any of them attributes another ministry's money to
//    МВР, which is the €370M-shaped error the defense audit caught in the mirror
//    direction.
//  · BENEFICIARY — the audit's Phase 2b found this side clean (top contractor
//    5.9% all-scope, intra-group €14,941, one self-deal row already excluded by
//    061). Cleanliness is what needs pinning: a rollup change that credited a
//    consortium's full value to every member would show up here as a SHARE long
//    before anyone noticed a total. Shares and classifications only — never a rank
//    or an absolute €, both of which move on every fortnightly reload.
//  · LINKABILITY — an `obed-` carrier really is among the group's top contractors,
//    and `isLinkableCompanyKey` really returns true for it. This is the corpus
//    half of the 2026-08-19 widening; the unit test in src/lib/companyKey.test.ts
//    pins the predicate but cannot see that the corpus still exercises it.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  SECURITY_SECTOR_EIKS,
  MVR_ENTITIES,
  MVR_EIK,
  MEDICAL_INSTITUTE_EIK,
  MVR_BUDGET_NODE,
} from "@/lib/securityReferenceData";
import { isLinkableCompanyKey } from "@/lib/companyKey";
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
const NODE = `data/budget/ministries/${MVR_BUDGET_NODE}.json`;

describe("security sector — hub headline", () => {
  test("basis is 'budget' at every scope", () => {
    const stats = readJson<SectorStats>(STATS);
    const scopes = Object.keys(stats);
    assert.ok(scopes.length >= 20, `expected ~30 scopes, got ${scopes.length}`);
    for (const k of scopes) {
      const s = stats[k]?.security;
      assert.ok(s, `no security stat at scope ${k}`);
      // Not merely "some money basis": a re-entry into SECTOR_EIKS would flip this
      // to 'procurement' and understate the sector by two orders of magnitude, and
      // a stale artifact nobody regenerated says the same thing.
      assert.equal(s.basis, "budget", `scope ${k}`);
      assert.equal(s.kind, "eur", `scope ${k}`);
    }
  });

  test("value + year + unavailable reconcile EXACTLY to the МВР budget node", (t) => {
    if (!exists(NODE))
      return t.skip("МВР budget node absent (gitignored tree)");
    const stats = readJson<SectorStats>(STATS);
    const node = readJson<{
      years?: Array<{
        fiscalYear: number;
        expenditure?: { amountEur?: number | null };
        expenditureLaw?: { amountEur?: number | null } | null;
      }>;
    }>(NODE);
    // `ministryYearSeriesEur`, not `expenditure.amountEur` — the helper is the ONE
    // definition of which of the node's two appropriation figures a cross-year read
    // takes (`expenditureLaw ?? expenditure`). МВР happens to carry no
    // `expenditureLaw` today, so a hand-rolled read would agree and then silently
    // diverge the first year the law and the отчет disagree.
    const byYear = new Map<number, number>();
    for (const y of node.years ?? []) {
      const v = ministryYearSeriesEur(y);
      if (v != null) byYear.set(y.fiscalYear, v);
    }
    assert.ok(byYear.size >= 5, `МВР node carries ${byYear.size} year(s)`);
    const latestYear = Math.max(...byYear.keys());
    const latest = { fiscalYear: latestYear, eur: byYear.get(latestYear)! };

    let checked = 0;
    for (const [scopeKey, row] of Object.entries(stats)) {
      const s = row.security;
      if (!s) continue;
      const m = /^y:(\d{4})$/.exec(scopeKey);
      const want = m ? byYear.get(Number(m[1])) : undefined;
      if (m && want == null) {
        // A year the node does not cover must fall back to latest AND say so —
        // the flag is what stops a 2026 figure being captioned 2011.
        assert.equal(s.unavailable, true, `${scopeKey} should be unavailable`);
        assert.equal(s.value, latest.eur, scopeKey);
        assert.equal(s.year, latest.fiscalYear, scopeKey);
      } else if (m) {
        assert.equal(s.value, want, `${scopeKey} value`);
        assert.equal(s.year, Number(m[1]), `${scopeKey} year`);
        assert.ok(
          !s.unavailable,
          `${scopeKey} must not be flagged unavailable`,
        );
      } else {
        // `all` and every `ns:` window resolve to the latest fiscal year.
        assert.equal(s.value, latest.eur, `${scopeKey} value`);
        assert.equal(s.year, latest.fiscalYear, `${scopeKey} year`);
      }
      checked++;
    }
    assert.ok(checked >= 20, `only ${checked} scopes checked`);
  });
});

describe("security sector — the EIK set", () => {
  test("the three copies are the same set", () => {
    const ref = new Set(SECURITY_SECTOR_EIKS);
    const dash = new Set(
      (SECTOR_DASHBOARDS.security?.members ?? []).map((m) => m.eik),
    );
    const pack = new Set(SECTOR_BROWSE_PACKS.security?.eiks ?? []);
    assert.equal(
      ref.size,
      MVR_ENTITIES.length,
      "duplicate EIK in MVR_ENTITIES",
    );
    assert.deepEqual([...dash].sort(), [...ref].sort(), "dashboard members");
    assert.deepEqual([...pack].sort(), [...ref].sort(), "browse pack eiks");
    // The generator carries NO security entry — the sector is budget-basis, and a
    // SECTOR_EIKS re-entry is what would silently flip the headline.
    assert.ok(ref.has(MVR_EIK) && ref.has(MEDICAL_INSTITUTE_EIK));
  });

  test.skipIf(skip)(
    "every member is a real awarder in the corpus",
    async () => {
      const rows = await allRows<{ awarder_eik: string }>(
        `SELECT DISTINCT awarder_eik FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
        [SECURITY_SECTOR_EIKS],
      );
      const seen = new Set(rows.map((r) => r.awarder_eik));
      const ghosts = SECURITY_SECTOR_EIKS.filter((e) => !seen.has(e));
      assert.deepEqual(
        ghosts,
        [],
        `EIKs with no contracts: ${ghosts.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)("every member looks like an МВР body", async () => {
    // A typo'd digit passes lockstep and the ghost check (it may well be a real
    // awarder) and fails here. Deliberately a NAME check on an EIK-curated set —
    // the reverse of curating by name, which is what the roster forbids.
    const rows = await allRows<{ awarder_eik: string; nm: string }>(
      `SELECT awarder_eik, min(awarder_name) AS nm FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1) GROUP BY 1`,
      [SECURITY_SECTOR_EIKS],
    );
    const OK =
      /вътрешни(те)?\s+работи|МВР|гранична\s+полиц|национална\s+полиц|охранителна\s+полиц|криминална\s+полиц|организираната\s+престъпност|ГДБОП|жандармер|пожарна\s+безопасност|ПБЗН|РДПБЗН|миграц|куриерска\s+служба|Академия/i;
    // ONE unit whose ЦАИС name carries no ministry token at all — a real property
    // of the corpus, not a curation slip, so it is exempted BY EIK with the name
    // that made it necessary. Exempting by pattern instead would blunt the arm for
    // the other 73. The staleness arm below is what keeps this list at one: the
    // first cut listed four, and it proved three of them (ДУССД, ДМП, ДМ) already
    // carry „МВР" in their registry name and needed no exemption.
    const NAME_EXEMPT: Record<string, string> = {
      "129010698": "Дирекция Комуникационни и Информационни системи (ДКИС)",
    };
    const odd = rows.filter(
      (r) => !OK.test(r.nm) && !NAME_EXEMPT[r.awarder_eik],
    );
    assert.deepEqual(
      odd.map((r) => `${r.awarder_eik} ${r.nm}`),
      [],
      "member whose corpus name does not read as an МВР body",
    );
    // …and the exemption list must not rot: every entry must still be a member
    // whose name genuinely fails the pattern, or it is silently widening the arm.
    const stale = Object.keys(NAME_EXEMPT).filter((e) => {
      const r = rows.find((x) => x.awarder_eik === e);
      return !r || OK.test(r.nm);
    });
    assert.deepEqual(
      stale,
      [],
      `NAME_EXEMPT entries that no longer need exempting: ${stale.join(", ")}`,
    );
  });

  test.skipIf(skip)(
    "the anti-allowlist holds, and is not vacuous",
    async () => {
      // Each is a REAL, sizeable awarder adjacent to МВР in the `1290*` range — three
      // Ministry of Justice, two intelligence services, two anti-corruption bodies.
      // Asserting they exist is what stops this arm going quiet if one is retired.
      const EXCLUDED: Record<string, string> = {
        "129010029": 'ГД „Изпълнение на наказанията" (МЮ)',
        "129009070": "Фонд затворно дело (МЮ)",
        "129010011": 'ГД „Охрана" (МЮ) — not МВР ГДОП',
        "129009710": "ДАНС",
        "129010090": "ДАТО",
        "129010997": "КПКОНПИ",
        "176073030": "ЦППКОП (към МС)",
      };
      const inSet = new Set(SECURITY_SECTOR_EIKS);
      for (const [eik, who] of Object.entries(EXCLUDED))
        assert.ok(!inSet.has(eik), `${eik} (${who}) must stay out of МВР`);

      const rows = await allRows<{ awarder_eik: string; n: string }>(
        `SELECT awarder_eik, count(*)::text AS n FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1) GROUP BY 1`,
        [Object.keys(EXCLUDED)],
      );
      const live = new Set(rows.map((r) => r.awarder_eik));
      const gone = Object.keys(EXCLUDED).filter((e) => !live.has(e));
      assert.deepEqual(
        gone,
        [],
        `anti-allowlist entries no longer in the corpus (arm going vacuous): ${gone.join(", ")}`,
      );
    },
  );

  test.skipIf(skip)("signature members carry real money", async () => {
    const FLOORS: Record<string, number> = {
      "000695235": 500_000_000, // МВР itself — €810.6M measured
      "129010125": 200_000_000, // ГД Гранична полиция — €379.0M
      "129010157": 150_000_000, // ДУССД — €309.0M
      [MEDICAL_INSTITUTE_EIK]: 80_000_000, // Мед. институт — €166.4M
    };
    const rows = await allRows<{ awarder_eik: string; eur: string }>(
      `SELECT awarder_eik, coalesce(sum(amount_eur),0)::text AS eur
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY 1`,
      [Object.keys(FLOORS)],
    );
    const by = new Map(rows.map((r) => [r.awarder_eik, Number(r.eur)]));
    for (const [eik, floor] of Object.entries(FLOORS))
      assert.ok(
        (by.get(eik) ?? 0) >= floor,
        `${eik}: €${Math.round(by.get(eik) ?? 0)} below floor €${floor}`,
      );
  });
});

describe("security sector — beneficiaries", () => {
  test.skipIf(skip)("no single contractor dominates the group", async () => {
    // 5.9% measured 2026-08-19. The ceiling is a rollup tripwire, not a forecast:
    // crediting a consortium's full value to every member would blow past it long
    // before any total looked wrong. Ranks and absolute € are deliberately NOT
    // pinned — a leaderboard is supposed to reorder.
    const [row] = await allRows<{ top: string; total: string; n: string }>(
      `WITH s AS (
         SELECT contractor_eik, sum(amount_eur) AS eur FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1)
            AND contractor_eik IS NOT NULL AND contractor_eik <> ''
            AND contractor_eik <> awarder_eik
            AND consortium_role IS DISTINCT FROM 'member'
          GROUP BY 1)
       SELECT max(eur)::text AS top, sum(eur)::text AS total, count(*)::text AS n
         FROM s`,
      [SECURITY_SECTOR_EIKS],
    );
    const share = Number(row.top) / Number(row.total);
    assert.ok(
      Number(row.n) > 500,
      `only ${row.n} contractors — corpus too thin`,
    );
    assert.ok(
      share < 0.15,
      `top contractor holds ${(share * 100).toFixed(1)}% of the group (was 5.9%)`,
    );
  });

  test.skipIf(skip)(
    "the labelled state bodies are still contractors",
    async () => {
      // The beneficiary twin of the anti-allowlist. These are the public bodies that
      // reach a displayed rank on the HHI tile; pinned by EIK, never by name, so a
      // later "clean up the leaderboard" cannot quietly turn a state transfer back
      // into an apparent private vendor.
      const STATE: Record<string, string> = {
        "831609046": "Топлофикация София ЕАД (100% Столична община)",
        "121396123": "Български пощи ЕАД (100% state)",
        "831641791": "Информационно обслужване АД (majority state)",
      };
      const rows = await allRows<{ contractor_eik: string; eur: string }>(
        `SELECT contractor_eik, coalesce(sum(amount_eur),0)::text AS eur
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
          AND contractor_eik = ANY($2) GROUP BY 1`,
        [SECURITY_SECTOR_EIKS, Object.keys(STATE)],
      );
      const by = new Map(rows.map((r) => [r.contractor_eik, Number(r.eur)]));
      for (const [eik, who] of Object.entries(STATE))
        assert.ok(
          (by.get(eik) ?? 0) > 0,
          `${eik} (${who}) no longer a contractor to МВР — re-check the curated list`,
        );
    },
  );

  test.skipIf(skip)(
    "a consortium carrier is a top МВР contractor, and is linkable",
    async () => {
      // The corpus half of the 2026-08-19 widening. `isLinkableCompanyKey` admitting
      // `obed-` is pinned as a unit test; this asserts the corpus still exercises it,
      // so a regex simplification cannot pass unit tests while de-linking the biggest
      // supplier on this page. Measured: the current parliament's top contractor is
      // `obed-76634551a3a1` at 38.5% of the window.
      const rows = await allRows<{ contractor_eik: string; eur: string }>(
        `SELECT contractor_eik, sum(amount_eur)::text AS eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
          AND contractor_eik LIKE 'obed-%'
        GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST LIMIT 5`,
        [SECURITY_SECTOR_EIKS],
      );
      assert.ok(rows.length > 0, "no obed- carrier contracts with МВР at all");
      for (const r of rows)
        assert.ok(
          isLinkableCompanyKey(r.contractor_eik),
          `${r.contractor_eik} (€${Math.round(Number(r.eur))}) is not linkable — the widening was reverted`,
        );
      assert.ok(
        Number(rows[0].eur) > 10_000_000,
        `top carrier holds only €${Math.round(Number(rows[0].eur))} — arm may be going vacuous`,
      );
    },
  );
});
