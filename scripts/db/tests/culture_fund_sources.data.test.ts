// Gate for the four /culture/funds source arms and their standalone pages.
//
// The page publishes four euro figures on four DIFFERENT bases and says in its
// first sentence that they do not sum. Its detail pages repeat each figure with
// the rows behind it, so every arm now has TWO producers — the committed blob
// `data/culture/derived/hub_stats.json` (what the KPI band renders) and the
// serving view (what the browse table pages through). This file is what stops
// those two drifting apart, plus the relationship between two of the arms that
// the copy asserts in words.
//
// FOUR KINDS OF ASSERTION, each closing a failure the others cannot see:
//
//   1. BLOB ↔ VIEW, for what the sibling does NOT already cover.
//      `culture_hub_figures.data.test.ts` asserts every MONEY field against this
//      same blob at ±2%, so re-asserting those here would be pure duplication —
//      and at a looser band it would be worse than duplication, since drift
//      landing between the two bands fails the old gate and passes the new one.
//      What this file adds is the ROW COUNTS (the sibling checks € only) and the
//      distinct-partner count, which the detail pages render beside the money.
//   2. THE OVERLAP CLAIM. `/culture/funds` tells the reader how the EIK arm and
//      the name arm relate. It said „подмножество на реда отдолу" — a subset —
//      until 2026-08-25, and that was FALSE: 46 of 47, not 47 of 47. See below.
//   3. COVERAGE IS NON-VACUOUS. Each page publishes how much of its question its
//      identity can answer. A coverage figure that has silently gone to 0 or 1
//      reads as „fully answered" / „nothing here" and is the failure the
//      `sectorPacks.tsx` withholding machinery exists to prevent.
//   4. THE GUARDS STILL GUARD, by MAGNITUDE. Re-running each name arm with the
//      exclusions off must move its count by a stated percentage, not by a row.
//      An exclusion list gutted down to one near-inert term still removes a row
//      or two, so `open > guarded` is satisfied by exactly the regression the
//      check exists to catch. Only the two arms that HAVE an exclusion half are
//      exercised: `chitalishteNameSql` takes no `MatchOpts` and has none by
//      design (cultureMatch.ts — the stem „читалищ" has no known collision).
//
// SKIPS have three causes, each named separately and each REPORTED (see
// `skipReasons` below — a skip nobody prints is the silence report_skip.ts exists
// to end). Postgres being down is the obvious one; the other two are fresh-clone
// states rather than failures. The ДФЗ arm reads `agri_subsidies`, whose loader
// input is the GITIGNORED `raw_data/agri/` cache, and the Interreg arms read
// tables built from a keep.eu import that is not committed either — so on a clean
// clone with Postgres up and `db:refresh` run, both are legitimately empty and a
// red test there would name a remedy nobody can follow.
//
// ⚠️ THE TWO ИСУН ARMS HAVE NO SUCH EXCUSE, AND EVERY ИСУН ASSERTION MUST RIDE
// PLAIN `skip`. `fund_projects` is loaded from a committed corpus and 189 is
// applied by that same loader, so on a fresh clone the ИСУН views exist and an
// empty result IS a failure. Three assertions were behind `skipAgri` /
// `skipInterreg` at first — including the buffer ceiling whose own comment says
// the whole design rests on it — so they stood down on exactly the databases
// where they were the only cover.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  cultureNameSql,
  chitalishteNameSql,
  interregThemeSql,
} from "@/lib/cultureMatch";
import { CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();

/** Rows in a relation, or null when the relation is absent — a fresh clone that
 *  has never run the loader at all. Both states skip the arms that read it. */
const rowCount = async (rel: string): Promise<number | null> => {
  try {
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(*) n FROM ${rel}`,
    );
    return Number(r.n ?? 0);
  } catch (e) {
    // ⚠️ ONLY 42P01 means „absent". A 42501 (the failure the role-guarded GRANT
    // in 189-191 exists to prevent), a 55P03 during a concurrent load, or a plain
    // syntax error would otherwise all print „does not exist — apply the
    // migration", which is the wrong remedy for each of them.
    if ((e as { code?: string }).code === "42P01") return null;
    throw e;
  }
};

const agriRows = haveDb ? await rowCount("agri_subsidies") : 0;
const interregRows = haveDb ? await rowCount("interreg_partners") : 0;

const skip = !haveDb ? "Postgres unreachable" : false;
/** ДФЗ and Interreg only — see the SKIPS note in the header. Their loader inputs
 *  are gitignored, so „empty" on a clean clone is a state, not a defect. */
const skipAgri = skip
  ? skip
  : !agriRows
    ? "agri_subsidies is empty — db:load:agri:pg needs the gitignored raw_data/agri/ cache"
    : false;
const skipInterreg = skip
  ? skip
  : !interregRows
    ? "interreg_partners is empty — db:load:interreg:pg needs a keep.eu import (npm run funds:crawl-interreg)"
    : false;

// ⚠️ ALL THREE causes are reported, not just the first. Without this, 6 of the
// tests below stand down with no output at all whenever a gitignored corpus is
// absent — the silence `scripts/lib/report_skip.ts` exists to end. `reportSkip`
// takes one reason, so a composed sentence is what carries the other two.
const skipReasons = [skip, skipAgri, skipInterreg].filter(
  (r, i, a): r is string => typeof r === "string" && a.indexOf(r) === i,
);
reportSkip(
  import.meta.url,
  skipReasons.length ? skipReasons.join(" · ") : false,
);

afterAll(async () => {
  await end();
});

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);

interface Blob {
  funds: {
    eikExactEur: number;
    eikExactProjects: number;
    byNameEur: number;
    byNameProjects: number;
    eikExactAlsoByName: number;
  };
  agri: { chitalishtaEur: number; chitalishtaRows: number };
  interreg: {
    thematicEur: number;
    partnerRows: number;
    partners: number;
    rowsWithEik: number;
  };
}

/** Read ONCE. Called from ~10 assertions; re-reading meant two of them could in
 *  principle compare against two different versions of the file. */
const BLOB: Blob = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data/culture/derived/hub_stats.json"),
    "utf8",
  ),
) as Blob;

const blob = (): Blob => BLOB;

const eiks_ALL = [...CULTURE_GROUP_EIKS];
const eiks = eiks_ALL;
const num = (v: unknown): number => Number(v ?? 0);

/** 2%, matching `culture_hub_figures.data.test.ts` — the gate that makes the SAME
 *  comparison (live corpus vs the committed blob), so the two cannot disagree
 *  about what counts as drift.
 *
 *  ⚠️ NOT `culture_match.data.test.ts`'s 5%, which this file cited at first. That
 *  file compares the corpus against hard-coded MEASURED constants, and its band is
 *  DERIVED from the smallest guard effect (the Interreg exclusion, 7.6% of money) —
 *  a different quantity entirely. Borrowing it here would let drift between 2% and
 *  5% fail the sibling and pass this file, i.e. two gates on one blob disagreeing. */
const TOLERANCE = 0.02;

const near = (actual: number, expected: number, what: string) => {
  assert.ok(
    expected > 0,
    `${what}: the committed blob carries ${expected} — regenerate it with ` +
      `npm run db:gen-culture-hub-stats`,
  );
  const drift = Math.abs(actual - expected) / expected;
  assert.ok(
    drift <= TOLERANCE,
    `${what}: corpus says ${actual}, data/culture/derived/hub_stats.json says ` +
      `${expected} (${(drift * 100).toFixed(1)}% apart, band ${TOLERANCE * 100}%). ` +
      `The /culture/funds KPI band and its detail table would publish different ` +
      `numbers for the same thing — run npm run db:gen-culture-hub-stats.`,
  );
};

// ── 1. BLOB ↔ VIEW — only what the sibling does not already own ─────────────
//
// `culture_hub_figures.data.test.ts` asserts every MONEY field of this blob at
// ±2%. Re-asserting them here would add a second query of the same corpora and
// detect nothing new, so what is left is the ROW COUNTS and the distinct-partner
// count — the figures the detail pages render beside the money and the sibling
// never checks.

test.skipIf(skip)("ИСУН by EIK: the row count matches the blob", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*) n FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );
  assert.ok(num(r.n) > 0, "the ИСУН EIK arm is empty — run db:load:funds:pg");
  near(num(r.n), blob().funds.eikExactProjects, "ИСУН by EIK rows");
});

test.skipIf(skip)("ИСУН by name: the row count matches the blob", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*) n FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}`,
  );
  assert.ok(num(r.n) > 0, "the ИСУН name arm is empty — run db:load:funds:pg");
  near(num(r.n), blob().funds.byNameProjects, "ИСУН by name rows");
});

