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
  SECURITY_STATE_BODY_CONTRACTORS,
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
      // ⚠ TRUTHINESS, not `!= null` — `budgetSeries` in the generator drops a €0
      // year deliberately (an un-appropriated shell, so `annual()` falls back to
      // the latest REAL year rather than captioning „бюджет 2024: €0"). Reading it
      // as a present year here would make this arm expect 0 where the generator
      // correctly published the fallback, failing on all 30 scopes at once — on
      // db:refresh's LAST link, the worst place to mint a false failure.
      if (v) byYear.set(y.fiscalYear, v);
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
    // The generator mints SCOPE_FIRST_YEAR..currentYear + one per election + `all`.
    // A floor of 20 would pass with a third of them missing.
    assert.equal(
      checked,
      Object.keys(stats).length,
      "some scope carries no security stat",
    );
    assert.ok(checked >= 28, `only ${checked} scopes checked`);
  });
});

describe("security sector — the EIK set", () => {
  test("the three copies are the same set", () => {
    const ref = new Set(SECURITY_SECTOR_EIKS);
    const dash = new Set(
      (SECTOR_DASHBOARDS.security?.members ?? []).map((m) => m.eik),
    );
    const pack = new Set(SECTOR_BROWSE_PACKS.security?.eiks ?? []);
    assert.deepEqual([...dash].sort(), [...ref].sort(), "dashboard members");
    assert.deepEqual([...pack].sort(), [...ref].sort(), "browse pack eiks");

    // ⚠ LOCKSTEP ALONE IS VACUOUS AGAINST A ROSTER LOSS, because all three copies
    // derive from MVR_ENTITIES — deleting members keeps them equal. Measured:
    // dropping 27 of 74 (every ПБЗН unit) passed all ten tests in this file, since
    // 1,279 contractors still clear the >500 floor, the top share stays at 6.4%
    // and every state body and carrier survives. So the size is pinned directly,
    // and so is the composition: a bulk deletion takes a whole universe, and the
    // two large ones are exactly where it would go unnoticed.
    assert.ok(
      SECURITY_SECTOR_EIKS.length >= 70,
      `roster is ${SECURITY_SECTOR_EIKS.length} EIKs, was 74`,
    );
    const perUniverse = new Map<string, number>();
    for (const e of MVR_ENTITIES)
      perUniverse.set(e.universe, (perUniverse.get(e.universe) ?? 0) + 1);
    assert.ok((perUniverse.get("police") ?? 0) >= 34, "police universe shrank");
    assert.ok((perUniverse.get("fire") ?? 0) >= 25, "fire universe shrank");

    // Roster shape beyond this (no duplicates, EIK format, universe labelling) is
    // src/lib/securityReferenceData.test.ts's job — it needs no database.
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
    // ⚠ „организираната престъпност" and „Академия" WERE alternatives here and are
    // deliberately gone. Both were redundant — removing them leaves 0 of the 73
    // non-exempt members failing — and both were this arm's only false-positive
    // vectors: the first admitted ЦППКОП, which this file's own anti-allowlist
    // excludes, and „Академия" admitted Военна академия, БАН and — the pointed one
    // — ВОЕННОМЕДИЦИНСКА академия, МО's military hospital, which the reference data
    // calls „the ВМА analogue" of the Мед. институт. A digit typo on 129007218
    // could have landed there and passed every arm in this file.
    const OK =
      /вътрешни(те)?\s+работи|МВР|гранична\s+полиц|национална\s+полиц|охранителна\s+полиц|криминална\s+полиц|ГДБОП|жандармер|пожарна\s+безопасност|ПБЗН|РДПБЗН|миграц|куриерска\s+служба/i;
    // ONE unit whose ЦАИС name carries no ministry token at all — a real property
    // of the corpus, not a curation slip, so it is exempted BY EIK with the name
    // that made it necessary. Exempting by pattern instead would blunt the arm for
    // the other 73. The staleness arm below is what keeps this list at one: the
    // first cut listed four, and it proved three of them (ДУССД, ДМП, ДМ) already
    // carry „МВР" in their registry name and needed no exemption. Not a claim to
    // take on trust: the staleness arm re-derives it on every run and fails on any
    // entry the pattern would have matched anyway.
    const NAME_EXEMPT: Record<string, string> = {
      "129010698": "Дирекция Комуникационни и Информационни системи (ДКИС)",
    };
    // …and a RULE for the adjacent families, beside the enumerated anti-allowlist
    // in the next test. That one names 7 EIKs; this catches a SIBLING of any of
    // them — an МЮ penitentiary unit, an intelligence service, an anti-corruption
    // body, anything към МС, anything военно. Deliberate redundancy: after
    // „организираната престъпност" and „Академия" left `OK`, ЦППКОП is now caught
    // by rule here, by name above and by enumeration below — and it took all three
    // to notice the name arm had been admitting it.
    const ADJACENT =
      /изпълнение\s+на\s+наказанията|затворно\s+дело|национална\s+сигурност|технически\s+операции|противодействие\s+на\s+корупцията|антикорупц|Министерски\s+съвет|военн/i;
    const leaked = rows.filter((r) => ADJACENT.test(r.nm));
    assert.deepEqual(
      leaked.map((r) => `${r.awarder_eik} ${r.nm}`),
      [],
      "a member reads as an МЮ / intelligence / anti-corruption / military body",
    );

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
      [MVR_EIK]: 500_000_000, // МВР itself — €810.6M measured
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
    // 5.9% measured 2026-08-19. Ranks and absolute € are deliberately NOT pinned —
    // a leaderboard is supposed to reorder.
    //
    // ⚠ THIS CEILING CANNOT SEE THE CONSORTIUM MUTATION, and an earlier version of
    // this comment claimed it could. The query excludes `consortium_role = 'member'`
    // — exactly the rows a "credit the full value to every member" change would
    // populate — so the mutation would move nothing here. That invariant is
    // assertable directly instead, and is, in the next test. What this ceiling does
    // catch is the other shape: one contractor swallowing the sector, whether by a
    // real award, a key merge, or a fold that stops splitting.
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
      // The beneficiary twin of the anti-allowlist. Pinned by EIK, never by name, so
      // a later "clean up the leaderboard" cannot quietly turn a state transfer back
      // into an apparent private vendor.
      //
      // ⚠ IMPORTS the constant rather than restating it. A hardcoded copy here would
      // cover only the entries someone remembered to duplicate — which is how the
      // list's first cut shipped three entries and needed five, with this gate green
      // throughout.
      const rows = await allRows<{ contractor_eik: string; eur: string }>(
        `SELECT contractor_eik, coalesce(sum(amount_eur),0)::text AS eur
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
          AND contractor_eik = ANY($2) GROUP BY 1`,
        [SECURITY_SECTOR_EIKS, [...SECURITY_STATE_BODY_CONTRACTORS]],
      );
      const by = new Map(rows.map((r) => [r.contractor_eik, Number(r.eur)]));
      // Five today. The floor sits at the list's own stated bar — every public body
      // that reaches a displayed rank — so dropping one back below it fails here
      // rather than quietly un-badging a state transfer.
      assert.ok(
        SECURITY_STATE_BODY_CONTRACTORS.length >= 5,
        `curated state-body list is ${SECURITY_STATE_BODY_CONTRACTORS.length}, was 5`,
      );
      for (const eik of SECURITY_STATE_BODY_CONTRACTORS)
        assert.ok(
          (by.get(eik) ?? 0) > 0,
          `${eik} no longer a contractor to МВР — re-check the curated list`,
        );
      // …and each must still be OUTSIDE the roster, or the tile drops it from
      // `stateBodies` in favour of the more specific „в групата" badge.
      for (const eik of SECURITY_STATE_BODY_CONTRACTORS)
        assert.ok(
          !SECURITY_SECTOR_EIKS.includes(eik),
          `${eik} is both a curated state body and an МВР unit`,
        );
    },
  );

  test.skipIf(skip)(
    "consortium member rows carry no money, so no rollup can double-count them",
    async () => {
      // The invariant the share ceiling above is blind to, stated where it CAN be
      // seen. 061's supplier CTE drops these rows to keep the distinct-supplier
      // count honest, and that is only safe while they are worth €0 — the moment a
      // fold starts crediting each member the full contract value, this fails and
      // the leaderboard's totals become a sum over the same money N times.
      // Corpus-wide rather than МВР-scoped: the rule belongs to the ingest.
      const [row] = await allRows<{ n: string; eur: string; nonzero: string }>(
        `SELECT count(*)::text AS n,
                coalesce(sum(amount_eur), 0)::text AS eur,
                count(*) FILTER (WHERE amount_eur <> 0)::text AS nonzero
           FROM contracts WHERE tag = 'contract' AND consortium_role = 'member'`,
      );
      assert.ok(
        Number(row.n) > 1000,
        `only ${row.n} member rows — arm going vacuous`,
      );
      assert.equal(
        Number(row.nonzero),
        0,
        "a consortium member row carries money",
      );
      assert.equal(Number(row.eur), 0, "member rows no longer sum to zero");
    },
  );

  test.skipIf(skip)(
    "intra-group circulation stays negligible, and nobody contracts with themselves",
    async () => {
      // Both are named in this file's header as "cleanliness that needs pinning"
      // and neither was pinned. They are the same row today: СДВР's own EIK landed
      // in the contractor field of a „ТОП ЕЛАНА ООД" contract (the real EIK is
      // 131555677), €14,941 — a register artifact 061 already drops from
      // `suppliers` while leaving the € in the totals.
      //
      // A ceiling rather than an equality: a genuine МВР unit buying from another
      // is possible and would be a finding, not a bug. What must not happen quietly
      // is the share becoming material — at which point „the sector procured €X"
      // stops implying an external market.
      const [row] = await allRows<{ self: string; other: string; eur: string }>(
        `SELECT count(*) FILTER (WHERE c.awarder_eik = c.contractor_eik)::text AS self,
                count(*) FILTER (WHERE c.awarder_eik <> c.contractor_eik)::text AS other,
                coalesce(sum(c.amount_eur), 0)::text AS eur
           FROM contracts c
          WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
            AND c.contractor_eik = ANY($1)`,
        [SECURITY_SECTOR_EIKS],
      );
      const [tot] = await allRows<{ eur: string }>(
        `SELECT coalesce(sum(amount_eur), 0)::text AS eur FROM contracts
          WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
        [SECURITY_SECTOR_EIKS],
      );
      assert.ok(
        Number(row.self) <= 2,
        `${row.self} self-dealing rows — the ingest artifact is spreading`,
      );
      const share = Number(row.eur) / Number(tot.eur);
      assert.ok(
        share < 0.01,
        `intra-group circulation is ${(share * 100).toFixed(2)}% of the sector`,
      );
    },
  );

  test.skipIf(skip)(
    "a consortium carrier is a top МВР contractor, and is linkable",
    async () => {
      // The corpus half of the 2026-08-19 widening. `isLinkableCompanyKey` admitting
      // `obed-` is pinned as a unit test; this asserts the corpus still exercises it,
      // so a regex simplification cannot pass unit tests while de-linking the biggest
      // supplier on this page. The query is ALL-TIME, so the floor below is an
      // all-time figure (€71.5M, obed-dc9fb761d9c6). The 38.5%-of-the-window
      // headline this audit opened with belongs to a DIFFERENT carrier on a
      // different scope; quoting it above an unwindowed query is how a floor comes
      // to be set against a number the query cannot return.
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
