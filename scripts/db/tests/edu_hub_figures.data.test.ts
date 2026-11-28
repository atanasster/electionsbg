// The /sector/edu hub's figures come from a COMMITTED artifact —
// data/education/derived/hub_stats.json, written by
// `pnpm run db:gen-edu-hub-stats` — so they fail the way every committed-derived
// artifact fails: the corpus reloads underneath the file and the hub keeps
// stating the old number at a 200.
//
// Each figure is RE-DERIVED here from contracts / fund_projects /
// national_competition() — never read back from the blob — and compared within
// a band. When one trips after an ordinary ingest, re-run the generator; do not
// widen the band.
//
// Auto-skips only when Postgres is down; the committed blob must exist.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  EDU_ENTITIES,
  EDU_SECTOR_EIKS,
  EDU_STATE_TRANSFER_CONTRACTORS,
} from "@/lib/educationReferenceData";
import type { EduHubStats } from "@/data/edu/hubStats";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BLOB = "data/education/derived/hub_stats.json";
assertCommitted(BLOB);

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const blob = (): EduHubStats =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), BLOB), "utf8"),
  ) as EduHubStats;
const eiks = [...EDU_SECTOR_EIKS];
const EX = "consortium_role IS DISTINCT FROM 'member'";

const TOLERANCE = 0.02;
const within = (actual: number, stored: number) =>
  Math.abs(actual - stored) <= Math.max(1, Math.abs(stored) * TOLERANCE);
const near = (actual: number, stored: number, what: string) =>
  assert.ok(
    within(actual, stored),
    `${what}: database ${actual} vs blob ${stored} — re-run pnpm run db:gen-edu-hub-stats`,
  );

test.skipIf(skip)(
  "KPI 1 is the awarder-group model's total over the roster",
  async () => {
    const [r] = await allRows<{ eur: number }>(
      "SELECT (awarder_group_model($1, NULL, NULL)->>'totalEur')::float8 eur",
      [eiks],
    );
    near(r.eur, blob().procurement.eur, "procurement.eur");
  },
);

test.skipIf(skip)("the universe split sums to the headline", () => {
  const b = blob();
  const sum = b.universes.reduce((a, u) => a + u.eur, 0);
  assert.ok(
    Math.abs(sum - b.procurement.eur) <= b.universes.length,
    `universes sum ${sum} vs headline ${b.procurement.eur}`,
  );
});

test.skipIf(skip)(
  "the competition pair and the national baseline are both ex-member",
  async () => {
    const [s] = await allRows<{ single: number; known: number }>(
      `SELECT count(*) FILTER (WHERE number_of_tenderers = 1)::int single,
              count(*) FILTER (WHERE number_of_tenderers IS NOT NULL)::int known
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1) AND ${EX}`,
      [eiks],
    );
    const b = blob().procurement;
    near(s.single, b.singleBid, "procurement.singleBid");
    near(s.known, b.bidKnown, "procurement.bidKnown");
    const [n] = await allRows<{ r: Record<string, number> }>(
      "SELECT national_competition(NULL, NULL) r",
    );
    near(n.r.singleBidExMembers, b.nationalSingleBid, "nationalSingleBid");
    near(n.r.bidKnownExMembers, b.nationalBidKnown, "nationalBidKnown");
  },
);

test.skipIf(skip)(
  "the baseline check DISCRIMINATES the window (KPI 3 mutation)",
  async () => {
    // The sector pair above is all-time, so its baseline must be all-time too
    // (sector-dashboard §3: a baseline from another window can invert the sign).
    // This proves the comparison would catch a baseline taken on a different
    // window: the 2023+ national rate must fall OUTSIDE the band around the blob.
    const [n] = await allRows<{ r: Record<string, number> }>(
      "SELECT national_competition('2023-01-01', NULL) r",
    );
    const b = blob().procurement;
    assert.ok(
      !within(n.r.bidKnownExMembers, b.nationalBidKnown),
      "a 2023+ baseline is indistinguishable from the all-time one — the window check is vacuous",
    );
  },
);

test.skipIf(skip)(
  "in-group and state-transfer € are recounted from contracts",
  async () => {
    const transfer = EDU_STATE_TRANSFER_CONTRACTORS.map((c) => c.eik);
    const [r] = await allRows<{ ingroup: number; transfer: number }>(
      `SELECT coalesce(sum(amount_eur) FILTER (WHERE contractor_eik = ANY($1) AND contractor_eik <> awarder_eik), 0)::float8 ingroup,
              coalesce(sum(amount_eur) FILTER (WHERE contractor_eik = ANY($2)), 0)::float8 transfer
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [eiks, transfer],
    );
    const b = blob();
    near(r.ingroup, b.inGroup.eur, "inGroup.eur");
    near(r.transfer, b.stateTransfers.eur, "stateTransfers.eur");
    // Non-vacuity: both disclosures exist in today's corpus (A10 / A11).
    assert.ok(b.inGroup.eur > 0 && b.stateTransfers.eur > 0);
  },
);

test.skipIf(skip)(
  "a top procurement carries EVERY lot of its УНП, not only the windowed ones",
  async () => {
    const b = blob();
    const lead = b.topProcurements.find((p) => p.lots > 1);
    assert.ok(lead, "no multi-lot procurement in the blob");
    const [r] = await allRows<{ eur: number; lots: number }>(
      `SELECT sum(c.amount_eur)::float8 eur, count(*)::int lots
         FROM contracts c JOIN contracts l ON l.key = $1
        WHERE c.tag = 'contract' AND c.amount_eur IS NOT NULL AND c.${EX}
          AND c.awarder_eik = l.awarder_eik AND c.unp = l.unp`,
      [lead.key],
    );
    assert.equal(lead.lots, r.lots, "lot count");
    near(r.eur, lead.eur, "topProcurements[lead].eur");
  },
);

test.skipIf(skip)("EU funds are fund_projects on the grant basis", async () => {
  const [r] = await allRows<{ grantEur: number; projects: number }>(
    `SELECT coalesce(sum(grant_eur), 0)::float8 "grantEur", count(*)::int projects
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );
  const f = blob().euFunds;
  near(r.grantEur, f.grantEur, "euFunds.grantEur");
  near(r.projects, f.projects, "euFunds.projects");
});