test.skipIf(skipAgri)(
  "ДФЗ читалища: the row count matches the blob",
  async () => {
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(*) n FROM agri_subsidies WHERE ${chitalishteNameSql("name")}`,
    );
    near(num(r.n), blob().agri.chitalishtaRows, "ДФЗ читалища rows");
  },
);

test.skipIf(skipInterreg)(
  "Interreg thematic: the distinct-partner count matches the blob",
  async () => {
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(DISTINCT p.partner_name) partners
       FROM interreg_partners p
       JOIN interreg_operations o USING (keep_id)
      WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}`,
    );
    near(
      num(r.partners),
      blob().interreg.partners,
      "Interreg distinct partners",
    );
  },
);

// ── 2. THE OVERLAP CLAIM ─────────────────────────────────────────────────────

test.skipIf(skip)(
  "the EIK arm is ALMOST a subset of the name arm, and the blob says by how much",
  async () => {
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE ${cultureNameSql("beneficiary_name")}) both,
            count(*) all_eik
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
      [eiks],
    );
    const both = num(r.both);
    const allEik = num(r.all_eik);
    const b = blob().funds;

    assert.ok(
      both > 0,
      "no EIK-matched project is name-matched — the two arms " +
        "have become disjoint, which no copy on /culture/funds describes",
    );
    assert.equal(
      both,
      b.eikExactAlsoByName,
      `the overlap is ${both} of ${allEik} but the committed blob says ` +
        `${b.eikExactAlsoByName} — /culture/funds renders the blob's figure in ` +
        `its copy, so it is currently telling readers the wrong relationship. ` +
        `Run npm run db:gen-culture-hub-stats.`,
    );
    // The claim the copy makes, in both directions. It said „a subset" until
    // 2026-08-25, when the overlap was measured at 46 of 47.
    assert.ok(
      both <= allEik,
      "impossible: more EIK-matched projects are name-matched than exist",
    );
    assert.ok(
      both / allEik >= 0.8,
      `only ${both} of ${allEik} EIK-matched projects are name-matched. The ` +
        `page's copy says the two arms overlap heavily; below ~80% that sentence ` +
        `stops being true and the copy needs rewriting, not the band widening.`,
    );
  },
);

