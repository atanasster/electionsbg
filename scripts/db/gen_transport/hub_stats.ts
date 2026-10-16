// `npm run db:gen-transport-hub-stats` → data/transport/derived/hub_stats.json,
// the /sector/transport hub's KPI band, body rail, finder index and band figures
// (docs/plans/transport-hub-v1.md T2). The shape is TransportHubStats
// (src/data/transport/hubStats.ts).
//
// Inputs are Postgres only: contracts, procurement_annexes, fund_projects,
// transport_project_link (through transport_project_map()), national_competition()
// and awarder_group_model(). Its slot in db:refresh is after
// db:load:transport-facility-map:pg — which itself follows
// db:load:transport-project-map:pg, so the map's coverage is the current vintage —
// and its KPI 1 must equal sector_stats.json all.transport (db:gen-sector-stats
// runs much earlier in the chain).
//
// The mode split, the PSO key, the pass-through rule and the direct share run the
// SAME functions the sub-pages run (src/lib/transportAttributes.ts) rather than
// restating them in SQL, so the hub and the page it links to cannot disagree.

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import {
  TRANSPORT_EIK,
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_INGROUP_CONTRACTORS,
  TRANSPORT_PUBLIC_CONTRACTOR_EIKS,
  TRANSPORT_VERIFY,
  transportEntityByEik,
  transportUniverseOf,
} from "../../../src/lib/transportReferenceData";
import {
  reattributedModes,
  isPsoAward,
  passThroughOf,
  directShareKnown,
} from "../../../src/lib/transportAttributes";
import type { GroupModelPayload } from "../../../src/lib/awarderModel";
import type { TransportHubStats } from "../../../src/data/transport/hubStats";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/transport/derived/hub_stats.json");

/** Every relation a figure reads, and the db:refresh step that fills it. */
const INPUTS: Record<string, string> = {
  contracts: "db:load:pg",
  procurement_annexes: "db:load:annexes:pg",
  fund_projects: "db:load:funds:pg",
  transport_project_link: "db:load:transport-project-map:pg",
};

/** How many bodies the evidence rail shows, and segments the finder indexes. */
const RAIL = 5;
const FINDER_SEGMENTS = 12;

const num = (v: unknown): number => Number(v ?? 0);
const round = (v: number): number => Math.round(v);

const skipWith = async (why: string, fix: string): Promise<never> => {
  // Skip-and-warn, never abort db:refresh: the committed blob stays as it is.
  warnSkip("transport hub_stats", why, fix);
  await end();
  process.exit(0);
};

