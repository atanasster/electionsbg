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
  // The EIK-exact set is a strict SUBSET. If that inverts, one of the two is
  // being computed over the wrong population and a surface will render one as
  // the other — they are ~56% apart.
  assert.ok(
    b.funds.eikExactEur < b.funds.byNameEur,
    `the EIK-exact ИСУН figure (${b.funds.eikExactEur}) is no longer below the ` +
      `name-matched one (${b.funds.byNameEur}) — it must be a subset`,
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