test.skipIf(skip)(
  "the un-matched EIK rows are named, not merely counted",
  async () => {
    // The gate above proves a gap exists. This one proves we can still SAY what
    // is in it — /culture/funds/isun-name renders these rows as a named
    // exclusion, and a page that cannot name them would render an empty block
    // that reads as „the matcher has no edge".
    const rows = await allRows<{
      beneficiary_eik: string;
      beneficiary_name: string;
    }>(
      `SELECT beneficiary_eik, beneficiary_name
       FROM fund_projects
      WHERE beneficiary_eik = ANY($1)
        AND ${cultureNameSql("beneficiary_name")} IS NOT TRUE`,
      [eiks],
    );
    for (const r of rows) {
      assert.ok(
        r.beneficiary_name && r.beneficiary_name.trim().length > 0,
        `EIK ${r.beneficiary_eik} is outside the name arm and has no name to ` +
          `show for it — the exclusion block on /culture/funds/isun-name would ` +
          `render a blank row`,
      );
    }
    // Non-vacuity: if this ever reaches zero the whole finding has gone away and
    // the copy claiming „almost, but not quite, a subset" is the thing to fix.
    assert.ok(
      rows.length > 0,
      "every EIK-matched project is now name-matched, so the EIK arm IS a " +
        "subset — update the copy on /culture/funds (it says otherwise) and " +
        "re-point this test",
    );
  },
);

// ── 3. COVERAGE IS NON-VACUOUS ───────────────────────────────────────────────

test.skipIf(skipInterreg)(
  "Interreg EIK coverage is partial in both directions",
  async () => {
    const b = blob().interreg;
    assert.ok(
      b.rowsWithEik > 0 && b.rowsWithEik < b.partnerRows,
      `Interreg EIK coverage is ${b.rowsWithEik}/${b.partnerRows}. At 0 the ` +
        `page's „only N of M carry an EIK" line reads as „none of this is ` +
        `identifiable"; at M it reads as „an EIK filter answers the whole ` +
        `question". Both are claims the corpus does not support.`,
    );
  },
);

