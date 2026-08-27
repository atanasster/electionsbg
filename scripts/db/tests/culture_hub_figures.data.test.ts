// The /culture hub's figures come from a COMMITTED artifact —
// data/culture/derived/hub_stats.json, written by `npm run db:gen-culture-hub-stats`
// from Postgres — so the way they go wrong is the way every committed-derived
// artifact goes wrong: the corpus reloads underneath the file and the page keeps
// serving the previous vintage at a 200, with nothing red anywhere.
//
// That is not hypothetical for this family. `hub_stats.json` and
// `sector_stats.json` drifted exactly that way from 2026-06 to 2026-08-04, when
// nothing in the repo ran them.
//
// This gate re-derives every field from the database the generator would read
// and compares. It is the only thing between a corpus reload and a hub that
// states, in large type, a number that stopped being true.
//
// It asserts a BAND, not equality: an ordinary ingest moves these by fractions of
// a percent, and a gate that fails on every reload gets deleted. When one trips,
// re-run the generator — do not widen the band.
//
// Auto-skips ONLY when Postgres is down. A MISSING artifact is a skip too (a
// fresh clone has never run the generator); a PRESENT but stale one is a failure.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";
import {
  chitalishteNameSql,
  cultureNameSql,
  interregThemeSql,
} from "@/lib/cultureMatch";
import type { CultureHubStats } from "@/data/culture/hubStats";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const ARTIFACT = path.resolve(
  process.cwd(),
  "data/culture/derived/hub_stats.json",
);

const haveDb = await dbReachable();
const haveFile = existsSync(ARTIFACT);
const skip = !haveDb
  ? "Postgres unreachable"
  : !haveFile
    ? "data/culture/derived/hub_stats.json absent — run db:gen-culture-hub-stats"
    : false;
reportSkip(import.meta.url, skip);

const blob = (): CultureHubStats =>
  JSON.parse(readFileSync(ARTIFACT, "utf8")) as CultureHubStats;

afterAll(async () => {
  await end();
});

const TOLERANCE = 0.02;

const near = (actual: number, stored: number, what: string) => {
  assert.ok(
    stored > 0,
    `${what}: the committed blob stores ${stored} — a zero is a claim, and the ` +
      `generator refuses to write one. Re-run npm run db:gen-culture-hub-stats.`,
  );
  assert.ok(
    Math.abs(actual - stored) / actual <= TOLERANCE,
    `${what}: Postgres says ${actual.toLocaleString()}, the committed blob says ` +
      `${stored.toLocaleString()} (±${TOLERANCE * 100}%). The corpus moved under ` +
      `the artifact — re-run npm run db:gen-culture-hub-stats and commit it.`,
  );
};

const eiks = () => [...CULTURE_GROUP_EIKS];

// OUTSIDE any gate, deliberately — these are COMMITTED, so absence is a broken
// working copy rather than a supported state. See scripts/lib/assert_committed.ts.
//
// `overview.json` is the second one: the films clause reads it directly (it is what the
// PRERENDER interpolates the same figures from), and every assertion that touches it sits
// behind `skip`. Without this, a working copy missing it stands down as one more
// database-less skip instead of saying the tree is broken.
assertCommitted(
  "data/culture/derived/hub_stats.json",
  "data/culture/overview.json",
);