const main = async () => {
  const t0 = Date.now();
  const missing = await missingRelations(Object.keys(INPUTS));
  if (missing.length)
    await skipWith(
      `missing relation(s): ${missing.map((m) => `${m} (${INPUTS[m]})`).join(", ")}`,
      "Run the loader(s) named in brackets, or the whole chain: npm run db:refresh",
    );
  if (await isEmpty("contracts"))
    await skipWith(
      "contracts is empty (db:load:pg)",
      "Load the procurement corpus first: npm run db:load:pg",
    );

  const eiks = [...TRANSPORT_SECTOR_EIKS];
  const ingroup = TRANSPORT_INGROUP_CONTRACTORS.map((e) => e.eik);

  const [proc] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'
                               AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'
                               AND number_of_tenderers IS NOT NULL) known,
            min(date) first_date, max(date) last_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  // Absent serving functions skip (a fresh clone mid-chain); a PRESENT
  // national_competition() without the ex-member keys is refused outright — every
  // count on the hub is ex-member, and a mixed-basis blob is worse than none
  // (the gen_roads/hub_stats.ts rule).
  const [fns] = await allRows<{ ok: boolean }>(
    `SELECT to_regprocedure('national_competition(text,text)') IS NOT NULL
        AND to_regprocedure('awarder_group_model(text[],text,text)') IS NOT NULL
        AND to_regprocedure('transport_project_map(text[],text,text)') IS NOT NULL AS ok`,
  );
  if (!fns?.ok)
    await skipWith(
      "national_competition(), awarder_group_model() or transport_project_map() is absent",
      "Apply 167_national_competition.sql and 061_awarder_group_model.sql, and run db:load:transport-project-map:pg",
    );
  const [nat] = await allRows<{
    r: { singleBidExMembers?: number; bidKnownExMembers?: number };
  }>("SELECT national_competition(NULL, NULL) AS r");
  if (nat?.r?.bidKnownExMembers == null)
    throw new Error(
      "national_competition() lacks the ex-member keys — re-apply 167_national_competition.sql; refusing to write a mixed-basis blob",
    );
  const [gm] = await allRows<{ r: GroupModelPayload }>(
    "SELECT awarder_group_model($1, NULL, NULL) AS r",
    [eiks],
  );
  const ministryByCpv = await allRows<{ cpv: string; totalEur: number }>(
    `SELECT coalesce(cpv, '') cpv, sum(amount_eur)::float8 "totalEur"
       FROM contracts WHERE tag = 'contract' AND awarder_eik = $1 GROUP BY 1`,
    [TRANSPORT_EIK],
  );

  const raw = new Map<string, number>();
  for (const u of gm.r.byUnit) {
    const uni = transportUniverseOf(u.eik);
    if (uni) raw.set(uni, (raw.get(uni) ?? 0) + u.totalEur);
  }
  const modes = reattributedModes(gm.r.byUnit, ministryByCpv).map((m) => ({
    universe: m.universe,
    eur: round(m.eur),
    rawEur: round(raw.get(m.universe) ?? 0),
  }));

  const [intra] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur, count(*) n,
            sum(amount_eur) FILTER (WHERE contractor_eik = ANY($2)) contractor_eur
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1)
        AND (contractor_eik = ANY($1) OR contractor_eik = ANY($2))
        AND consortium_role IS DISTINCT FROM 'member'`,
    [eiks, ingroup],
  );
  // Direct awards to a public contractor, plus — un-summed, a different basis —
  // the FULL value of consortia it was a member of (a member row carries €0 and
  // the consortium's value in consortium_full_eur; the carrier's obed- key matches
  // no public EIK). Български пощи's voucher consortium lives only in the second.
  const [pub] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') eur,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
            sum(consortium_full_eur) FILTER (WHERE consortium_role = 'member') consortium_eur
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = ANY($2)`,
    [eiks, TRANSPORT_PUBLIC_CONTRACTOR_EIKS],
  );
  const [annex] = await allRows<{ eur: string | null }>(
    `SELECT sum(a.value_diff_eur) eur
       FROM procurement_annexes a JOIN contracts c ON c.key = a.contract_key
      WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)`,
    [eiks],
  );

  // Row-level rules (PSO, pass-through) run in Node, over the same rows.
  const rows = await allRows<{
    awarder_eik: string;
    cpv: string | null;
    title: string | null;
    amount_eur: number | null;
  }>(
    `SELECT awarder_eik, cpv, title, amount_eur::float8 amount_eur
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
        AND consortium_role IS DISTINCT FROM 'member'`,
    [eiks],
  );
  const pso = { eur: 0, contracts: 0 };
  const passThrough = { vouchers: 0, fuel: 0, electricity: 0, insurance: 0 };
  for (const r of rows) {
    const eur = num(r.amount_eur);
    if (isPsoAward(r.awarder_eik, r.cpv ?? undefined)) {
      pso.eur += eur;
      pso.contracts++;
    }
    const kind = passThroughOf(r);
    if (kind) passThrough[kind] += eur;
  }

  const direct = directShareKnown(gm.r.byMethod);

  const byBody = await allRows<{ eik: string; eur: string }>(
    `SELECT awarder_eik eik, sum(amount_eur) eur
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
      GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1`,
    [eiks],
  );

  const verify = await allRows<{ eik: string; eur: string | null }>(
    `SELECT v.eik, sum(c.amount_eur) eur
       FROM unnest($1::text[]) v(eik)
       LEFT JOIN contracts c ON c.awarder_eik = v.eik AND c.tag = 'contract'
      GROUP BY 1 ORDER BY 1`,
    [TRANSPORT_VERIFY.map((v) => v.eik)],
  );

  const [map] = await allRows<{
    r: {
      segments: { aTown: string; bTown: string; totalEur: number }[];
      coverage?: { placedEur: number; totalEur: number };
    };
  }>("SELECT transport_project_map($1, NULL, NULL) AS r", [eiks]);
  if (!map?.r?.coverage)
    await skipWith(
      "transport_project_map() returns no coverage",
      "Re-run db:load:transport-project-map:pg (applies 076)",
    );

  const [eu] = await allRows<Record<string, string | null>>(
    `SELECT count(DISTINCT beneficiary_eik) beneficiaries,
            sum(grant_eur) grant_eur, sum(paid_eur) paid, sum(total_eur) total
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );

  const out: TransportHubStats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    procurement: {
      eur: round(num(proc.eur)),
      contracts: num(proc.n),
      singleBid: num(proc.single),
      bidKnown: num(proc.known),
      nationalSingleBid: num(nat.r.singleBidExMembers),
      nationalBidKnown: num(nat.r.bidKnownExMembers),
      firstDate: proc.first_date ?? null,
      lastDate: proc.last_date ?? null,
    },
    modes,
    inGroup: {
      eur: round(num(intra.eur)),
      contracts: num(intra.n),
      contractorEur: round(num(intra.contractor_eur)),
    },
    publicContractors: {
      eur: round(num(pub.eur)),
      contracts: num(pub.n),
      consortiumEur: round(num(pub.consortium_eur)),
    },
    annexGrowthEur: round(num(annex.eur)),
    pso: { eur: round(pso.eur), contracts: pso.contracts },
    passThrough: {
      vouchers: round(passThrough.vouchers),
      fuel: round(passThrough.fuel),
      electricity: round(passThrough.electricity),
      insurance: round(passThrough.insurance),
    },
    direct: { directEur: round(direct.directEur), knownEur: round(direct.knownEur) }, // prettier-ignore
    topBodies: byBody.slice(0, RAIL).map((b) => ({
      eik: b.eik,
      name: transportEntityByEik(b.eik)?.name ?? b.eik,
      eur: round(num(b.eur)),
    })),
    bodyIndex: byBody.map((b) => ({ eik: b.eik, eur: round(num(b.eur)) })),
    verifyIndex: verify.map((v) => ({ eik: v.eik, eur: round(num(v.eur)) })),
    topSegments: map.r.segments.slice(0, FINDER_SEGMENTS).map((s) => ({
      aTown: s.aTown,
      bTown: s.bTown,
      eur: round(s.totalEur),
    })),
    mapCoverage: {
      placedEur: round(map.r.coverage!.placedEur),
      totalEur: round(map.r.coverage!.totalEur),
    },
    euFunds: {
      beneficiaries: num(eu.beneficiaries),
      grantEur: round(num(eu.grant_eur)),
      paidEur: round(num(eu.paid)),
      totalEur: round(num(eu.total)),
    },
  };

  // The re-attribution only moves money between modes: a drift here means the
  // group model and the contracts sum read different rows (061 rounds each unit
  // to the euro, so ≤ €0.5 per unit is rounding).
  const modeTotal = out.modes.reduce((s, m) => s + m.eur, 0);
  if (Math.abs(modeTotal - out.procurement.eur) > gm.r.byUnit.length / 2 + 1)
    throw new Error(
      `mode split €${modeTotal} ≠ headline €${out.procurement.eur} — awarder_group_model has drifted from contracts`,
    );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(
    `transport hub_stats: ${fs.statSync(OUT).size} B → ${path.relative(ROOT, OUT)} in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(1)}s`,
  );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