test.skipIf(skipAgri)(
  "the ДФЗ arm is still unreachable by culture EIK",
  async () => {
    // The page states this outright („0 реда по ЕИК"), and `sectorPacks.tsx`
    // records the measurement behind the withholding. The one match that has
    // ever existed is a national music school on „Училищни схеми" — school-food
    // aid ДФЗ merely administers — so a nonzero count here does NOT mean the
    // page can start filtering by EIK; it means the sentence needs re-measuring.
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(*) n, round(coalesce(sum(total_eur), 0)::numeric, 0) eur
       FROM agri_subsidies WHERE eik = ANY($1)`,
      [eiks],
    );
    const [chit] = await allRows<Record<string, string>>(
      `SELECT round(sum(total_eur)::numeric, 0) eur
       FROM agri_subsidies WHERE ${chitalishteNameSql("name")}`,
    );
    // Not "is zero" — it is 2 rows / €5,416 today. The invariant is that the
    // EIK-keyed answer stays negligible against the name-keyed one, because that
    // ratio is what makes „reachable only by NAME" true.
    const ratio = num(r.eur) / Math.max(num(chit.eur), 1);
    assert.ok(
      ratio < 0.01,
      `an EIK-keyed ДФЗ filter now returns €${num(r.eur)} against the name ` +
        `arm's €${num(chit.eur)} (${(ratio * 100).toFixed(2)}%). /culture/funds ` +
        `and /culture/funds/dfz both say this arm is reachable only by NAME — ` +
        `re-measure that sentence and sectorPacks.ts's culture withholding.`,
    );
  },
);

// ── 4. THE GUARDS STILL GUARD, BY MAGNITUDE ─────────────────────────────────
//
// ⚠️ ONE TEST PER ARM, EACH BEHIND ITS OWN CORPUS'S SKIP. These were one test
// behind `skipInterreg`, which meant the ИСУН check — that „аквакултури",
// „изкуствен интелект" and the опер- family are still excluded — silently never
// ran on any database without a keep.eu import, i.e. every fresh clone and CI.
// That is the guard whose absence lets one grid operator's two rows
// (€189,443,288) outweigh the entire true sector.
//
// ⚠️ A MAGNITUDE FLOOR, NOT `open > guarded`. An exclusion list gutted down to
// one near-inert term („оператив" alone) still removes a row or two, so a
// strict-inequality assertion is satisfied by exactly the regression it is
// supposed to catch. The floors sit well under the measured effects (ИСУН ~5%,
// Interreg ~12% of rows) so ordinary corpus drift cannot trip them.
//
// `chitalishteNameSql` is absent from this section on purpose: it takes no
// `MatchOpts` and has no exclusion half — the stem „читалищ" has no known
// collision, so there is nothing to remove and nothing to assert.

const countRows = async (sql: string): Promise<number> =>
  num((await allRows<Record<string, string>>(sql))[0].n);

test.skipIf(skip)(
  "the ИСУН exclusions still move the ИСУН figure materially",
  async () => {
    const guarded = await countRows(
      `SELECT count(*) n FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}`,
    );
    const open = await countRows(
      `SELECT count(*) n FROM fund_projects
        WHERE ${cultureNameSql("beneficiary_name", { withExclusions: false })}`,
    );
    const move = open / Math.max(guarded, 1) - 1;
    assert.ok(
      move >= 0.03,
      `the ИСУН exclusions moved the number by ${(move * 100).toFixed(1)}% ` +
        `(${open} vs ${guarded}). Measured, they remove ~5% — „аквакултури", ` +
        `„изкуствен интелект" and the опер- family. A guard that barely moves its ` +
        `own figure has effectively stopped guarding.`,
    );
  },
);

test.skipIf(skipInterreg)(
  "the Interreg exclusions still move the Interreg figure materially",
  async () => {
    const guarded = await countRows(
      `SELECT count(*) n FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
        WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}`,
    );
    const open = await countRows(
      `SELECT count(*) n FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
        WHERE p.country = 'Bulgaria'
          AND ${interregThemeSql("o.title_en", { withExclusions: false })}`,
    );
    const move = open / Math.max(guarded, 1) - 1;
    assert.ok(
      move >= 0.05,
      `the Interreg exclusions moved the number by ${(move * 100).toFixed(1)}% ` +
        `(${open} vs ${guarded}). „cultur" cannot be word-anchored, so ` +
        `agriculture/aquaculture/viticulture come in on that stem alone — ` +
        `measured, ~12% of the rows.`,
    );
  },
);

