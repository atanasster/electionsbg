// The /sector/transport hub's figures come from a COMMITTED artifact —
// data/transport/derived/hub_stats.json, written by
// `npm run db:gen-transport-hub-stats` — so they fail the way every
// committed-derived artifact fails: the corpus reloads underneath the file and the
// hub keeps stating the old number at a 200.
//
// This re-derives each figure and compares within a band (when one trips after an
// ordinary ingest, re-run the generator — do not widen the band). It holds the
// agreements docs/plans/transport-hub-v1.md T2 names:
//   · KPI 1 == sector_stats.json all.transport — one number, two pages;
//   · the browse every KPI links to lands on the blob's contract count;
// and asserts the REJECTED bases differ, so a regression onto one of them fails:
// the member-inclusive single-bid pair, the un-re-attributed rail share,
// fund_beneficiaries' contracted (total-project) figure, and a CPV-only voucher
// rule.
//
// Auto-skips only when Postgres is down; the committed inputs must exist.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  TRANSPORT_EIK,
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_INGROUP_CONTRACTORS,
  TRANSPORT_PUBLIC_CONTRACTOR_EIKS,
  TRANSPORT_VERIFY,
} from "@/lib/transportReferenceData";
import {
  isPsoAward,
  passThroughOf,
  directShareKnown,
} from "@/lib/transportAttributes";
import type { TransportHubStats } from "@/data/transport/hubStats";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BLOB = "data/transport/derived/hub_stats.json";
const SECTOR_STATS = "data/procurement/derived/sector_stats.json";

const { runDbTable } = createRequire(import.meta.url)(
  "../../../functions/db_table.js",
) as {
  runDbTable: (
    q: (sql: string, params: unknown[]) => Promise<unknown[]>,
    req: Record<string, unknown>,
  ) => Promise<{ total: number; aggregates?: { count?: number } }>;
};

assertCommitted(BLOB, SECTOR_STATS);

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const read = <T>(rel: string): T =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), rel), "utf8")) as T;
const blob = (): TransportHubStats => read<TransportHubStats>(BLOB);
const eiks = [...TRANSPORT_SECTOR_EIKS];

const TOLERANCE = 0.02;
const near = (actual: number, stored: number, what: string) =>
  assert.ok(
    Math.abs(actual - stored) <= Math.max(1, Math.abs(stored) * TOLERANCE),
    `${what}: database ${actual} vs blob ${stored} — re-run npm run db:gen-transport-hub-stats`,
  );

const BYTE_BUDGET = 5_120;

test("KPI 1 is sector_stats.json's transport headline, on the same basis", () => {
  const s = read<{ all: { transport: { value: number; basis: string } } }>(
    SECTOR_STATS,
  );
  assert.equal(s.all.transport.basis, "procurement");
  assert.equal(
    blob().procurement.eur,
    s.all.transport.value,
    "hub KPI 1 ≠ sector_stats all.transport — regenerate both",
  );
});

test("the blob stays inside its byte budget", () => {
  assert.ok(
    statSync(path.resolve(process.cwd(), BLOB)).size <= BYTE_BUDGET,
    "transport hub blob over budget",
  );
});

test.skipIf(skip)("KPI 1 and the ex-member pairs re-derive", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT sum(amount_eur) eur,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member' AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member' AND number_of_tenderers IS NOT NULL) known,
            count(*) FILTER (WHERE number_of_tenderers = 1) single_all,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) known_all
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  const b = blob().procurement;
  near(Number(r.eur), b.eur, "procurement.eur");
  near(Number(r.n), b.contracts, "procurement.contracts");
  near(Number(r.single), b.singleBid, "singleBid");
  near(Number(r.known), b.bidKnown, "bidKnown");
  // Rejected basis: the member-inclusive pair reads a different rate.
  assert.notEqual(
    (Number(r.single_all) / Number(r.known_all)).toFixed(3),
    (b.singleBid / b.bidKnown).toFixed(3),
    "the member-inclusive rate equals the blob's — the ex-member filter is not discriminating",
  );
});

test.skipIf(skip)(
  "every KPI link lands on the blob's contract count (B4)",
  async () => {
    const q = (sql: string, params: unknown[]) => allRows(sql, params);
    const ex = await runDbTable(q, {
      resource: "contracts",
      page: 0,
      pageSize: 1,
      filters: {
        columns: [
          { id: "tag", value: ["contract"] },
          { id: "awarder_eik", value: eiks },
          { id: "not_consortium_member", value: "member" },
        ],
      },
    });
    near(
      ex.aggregates?.count ?? ex.total,
      blob().procurement.contracts,
      "browse count",
    );
  },
);