test.skipIf(skip)("the procurement figures match the corpus", async () => {
  const b = blob();
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(amount_eur)::numeric, 0) eur,
            count(DISTINCT awarder_eik) buyers,
            count(DISTINCT contractor_eik) suppliers,
            count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks()],
  );
  near(Number(r.n), b.procurement.contracts, "contract count");
  near(Number(r.eur), b.procurement.eur, "contract money");
  near(Number(r.buyers), b.procurement.buyers, "procuring institutions");
  // „42 държавни институции" was written into the hub's META DESCRIPTION as a
  // literal and survived the move to the blob — the one frozen figure left on
  // the page, in the same sentence as the interpolated НФЦ ones. The copy no
  // longer names it; this keeps the stored value sane anyway, since the
  // procurement tile's secondary line renders it.
  //
  // ⚠️ DERIVED FROM THE REGISTER, never a hard-coded band. The band was
  // `> 30 && < 60`, written when the register declared 45 EIKs and ~42
  // procured. The 2026-08-19 ДКИ rulings took it to 63 declared / 59 procuring —
  // one short of failing a gate that had no business failing on a correct
  // addition. A ceiling that has to be edited every time the roster legitimately
  // grows is a gate people learn to widen without reading.
  const declared = CULTURE_GROUP_EIKS.length;
  assert.ok(
    b.procurement.buyers > declared * 0.5 && b.procurement.buyers <= declared,
    `the procuring-institution count is ${b.procurement.buyers} against ` +
      `${declared} declared in CULTURE_GROUP_EIKS. Above the roll-up size is ` +
      `impossible; far below it means most of the register stopped procuring — ` +
      `either way check culture_register.data.test.ts first.`,
  );
  near(Number(r.suppliers), b.procurement.suppliers, "distinct suppliers");
  near(Number(r.sb), b.procurement.singleBid, "single-bid contracts");
  near(Number(r.bk), b.procurement.bidKnown, "bid-known contracts");
});

test.skipIf(skip)(
  "the national baseline rides with the sector rate",
  async () => {
    // The tile's claim is „typical, not exceptional" — a COMPARISON. Storing the
    // sector rate without its baseline would let the page assert an indictment of
    // something entirely ordinary, so both numerators and denominators are stored
    // un-divided and both are checked.
    const b = blob();
    const [n] = await allRows<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk
       FROM contracts WHERE tag = 'contract'`,
    );
    near(Number(n.sb), b.procurement.nationalSingleBid, "national single-bid");
    near(Number(n.bk), b.procurement.nationalBidKnown, "national bid-known");
    const sector = b.procurement.singleBid / b.procurement.bidKnown;
    const national =
      b.procurement.nationalSingleBid / b.procurement.nationalBidKnown;
    assert.ok(
      Math.abs(sector - national) * 100 < 5,
      `culture is now ${((sector - national) * 100).toFixed(1)} points from the ` +
        `national single-bid rate; the tile copy still says „типично, не изключение"`,
    );
  },
);

test.skipIf(skip)(
  "the risk grades match, and there is still no E or F",
  async () => {
    const b = blob();
    const rows = await allRows<{ grade: string; n: string }>(
      `SELECT r.grade, count(*) n
       FROM contracts c JOIN contract_risk_cache r ON r.key = c.key
      WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
      GROUP BY 1`,
      [eiks()],
    );
    // BOTH directions. Iterating the PG rows alone leaves a grade that is in the
    // blob and no longer in the corpus uncompared — the blob would keep
    // publishing a bucket that has emptied.
    const pg = new Map(rows.map((r) => [r.grade, Number(r.n)]));
    const grades = new Set([...pg.keys(), ...Object.keys(b.risk.grades)]);
    for (const g of grades) {
      const live = pg.get(g);
      const stored = b.risk.grades[g];
      assert.ok(
        live !== undefined,
        `the blob stores ${stored} contracts at grade ${g}, and the corpus now ` +
          `has none — re-run npm run db:gen-culture-hub-stats`,
      );
      assert.ok(
        stored !== undefined,
        `the corpus has ${live} contracts at grade ${g} and the blob stores ` +
          `none — re-run npm run db:gen-culture-hub-stats`,
      );
      near(live as number, stored as number, `grade ${g}`);
    }
    const bad = rows.filter((r) => r.grade === "E" || r.grade === "F");
    assert.deepEqual(
      bad.map((x) => x.grade),
      [],
      "the culture corpus now has E/F contracts; the risk tile's ?grade=C,D link " +
        "omits them and its copy says there are none",
    );
  },
);