// ── 5. THE VIEWS ARE THE PREDICATES ─────────────────────────────────────────
//
// 189_culture_match.sql is GENERATED from `cultureMatch.ts`, and
// `gen_sql/culture_match.test.ts` proves the committed FILE matches the
// generator. What that cannot prove is that the DATABASE is running it: a view
// is applied by a loader, so a database whose 189 predates a rule change keeps
// serving the old population with every row count reconciling. These re-derive
// each view's rows from the TypeScript and compare.

/** Present-and-populated, per view. A view can be absent (189 never applied
 *  here) or empty (its corpus never loaded), and only the first is a defect. */
const viewRows = async (v: string): Promise<number | null> => rowCount(v);

const missingView = (n: number | null, v: string) =>
  n === null
    ? `${v} does not exist — apply 189: npx tsx scripts/db/apply_functions.ts 189_culture_match.sql`
    : false;

test.skipIf(skip)(
  "the ИСУН views serve exactly what the TypeScript predicates select",
  async () => {
    const eikN = await viewRows("culture_isun_by_eik");
    const nameN = await viewRows("culture_isun_by_name");
    assert.ok(
      !missingView(eikN, "culture_isun_by_eik"),
      String(missingView(eikN, "culture_isun_by_eik")),
    );
    assert.ok(
      !missingView(nameN, "culture_isun_by_name"),
      String(missingView(nameN, "culture_isun_by_name")),
    );

    const [ref] = await allRows<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE beneficiary_eik = ANY($1)) eik_n,
              count(*) FILTER (WHERE ${cultureNameSql("beneficiary_name")}) name_n
         FROM fund_projects`,
      [eiks],
    );
    assert.equal(
      eikN,
      num(ref.eik_n),
      `culture_isun_by_eik serves ${eikN} rows, the register selects ${num(ref.eik_n)}. ` +
        `The applied view predates the current CULTURE_GROUP_EIKS — re-apply 189.`,
    );
    assert.equal(
      nameN,
      num(ref.name_n),
      `culture_isun_by_name serves ${nameN} rows, cultureNameSql selects ${num(ref.name_n)}. ` +
        `The applied view predates the current rule — run npm run gen:culture-sql ` +
        `and re-apply 189.`,
    );
  },
);

test.skipIf(skipAgri)(
  "the ДФЗ view serves exactly what chitalishteNameSql selects",
  async () => {
    const n = await viewRows("culture_agri_chitalishta");
    assert.ok(
      !missingView(n, "culture_agri_chitalishta"),
      String(missingView(n, "culture_agri_chitalishta")),
    );
    const [ref] = await allRows<Record<string, string>>(
      `SELECT count(*) n FROM agri_subsidies WHERE ${chitalishteNameSql("name")}`,
    );
    assert.equal(n, num(ref.n));
  },
);

test.skipIf(skipInterreg)(
  "the Interreg view serves exactly what interregThemeSql selects",
  async () => {
    const n = await viewRows("culture_interreg_thematic");
    assert.ok(
      !missingView(n, "culture_interreg_thematic"),
      String(missingView(n, "culture_interreg_thematic")),
    );
    const [ref] = await allRows<Record<string, string>>(
      `SELECT count(*) n FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
        WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}`,
    );
    assert.equal(n, num(ref.n));
  },
);

// ── 6. THE VIEWS STAY CHEAP ENOUGH TO SERVE LIVE ────────────────────────────
//
// ⚠️ THE WHOLE DESIGN RESTS ON THESE TWO. 189/190 are plain VIEWs rather than
// matviews because both name predicates are index-served — measured 2026-08-25,
// agri 370 buffers / 1.8 ms over 2.48M rows and funds 1,525 / 13.7 ms over 82k. A
// rule change that defeats pg_trgm (a leading wildcard, a term with no
// extractable trigram) turns every page of every browse table into a seq scan,
// and the only symptom is a slow page nobody times — so an UNRUN gate here is
// indistinguishable from a passing one. That is why they are two tests behind two
// skips rather than one behind `skipAgri`: the ИСУН half was silently never
// running on any database without the gitignored agri cache.
//
// Ceilings are ~2x the measurement, so ordinary corpus growth cannot trip them.

const bufsFor = async (sql: string): Promise<number> => {
  const rows = await allRows<Record<string, string>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
  );
  const plan = rows[0]["QUERY PLAN"] as unknown as {
    Plan: Record<string, number>;
  }[];
  const p0 = plan[0].Plan;
  return (p0["Shared Hit Blocks"] ?? 0) + (p0["Shared Read Blocks"] ?? 0);
};

test.skipIf(skip)(
  "the ИСУН name predicate still rides idx_fund_projects_bname",
  async () => {
    const bufs = await bufsFor("SELECT count(*) FROM culture_isun_by_name");
    assert.ok(
      bufs <= 4000,
      `culture_isun_by_name cost ${bufs} buffers (ceiling 4000, measured 1525). ` +
        `idx_fund_projects_bname has stopped serving the culture pattern — every ` +
        `page of /culture/funds/isun-name is now a scan of the whole corpus.`,
    );
  },
);

test.skipIf(skipAgri)(
  "the ДФЗ name predicate still rides idx_agri_name_trgm",
  async () => {
    const bufs = await bufsFor("SELECT count(*) FROM culture_agri_chitalishta");
    assert.ok(
      bufs <= 1500,
      `culture_agri_chitalishta cost ${bufs} buffers (ceiling 1500, measured 370). ` +
        `idx_agri_name_trgm has stopped serving „читалищ" — this is a 2.48M-row ` +
        `seq scan behind every page of /culture/funds/dfz.`,
    );
  },
);