test.skipIf(skip)(
  "the rail re-attribution moves exactly the ministry's PSO and rolling stock (D8)",
  async () => {
    const [m] = await allRows<{ moved: string; ministry: string }>(
      `SELECT sum(amount_eur) FILTER (WHERE cpv LIKE '6021%' OR cpv LIKE '346%') moved,
            sum(amount_eur) ministry
       FROM contracts WHERE tag = 'contract' AND awarder_eik = $1`,
      [TRANSPORT_EIK],
    );
    const modes = Object.fromEntries(blob().modes.map((x) => [x.universe, x]));
    near(
      modes.rail.eur - modes.rail.rawEur,
      Number(m.moved),
      "rail re-attribution",
    );
    near(modes.ministry.rawEur, Number(m.ministry), "ministry raw €");
    // Σ modes is the headline either way.
    near(
      blob().modes.reduce((a, x) => a + x.eur, 0),
      blob().procurement.eur,
      "Σ modes",
    );
    assert.ok(modes.rail.eur / blob().procurement.eur > modes.rail.rawEur / blob().procurement.eur + 0.2, "re-attribution moved almost nothing — the rule is not discriminating"); // prettier-ignore
  },
);

test.skipIf(skip)(
  "in-group € includes ТСВ ЕАД and the group's own members (D4)",
  async () => {
    const ing = TRANSPORT_INGROUP_CONTRACTORS.map((e) => e.eik);
    const [r] = await allRows<{
      eur: string;
      tsv: string;
      members_only: string;
    }>(
      `SELECT sum(amount_eur) FILTER (WHERE contractor_eik = ANY($1) OR contractor_eik = ANY($2)) eur,
            sum(amount_eur) FILTER (WHERE contractor_eik = ANY($2)) tsv,
            sum(amount_eur) FILTER (WHERE contractor_eik = ANY($1)) members_only
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [eiks, ing],
    );
    const g = blob().inGroup;
    near(Number(r.eur), g.eur, "inGroup.eur");
    near(Number(r.tsv), g.contractorEur, "inGroup.contractorEur");
    assert.notEqual(
      Math.round(Number(r.members_only)),
      g.eur,
      "ТСВ ЕАД is not in the in-group figure",
    );
  },
);

test.skipIf(skip)(
  "EU funds sit on the grant basis, not fund_beneficiaries' total (D6)",
  async () => {
    const [p] = await allRows<{ grant: string; paid: string; total: string }>(
      `SELECT sum(grant_eur) "grant", sum(paid_eur) paid, sum(total_eur) total
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
      [eiks],
    );
    const [fb] = await allRows<{ contracted: string }>(
      "SELECT sum(contracted_eur) contracted FROM fund_beneficiaries WHERE eik = ANY($1)",
      [eiks],
    );
    const f = blob().euFunds;
    near(Number(p.grant), f.grantEur, "euFunds.grantEur");
    near(Number(p.paid), f.paidEur, "euFunds.paidEur");
    near(Number(p.total), f.totalEur, "euFunds.totalEur");
    assert.ok(Math.abs(Number(fb.contracted) - f.grantEur) > f.grantEur * 0.2, "grant ≈ fund_beneficiaries contracted — the basis is not discriminating"); // prettier-ignore
  },
);

test.skipIf(skip)(
  "vouchers are matched on the title, not the CPV alone (G9)",
  async () => {
    const [r] = await allRows<{ cpv_only: string }>(
      `SELECT coalesce(sum(amount_eur), 0) cpv_only FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND cpv LIKE '30199770%'
        AND consortium_role IS DISTINCT FROM 'member'`,
      [eiks],
    );
    assert.ok(blob().passThrough.vouchers > Number(r.cpv_only) * 1.2, "the title rule finds no voucher the CPV misses — НКЖИ's 98000000 rows are back out"); // prettier-ignore
  },
);