test.skipIf(skip)("the two funds bases match, and stay distinct", async () => {
  const b = blob();
  const [exact] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks()],
  );
  const [byName] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}`,
  );
  near(Number(exact.eur), b.funds.eikExactEur, "ИСУН EIK-exact money");
  near(Number(byName.eur), b.funds.byNameEur, "ИСУН name-matched money");
  // ⚠️ NOT a subset relation, and this comment claimed it was until 2026-08-25.
  // Measured, 46 of the EIK arm's 47 projects are also name-matched — the 47th
  // (ЕИК 000669802, a national art school whose name carries no culture stem) is
  // in the register and outside the name rule. So the assertion below is about
  // MAGNITUDE only: the name arm is much the larger of two heavily-overlapping
  // populations, and an inversion means one of them is being computed over the
  // wrong rows. `culture_fund_sources.data.test.ts` owns the overlap itself.
  assert.ok(
    b.funds.eikExactEur < b.funds.byNameEur,
    `the EIK-exact ИСУН figure (${b.funds.eikExactEur}) is no longer below the ` +
      `name-matched one (${b.funds.byNameEur}) — the name arm reaches a far ` +
      `wider population and should dominate it`,
  );
});

test.skipIf(skip)("the читалища arms match, in both corpora", async () => {
  const b = blob();
  const [isun] = await allRows<Record<string, string>>(
    `SELECT round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE ${chitalishteNameSql("beneficiary_name")}`,
  );
  const [agri] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(total_eur)::numeric, 0) eur
       FROM agri_subsidies WHERE ${chitalishteNameSql("name")}`,
  );
  near(Number(isun.eur), b.funds.chitalishtaEur, "ИСУН читалища money");
  near(Number(agri.eur), b.agri.chitalishtaEur, "ДФЗ читалища money");
  near(Number(agri.n), b.agri.chitalishtaRows, "ДФЗ читалища rows");
});

test.skipIf(skip)(
  "the Interreg thematic arm matches, with its coverage",
  async () => {
    const b = blob();
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(*) n, count(p.eik) with_eik,
            count(DISTINCT p.partner_name) partners,
            round(sum(p.budget_eur)::numeric, 0) eur
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
      WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}`,
    );
    near(Number(r.eur), b.interreg.thematicEur, "Interreg thematic money");
    near(Number(r.n), b.interreg.partnerRows, "Interreg partner rows");
    // The COVERAGE is as load-bearing as the money: an EIK-keyed surface answers
    // only for the rows that carry one, and a figure published without this number
    // silently drops the rest. If it ever reached 100% the page's „about a fifth"
    // caveat would become false.
    near(
      Number(r.with_eik),
      b.interreg.rowsWithEik,
      "Interreg rows with an EIK",
    );
    assert.ok(
      b.interreg.rowsWithEik < b.interreg.partnerRows,
      `every Interreg partner row now carries an EIK (${b.interreg.rowsWithEik}/` +
        `${b.interreg.partnerRows}) — /culture/funds still says only about a fifth do`,
    );
  },
);

test.skipIf(skip)("the director count matches", async () => {
  const b = blob();
  const [r] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT person_id) n FROM person_role
      WHERE role = 'cultural_institute'`,
  );
  near(Number(r.n), b.people.culturalInstituteRoles, "culture-institute roles");
});

test.skipIf(skip)("the artifact is small enough to be a hub blob", () => {
  // The whole point of a precomputed blob is that the hub does not pay for it.
  const bytes = readFileSync(ARTIFACT).byteLength;
  assert.ok(
    bytes < 4096,
    `${bytes} B — the culture hub blob has grown past its budget. It carries ~15 ` +
      `headline numbers; anything larger means a per-row payload crept in.`,
  );
});

