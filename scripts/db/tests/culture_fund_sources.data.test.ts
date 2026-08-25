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
// SKIPS have three causes, each named separately. Postgres being down is the
// obvious one; the other two are fresh-clone states rather than failures. The
// ДФЗ arm reads `agri_subsidies`, whose loader input is the GITIGNORED
// `raw_data/agri/` cache, and the Interreg arms read tables built from a keep.eu
// import that is not committed either — so on a clean clone with Postgres up and
// `db:refresh` run, both are legitimately empty and a red test there would name a
// remedy nobody can follow. The two ИСУН arms have no such excuse: `fund_projects`
// is loaded from a committed corpus, so an empty result there IS a failure.

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
  } catch {
    return null;
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

reportSkip(import.meta.url, skip);

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

const blob = (): Blob =>
  JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "data/culture/derived/hub_stats.json"),
      "utf8",
    ),
  ) as Blob;

const eiks = [...CULTURE_GROUP_EIKS];
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

test.skipIf(skipInterreg)(
  "each name arm's exclusions still move its number materially",
  async () => {
    const count = async (sql: string) =>
      num((await allRows<Record<string, string>>(sql))[0].n);

    // ⚠️ A MAGNITUDE FLOOR, NOT `open > guarded`. An exclusion list gutted down
    // to one near-inert term („оператив" alone) still removes a row or two, so a
    // strict-inequality assertion is satisfied by exactly the regression it is
    // supposed to catch. `culture_match.data.test.ts` uses a 10% floor against
    // its own pinned constants; these floors are set well under the measured
    // effects (ИСУН ~5%, Interreg ~12% of rows) so ordinary corpus drift cannot
    // trip them while a hollowed-out guard still does.
    const isunGuarded = await count(
      `SELECT count(*) n FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}`,
    );
    const isunOpen = await count(
      `SELECT count(*) n FROM fund_projects
        WHERE ${cultureNameSql("beneficiary_name", { withExclusions: false })}`,
    );
    const isunMove = isunOpen / Math.max(isunGuarded, 1) - 1;
    assert.ok(
      isunMove >= 0.03,
      `the ИСУН exclusions moved the number by ${(isunMove * 100).toFixed(1)}% ` +
        `(${isunOpen} vs ${isunGuarded}). Measured, they remove ~5% — „аквакултури", ` +
        `„изкуствен интелект" and the опер- family. A guard that barely moves its ` +
        `own figure has effectively stopped guarding.`,
    );

    const irGuarded = await count(
      `SELECT count(*) n FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
        WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}`,
    );
    const irOpen = await count(
      `SELECT count(*) n FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
        WHERE p.country = 'Bulgaria'
          AND ${interregThemeSql("o.title_en", { withExclusions: false })}`,
    );
    const irMove = irOpen / Math.max(irGuarded, 1) - 1;
    assert.ok(
      irMove >= 0.05,
      `the Interreg exclusions moved the number by ${(irMove * 100).toFixed(1)}% ` +
        `(${irOpen} vs ${irGuarded}). „cultur" cannot be word-anchored, so ` +
        `agriculture/aquaculture/viticulture come in on that stem alone — ` +
        `measured, ~12% of the rows.`,
    );
  },
);