test.skipIf(skip)("the rest of the blob re-derives from Postgres", async () => {
  const b = blob();
  const [p] = await allRows<Record<string, string | null>>(
    `SELECT min(date) first_date, max(date) last_date,
            (SELECT sum(amount_eur) FROM contracts WHERE awarder_eik = ANY($1)) all_tags
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  assert.equal(b.procurement.firstDate, p.first_date, "firstDate");
  assert.equal(b.procurement.lastDate, p.last_date, "lastDate");
  // Rejected basis: the all-tag sum includes amendments.
  assert.ok(Math.abs(Number(p.all_tags) - b.procurement.eur) > b.procurement.eur * 0.02, "KPI 1 ≈ the all-tag sum — amendments may be counted"); // prettier-ignore

  const [nat] = await allRows<{
    r: { singleBidExMembers: number; bidKnownExMembers: number };
  }>("SELECT national_competition(NULL, NULL) AS r");
  near(
    nat.r.singleBidExMembers,
    b.procurement.nationalSingleBid,
    "nationalSingleBid",
  );
  near(
    nat.r.bidKnownExMembers,
    b.procurement.nationalBidKnown,
    "nationalBidKnown",
  );

  const [ig] = await allRows<{ n: number }>(
    `SELECT count(*)::int n FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1)
        AND (contractor_eik = ANY($1) OR contractor_eik = ANY($2))
        AND consortium_role IS DISTINCT FROM 'member'`,
    [eiks, TRANSPORT_INGROUP_CONTRACTORS.map((e) => e.eik)],
  );
  near(ig.n, b.inGroup.contracts, "inGroup.contracts");

  const [pub] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') eur,
            sum(consortium_full_eur) FILTER (WHERE consortium_role = 'member') cons
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = ANY($2)`,
    [eiks, TRANSPORT_PUBLIC_CONTRACTOR_EIKS],
  );
  near(Number(pub.eur), b.publicContractors.eur, "publicContractors.eur");
  near(
    Number(pub.cons),
    b.publicContractors.consortiumEur ?? 0,
    "publicContractors.consortiumEur",
  );

  const [an] = await allRows<{ eur: string }>(
    `SELECT sum(a.value_diff_eur) eur FROM procurement_annexes a
       JOIN contracts c ON c.key = a.contract_key
      WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)`,
    [eiks],
  );
  near(Number(an.eur), b.annexGrowthEur, "annexGrowthEur");

  const rows = await allRows<{
    awarder_eik: string;
    cpv: string | null;
    title: string | null;
    amount_eur: number | null;
  }>(
    `SELECT awarder_eik, cpv, title, amount_eur::float8 amount_eur FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1)
        AND consortium_role IS DISTINCT FROM 'member'`,
    [eiks],
  );
  const pso = rows.filter((r) => isPsoAward(r.awarder_eik, r.cpv ?? undefined));
  near(
    pso.reduce((a, r) => a + Number(r.amount_eur ?? 0), 0),
    b.pso.eur,
    "pso.eur",
  );
  assert.equal(pso.length, b.pso.contracts, "pso.contracts");
  for (const kind of ["vouchers", "fuel", "electricity", "insurance"] as const)
    near(
      rows
        .filter((r) => passThroughOf(r) === kind)
        .reduce((a, r) => a + Number(r.amount_eur ?? 0), 0),
      b.passThrough[kind],
      `passThrough.${kind}`,
    );

  const methods = await allRows<{ method: string | null; totalEur: number }>(
    `SELECT procurement_method method, sum(amount_eur)::float8 "totalEur" FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) GROUP BY 1`,
    [eiks],
  );
  const d = directShareKnown(methods);
  near(d.directEur, b.direct.directEur, "direct.directEur");
  near(d.knownEur, b.direct.knownEur, "direct.knownEur");

  const bodies = await allRows<{ eik: string; eur: string }>(
    `SELECT awarder_eik eik, sum(amount_eur) eur FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1)
      GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1`,
    [eiks],
  );
  assert.deepEqual(b.topBodies.map((x) => x.eik), bodies.slice(0, b.topBodies.length).map((x) => x.eik), "topBodies order"); // prettier-ignore
  assert.equal(
    b.bodyIndex.length,
    bodies.length,
    "bodyIndex covers every body with contracts",
  );
  assert.deepEqual((b.verifyIndex ?? []).map((v) => v.eik), TRANSPORT_VERIFY.map((v) => v.eik).sort(), "verifyIndex"); // prettier-ignore

  const [m] = await allRows<{
    r: { coverage: { placedEur: number; totalEur: number } };
  }>("SELECT transport_project_map($1, NULL, NULL) AS r", [eiks]);
  near(
    m.r.coverage.placedEur,
    b.mapCoverage.placedEur,
    "mapCoverage.placedEur",
  );
  near(m.r.coverage.totalEur, b.mapCoverage.totalEur, "mapCoverage.totalEur");

  const [eu] = await allRows<{ n: number }>(
    "SELECT count(DISTINCT beneficiary_eik)::int n FROM fund_projects WHERE beneficiary_eik = ANY($1)",
    [eiks],
  );
  assert.equal(eu.n, b.euFunds.beneficiaries, "euFunds.beneficiaries");
});