test.skipIf(skip)(
  "the ministry budget matches the corpus, on the documented cross-year basis",
  async () => {
    const b = blob().budget;
    if (!b) {
      reportSkip(
        import.meta.url,
        "the blob predates the budget cell — re-run npm run db:gen-culture-hub-stats",
      );
      return;
    }

    const [row] = await allRows<Record<string, string | null>>(
      `SELECT f.fiscal_year::text AS y,
              round(coalesce(f.planned_law_eur, f.planned_eur))::text AS eur,
              round(f.planned_eur)::text AS plain,
              (f.planned_law_eur IS NOT NULL)::text AS restated
         FROM budget_admin_node n
         JOIN budget_admin_fact f
           ON f.node_id = n.node_id AND f.kind = 'expenditure'
        WHERE n.node_id = 'admin-ministerstvo-na-kulturata'
          -- 153's PK is (fiscal_year, node_id, kind, dimension) and its header warns that
          -- 'admin' is constant only TODAY: by-economic exists on disk unloaded and
          -- shares this table, so without the filter ORDER BY ... LIMIT 1 picks
          -- arbitrarily the day it lands. by-economic keys on eco-* ids, so it cannot
          -- collide with this node yet — this is insurance, not a live defect.
          AND f.dimension = 'admin'
          AND coalesce(f.planned_law_eur, f.planned_eur) > 0
        ORDER BY f.fiscal_year DESC
        LIMIT 1`,
    );
    assert.ok(row, "МК has no expenditure row — db:load:budget:pg has not run");

    assert.equal(b.fiscalYear, Number(row.y), "the blob's fiscal year drifted");
    near(Number(row.eur), b.eur, "МК expenditure");

    // ⚠️ THIS CLAUSE REPLACES ONE THAT COMPARED THE GENERATOR'S `CASE` TO ITSELF. The blob
    // used to carry a `basis: 'law' | 'projected'` derived from `planned_law_eur IS NULL`,
    // and this gate re-executed that same CASE character-for-character and asserted the two
    // agreed — which they always would. What it could not see is that the RULE was wrong:
    // 153's column comments make `planned_eur` the ЗДБ figure and `planned_law_eur` a
    // marker for „an Отчет restated this at a WIDER scope", so the flag labelled the budget
    // law a forecast. The field is gone; what is asserted now is the property the head's
    // caption („по закона за бюджета") actually rests on.
    assert.equal(
      row.restated,
      "false",
      `МК ${row.y} now carries planned_law_eur — the figure has moved to the Отчет's wider ` +
        `scope. That is still the budget act, so the caption holds, but the SERIES is no ` +
        `longer like-for-like with the other years; re-read 153's planned_law_eur comment.`,
    );
    assert.equal(
      b.eur,
      Number(row.plain),
      "the blob's figure is not МК's own planned_eur — the coalesce picked something else",
    );

    // Non-vacuity for the clause above: it only means something while the restated form is
    // genuinely rare. Measured 2026-08-26: 1 of 401 expenditure rows corpus-wide.
    const [spread] = await allRows<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE planned_law_eur IS NOT NULL)::text AS restated,
              count(*)::text AS total
         FROM budget_admin_fact WHERE kind = 'expenditure'`,
    );
    assert.ok(
      Number(spread.restated) / Number(spread.total) < 0.1,
      `${spread.restated} of ${spread.total} expenditure rows are Отчет-restated — the ` +
        `„rare exception" this gate assumes no longer holds`,
    );
  },
);

test.skipIf(skip)("the film totals match the source the PRERENDER uses", () => {
  const f = blob().films;
  if (!f) {
    reportSkip(
      import.meta.url,
      "the blob predates the films cell — re-run npm run db:gen-culture-hub-stats",
    );
    return;
  }

  // ⚠️ AGAINST data/culture/overview.json SPECIFICALLY, because that is the file the
  // PRERENDER interpolates the same figures from. Deriving them in the generator from
  // some other table would give the head one number and the indexed HTML another for
  // one claim — the split-brain the blob exists to end.
  const overview = JSON.parse(
    readFileSync("data/culture/overview.json", "utf8"),
  ) as {
    totalEur: number;
    filmCount: number;
    firstYear: number;
    lastYear: number;
  };

  assert.equal(f.eur, overview.totalEur, "film € drifted from overview.json");
  assert.equal(f.films, overview.filmCount, "film count drifted");
  assert.equal(f.firstYear, overview.firstYear);
  assert.equal(f.lastYear, overview.lastYear);

  // The band prints this span; a single-year window would mean the „accumulated over
  // more than a decade" half of the streams note has stopped being true.
  assert.ok(
    f.lastYear > f.firstYear,
    "the film window collapsed to one year — re-read the streams note before shipping",
  );
});