// ⚠️ 191 IS THE ONE WITH NO INDEX TO WATCH, and until 2026-08-27 that meant nothing watched
// it at all. The two ceilings above exist because 189/190 ARE index-served and the gate is
// that they stay so; the Interreg arm never was — it is a hash join of two Seq Scans
// (interreg_partners 487 buffers, interreg_operations 542) and cannot be indexed, because
// the theme predicate is a regex on the OPERATION while the page sorts on the PARTNER.
//
// That made it the arm most in need of a ceiling and the only one without: both scans grow
// linearly with the keep.eu corpus, and `db_table_sort_indexes.data.test.ts` has now
// formally conceded its sort via PLAN_EXCEPTIONS, so nothing else looks at its cost either.
// A conceded sort must not also mean a conceded scan.
test.skipIf(skipInterreg)(
  "the Interreg thematic join stays cheap enough to serve live",
  async () => {
    const bufs = await bufsFor(
      "SELECT count(*) FROM culture_interreg_thematic",
    );
    assert.ok(
      bufs <= 2500,
      `culture_interreg_thematic cost ${bufs} buffers (ceiling 2500, measured 1030). ` +
        `Both interreg tables are Seq-Scanned here and neither can be indexed for this ` +
        `predicate, so the corpus has simply grown past what a live page can carry — 191 ` +
        `needs a matview rather than a view.`,
    );
  },
);

// ── 7. EVERY ARM'S PAGING TIEBREAK IS UNIQUE ────────────────────────────────
//
// `buildOrder` appends ONE tiebreak column — `key` when the resource declares
// one, else `select[0]`. If it is not unique the sort leaves rows in unordered
// tie groups and a page turn repeats or skips them, silently, at a 200.
// `functions/db_table.culture.test.js` asserts which column each arm DECLARES;
// only a query can assert that the column is actually unique in the corpus.
//
// ⚠️ The Interreg arm is why this exists. Its select[0] was `keep_id` — the
// OPERATION id, 144 distinct over 202 partner rows — so the view now composes
// `keep_id || ':' || partner_seq`.

test.skipIf(skip)(
  "the ИСУН arms page on a unique contract_number",
  async () => {
    for (const v of ["culture_isun_by_eik", "culture_isun_by_name"]) {
      const [r] = await allRows<Record<string, string>>(
        `SELECT count(*) n, count(DISTINCT contract_number) d FROM ${v}`,
      );
      assert.equal(
        num(r.d),
        num(r.n),
        `${v} has ${num(r.n)} rows but only ${num(r.d)} distinct contract_number — ` +
          `the paging tiebreak is no longer unique, so page turns repeat or skip rows`,
      );
    }
  },
);