test.skipIf(skip)(
  "the ИСУН programme split re-derives and sums to the EU-funds headline (T5)",
  async () => {
    const b = blob();
    const progs = b.fundsByProgramme;
    assert.ok(progs?.length, "fundsByProgramme missing — re-run the generator");
    const rows = await allRows<{
      code: string;
      grantEur: number;
      projects: number;
    }>(
      `SELECT program_code code, coalesce(sum(grant_eur), 0)::float8 "grantEur",
              count(*)::int projects
         FROM fund_projects WHERE beneficiary_eik = ANY($1) GROUP BY 1`,
      [eiks],
    );
    const db = new Map(rows.map((r) => [r.code, r]));
    assert.equal(progs.length, rows.length, "programme count");
    for (const p of progs) {
      const r = db.get(p.code);
      assert.ok(r, `${p.code} is not in fund_projects`);
      near(r.grantEur, p.grantEur, `fundsByProgramme[${p.code}].grantEur`);
      assert.equal(
        r.projects,
        p.projects,
        `fundsByProgramme[${p.code}].projects`,
      );
    }
    // A partition of the headline, on the same basis: a drift means the split
    // and the KPI read different rows.
    near(
      progs.reduce((a, p) => a + p.grantEur, 0),
      b.euFunds.grantEur,
      "Σ fundsByProgramme vs euFunds.grantEur",
    );
  },
);

test.skipIf(skip)(
  "the research arm re-derives on each of its three corpora, never summed (T5)",
  async () => {
    const arms = blob().research;
    assert.ok(
      arms?.length === 2,
      "research arm missing — re-run the generator",
    );
    const [{ agri }] = await allRows<{ agri: string | null }>(
      "SELECT to_regclass('public.agri_subsidies')::text agri",
    );
    for (const a of arms) {
      const uEiks = EDU_ENTITIES.filter((e) => e.universe === a.universe).map(
        (e) => e.eik,
      );
      assert.ok(uEiks.length, `${a.universe} has no roster EIKs`);
      const [r] = await allRows<{
        proc: number;
        procN: number;
        grant: number;
        grantN: number;
      }>(
        `SELECT (SELECT coalesce(sum(amount_eur), 0) FROM contracts
                  WHERE tag = 'contract' AND awarder_eik = ANY($1))::float8 proc,
                (SELECT count(*) FROM contracts
                  WHERE tag = 'contract' AND ${EX} AND awarder_eik = ANY($1))::int "procN",
                (SELECT coalesce(sum(grant_eur), 0) FROM fund_projects
                  WHERE beneficiary_eik = ANY($1))::float8 "grant",
                (SELECT count(*) FROM fund_projects
                  WHERE beneficiary_eik = ANY($1))::int "grantN"`,
        [uEiks],
      );
      near(r.proc, a.procurementEur, `${a.universe}.procurementEur`);
      near(
        r.procN,
        a.procurementContracts,
        `${a.universe}.procurementContracts`,
      );
      near(r.grant, a.grantEur, `${a.universe}.grantEur`);
      near(r.grantN, a.grantProjects, `${a.universe}.grantProjects`);
      if (agri == null) {
        // Not loaded here: the blob may hold a figure from a machine that had
        // it, but nothing can be checked — say so rather than pass silently.
        console.warn(
          `edu research: agri_subsidies absent, ${a.universe} payout arm unchecked`,
        );
        continue;
      }
      const [g] = await allRows<{ eur: number }>(
        `SELECT coalesce(sum(total_eur), 0)::float8 eur FROM agri_subsidies WHERE eik = ANY($1)`,
        [uEiks],
      );
      assert.ok(
        a.agriEur != null,
        `${a.universe}.agriEur is null while agri_subsidies is loaded`,
      );
      near(g.eur, a.agriEur, `${a.universe}.agriEur`);
    }
  },
);

test("the body index covers every institution exactly once", () => {
  const institutions = EDU_ENTITIES.filter((e) => !e.retiredEikOf).map(
    (e) => e.eik,
  );
  const idx = blob().bodyIndex.map((b) => b.eik);
  assert.equal(new Set(idx).size, idx.length, "duplicate body");
  for (const e of idx)
    assert.ok(institutions.includes(e), `${e} is a retired EIK in the index`);
});