test.skipIf(skip)("the four band streams are genuinely incommensurable", () => {
  // ⚠️ THE NON-VACUITY BEHIND THE WHOLE HEAD. The band's note claims the four figures
  // cannot be added because one is a single fiscal year and three accumulate. If that
  // ever stopped being true the note would be false copy rather than a caveat — so it is
  // asserted rather than assumed, from the blob's own windows.
  const b = blob();
  if (!b.budget || !b.films) {
    // Reported rather than returned bare: ~170 files in this repo used to compute a precise
    // skip reason and throw it away, which is what report_skip.ts exists to end. A test that
    // reads green having asserted nothing must say why.
    reportSkip(
      import.meta.url,
      "the blob predates the budget/films cells — re-run npm run db:gen-culture-hub-stats",
    );
    return;
  }

  // The film window's own length is asserted by the test above (`lastYear > firstYear`);
  // what THIS clause uniquely contributes is that procurement predates the budget year, so
  // the two are not accidentally the same window.
  assert.ok(
    b.procurement.firstDate !== null &&
      Number(b.procurement.firstDate.slice(0, 4)) < b.budget.fiscalYear,
    "procurement no longer predates the budget year — re-read the streams note",
  );
});

test.skipIf(skip)(
  "the evidence rail ranks the same corpus the band counts",
  async () => {
    const rows = blob().topBuyers;
    // ⚠️ ABSENT AND EMPTY ARE DIFFERENT, and reading them as one is how this gate would go
    // green on the state it exists to catch. `undefined` means the blob predates the rail —
    // a legitimate vintage. `[]` means the generator RAN and produced nothing, which is a
    // rail that will refuse to render on a sector holding €166.9m of contracts.
    if (rows === undefined) {
      reportSkip(
        import.meta.url,
        "the blob predates the topBuyers rail — re-run npm run db:gen-culture-hub-stats",
      );
      return;
    }
    assert.ok(
      rows.length > 0,
      "topBuyers is EMPTY, not absent — the generator ran and ranked nothing. The aside " +
        "will refuse to render on a sector with a nine-figure procurement corpus.",
    );

    // The generator's filter, written out rather than imported — a gate re-running the
    // generator's own SQL can only prove the file was freshly written (this file's header).
    // It is deliberately the SAME filter the procurement band cell uses: if the two ever
    // diverge, the head's two halves count different populations of „culture contracts".
    const want = await allRows<Record<string, string>>(
      `SELECT awarder_eik AS eik, round(sum(amount_eur)::numeric, 0)::text AS eur,
              count(*)::text AS n
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY awarder_eik
        ORDER BY sum(amount_eur) DESC, awarder_eik
        LIMIT 5`,
      [eiks()],
    );
    assert.equal(
      want.length,
      5,
      "fewer than five buyers — every comparison below would be trivially satisfiable",
    );

    assert.deepEqual(
      rows.map((r) => r.eik),
      want.map((r) => r.eik),
      "the rail is not the sector's top five buyers — check its filter and sort",
    );
    for (const [i, r] of rows.entries()) {
      near(Number(want[i].eur), r.eur, `rail row ${i} (${r.eik})`);
      assert.equal(
        r.contracts,
        Number(want[i].n),
        `rail row ${i} count drifted`,
      );
    }

    // ⚠️ THE ROWS MUST BE A PART OF THE BAND'S FIGURE, not a different total about the same
    // subject. This is the clause that would catch a rail whose filter drifted off
    // `tag = 'contract'` or off the roster — both of which produce a plausible ranking of
    // plausible institutions that simply does not belong to the € printed above it.
    const railTotal = rows.reduce((a, r) => a + r.eur, 0);
    assert.ok(
      railTotal <= blob().procurement.eur,
      `the rail's five buyers total ${railTotal} against a band figure of ` +
        `${blob().procurement.eur} — the two are counting different corpora`,
    );

    // ⚠️ AND THE MINISTRY MUST STILL BE IN IT, because the basis line says so in words. The
    // roster spans МК, its funders and the institutes, so МК appears as a BUYER of its own
    // contracts; if it ever left the top five, the sentence „списъкът включва самото
    // министерство, което е и най-големият възложител" becomes false copy.
    assert.equal(
      rows[0].eik,
      "000695160",
      "МК is no longer the largest buyer — the rail's basis line says it is, in words",
    );
  },
);