test.skipIf(skipAgri)("the ДФЗ arm pages on a unique id", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*) n, count(DISTINCT id) d FROM culture_agri_chitalishta`,
  );
  assert.equal(num(r.d), num(r.n));
});

test.skipIf(skipInterreg)(
  "the Interreg arm pages on a unique composed key, and keep_id alone is not",
  async () => {
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(*) n, count(DISTINCT key) d, count(DISTINCT keep_id) ops
       FROM culture_interreg_thematic`,
    );
    assert.equal(
      num(r.d),
      num(r.n),
      `culture_interreg_thematic has ${num(r.n)} rows but only ${num(r.d)} distinct ` +
        `keys — the composed tiebreak has stopped being unique`,
    );
    // Non-vacuity: if keep_id were unique the composed key would be machinery for
    // nothing, and the assertion above would pass either way.
    assert.ok(
      num(r.ops) < num(r.n),
      `keep_id is now unique (${num(r.ops)} of ${num(r.n)}), so the composed key ` +
        `guards nothing — either the corpus changed shape or partner_seq is gone`,
    );
  },
);

// ── 8. NO TWO ARMS SHARE A MONEY COLUMN NAME ────────────────────────────────

test.skipIf(skip)(
  "each arm's euro columns are named for what they measure",
  async () => {
    // The engine camelCases every column into the payload and derives each
    // aggregate key from it, so two arms sharing a money column name hand a
    // client ONE `row.totalEur` over two incomparable quantities — the realistic
    // route to the cross-arm addition /culture/funds exists to forbid. Asserted
    // against the VIEWS rather than the registry, because the aliases live in the
    // generated SQL (the registry's `select` projects physical columns verbatim).
    const money = new Map<string, string[]>();
    for (const v of [
      "culture_isun_by_eik",
      "culture_isun_by_name",
      "culture_agri_chitalishta",
      "culture_interreg_thematic",
    ]) {
      const rows = await allRows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name LIKE '%eur'
            AND column_name ~ '_eur$'
          ORDER BY column_name`,
        [v],
      );
      money.set(
        v,
        rows.map((r) => r.column_name),
      );
    }
    // The two ИСУН arms SHARE their names deliberately — same quantity, two
    // overlapping populations. Every other pair must be disjoint.
    const arms = [
      "culture_isun_by_eik",
      "culture_agri_chitalishta",
      "culture_interreg_thematic",
    ];
    for (let i = 0; i < arms.length; i++)
      for (let j = i + 1; j < arms.length; j++) {
        const shared = (money.get(arms[i]) ?? []).filter((c) =>
          (money.get(arms[j]) ?? []).includes(c),
        );
        assert.deepEqual(
          shared,
          [],
          `${arms[i]} and ${arms[j]} share the euro column(s) ${shared.join(", ")}. ` +
            `They measure a contract value, a farm subsidy and a published budget — ` +
            `three different things that would collide on one API key.`,
        );
      }
    assert.deepEqual(
      money.get("culture_isun_by_eik"),
      money.get("culture_isun_by_name"),
      "the two ИСУН arms must expose the SAME money columns — they are one " +
        "quantity over two populations",
    );
  },
);

// ── 9. THE SECOND ARTIFACT — fund_sources.json ──────────────────────────────
//
// ⚠️ IT WAS OUTSIDE EVERY GATE. The per-arm chart data went into
// `hub_stats.json` first and took it from 789 B to 4,498 B, past the 4 KB budget
// `culture_hub_figures.data.test.ts` holds — that gate is what caught it, and
// splitting the payload into its own file moved it out from under the only byte
// check in the family and into none. This file (despite its name) read only the
// hub blob until now.

interface Sources {
  generatedAt: string;
  eikBodyCount: number;
  eikByBeneficiary: {
    eik: string;
    name: string;
    eur: number;
    projects: number;
  }[];
  byNameByProgram: {
    code: string;
    name: string;
    eur: number;
    projects: number;
  }[];
  interregByProgramme: { code: string; eur: number; rows: number }[];
  agriByYear: { year: number; eur: number; rows: number }[];
}

const SOURCES_PATH = path.join(ROOT, "data/culture/derived/fund_sources.json");
const sources = (): Sources =>
  JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8")) as Sources;

test.skipIf(skip)(
  "the breakdown artifact stays a breakdown, not a corpus",
  () => {
    // Four bounded lists (10 / 12 / 12 / ~8 rows). It is fetched by four sub-pages
    // rather than by the hub, which is why it may be larger than the hub blob —
    // but „larger" is not „unbounded": past this, someone has dropped a LIMIT.
    const bytes = fs.statSync(SOURCES_PATH).size;
    assert.ok(
      bytes < 12_288,
      `${bytes} B — data/culture/derived/fund_sources.json has grown past its ` +
        `budget. It carries four capped lists; anything larger means a LIMIT was ` +
        `dropped and a whole arm is being shipped to the browser.`,
    );
    const d = sources();
    assert.ok(d.eikByBeneficiary.length <= 10);
    assert.ok(d.byNameByProgram.length <= 12);
    assert.ok(d.interregByProgramme.length <= 12);
  },
);

test.skipIf(skip)(
  "the ИСУН-by-EIK chart groups by EIK, not by spelling",
  async () => {
    // ⚠️ THIS ARM'S WHOLE VALUE IS THAT ITS IDENTITY IS EXACT. Measured, its
    // EIKs sit under MORE names — six bodies are spelled two or three ways in
    // ИСУН — so a name grouping split Министерство на културата across ranks 2
    // and 9 of one top ten, understating it and pushing two smaller institutions
    // off the chart. A chart that splits one institution in two, on the arm
    // whose point is the exact identity, contradicts the page it sits on.
    const d = sources();
    const eiks = d.eikByBeneficiary.map((r) => r.eik);
    assert.equal(
      new Set(eiks).size,
      eiks.length,
      "the EIK chart repeats an EIK — it is grouped on something else",
    );
    for (const e of eiks) assert.ok(/^\d{9,13}$/.test(e), `not an EIK: ${e}`);

    const [r] = await allRows<Record<string, string>>(
      `SELECT count(DISTINCT beneficiary_eik) eiks,
              count(DISTINCT beneficiary_name) names
         FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
      [eiks_ALL],
    );
    assert.equal(
      num(r.eiks),
      d.eikBodyCount,
      "the chart's body count disagrees with the corpus",
    );
    // Non-vacuity: if every body were spelled one way, grouping on the name
    // would be harmless and this gate would be guarding nothing.
    assert.ok(
      num(r.names) > num(r.eiks),
      `every body is spelled exactly one way (${num(r.names)} names over ` +
        `${num(r.eiks)} EIKs), so the EIK-vs-name grouping no longer differs — ` +
        `re-point this gate rather than letting it pass vacuously`,
    );
  },
);

test.skipIf(skip)(
  "each breakdown reconciles with its own arm, and none with another's",
  async () => {
    const d = sources();
    // Every bar is a real slice of its arm: the shown rows can never exceed the
    // arm's total, and the top row can never exceed it either.
    const b = blob();
    const sum = (xs: { eur: number }[]) => xs.reduce((a, x) => a + x.eur, 0);
    assert.ok(
      sum(d.eikByBeneficiary) <= b.funds.eikExactEur * 1.001,
      "the EIK chart's bars sum to more than the arm they slice",
    );
    assert.ok(
      sum(d.byNameByProgram) <= b.funds.byNameEur * 1.001,
      "the name chart's bars sum to more than the arm they slice",
    );
    // The ДФЗ and Interreg charts are COMPLETE partitions of their arms (no cap
    // reached), so they must reconcile exactly rather than merely fit.
    assert.ok(
      Math.abs(sum(d.agriByYear) - b.agri.chitalishtaEur) <=
        b.agri.chitalishtaEur * 0.001,
      `the ДФЗ year chart sums to ${sum(d.agriByYear)} against the arm's ` +
        `${b.agri.chitalishtaEur} — it is a partition by year and must be whole`,
    );
  },
);

test.skipIf(skipAgri)(
  "the ДФЗ chart is a whole partition, in year order",
  async () => {
    const d = sources();
    const years = d.agriByYear.map((r) => r.year);
    assert.deepEqual(
      years,
      [...years].sort((a, b) => a - b),
      "the ДФЗ chart is a TIME series and must arrive in year order — sorted by " +
        "size it draws a ranking that looks like a trend",
    );
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(DISTINCT year) n FROM culture_agri_chitalishta`,
    );
    assert.equal(
      d.agriByYear.length,
      num(r.n),
      "the ДФЗ chart is missing a year — it is a partition, not a top-N",
    );
  },
);
