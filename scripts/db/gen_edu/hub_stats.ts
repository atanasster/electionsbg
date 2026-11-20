// `pnpm run db:gen-edu-hub-stats` → data/education/derived/hub_stats.json, the
// /sector/edu hub's KPI band, body rail, finder index and band figures
// (docs/plans/edu-hub-v1.md T2). The shape is EduHubStats (src/data/edu/hubStats.ts).
//
// Inputs are Postgres only: contracts, fund_projects, national_competition() (167),
// and agri_subsidies (db:load:agri:pg) for the research arm's payout basis —
// optional: absent, that arm is null rather than the blob being refused.
// Its slot in db:refresh is right after db:gen-transport-hub-stats — well after
// db:load:pg and db:load:funds:pg, its two loaders — beside the other sector hubs.
//
// Every competition pair is on the EX-consortium-member basis (167's
// `…ExMembers` keys) so the sector side and the national side count the same rows.
// The roster's retired EIKs (`retiredEikOf`) are folded into their successor for
// every PER-INSTITUTION figure; the totals are unaffected (the € is disjoint).

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import {
  EDU_ENTITIES,
  EDU_SECTOR_EIKS,
  EDU_LEAD_EIK,
  EDU_VERIFY,
  EDU_ADJACENT,
  EDU_STATE_TRANSFER_CONTRACTORS,
  educationEntityByEik,
  educationUniverseOf,
} from "../../../src/lib/educationReferenceData";
import { groupByProcurement } from "../../../src/lib/procurementLots";
import type { EduHubStats } from "../../../src/data/edu/hubStats";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/education/derived/hub_stats.json");

const INPUTS: Record<string, string> = {
  contracts: "db:load:pg",
  fund_projects: "db:load:funds:pg",
};

const RAIL = 5;
const TOP_CONTRACTORS = 10;
const TOP_PROCUREMENTS = 10;
/** Rows scanned to CHOOSE the top procurements. The chosen groups are then
 *  re-fetched whole, so a small lot outside this window still counts (review
 *  FINDING-001: A14's sixth lot, €1.46M, sat outside it). */
const PROCUREMENT_ROWS = 60;
/** CPV prefixes of a regulated NETWORK supply — the A12 marker: electricity
 *  (0931), steam/heat (0932), natural gas (09123), utilities (65), telecoms
 *  (642). NOT the whole of 09: motor fuels (091x) are an open market (review
 *  FINDING-002, €73.3M of the old 09 share). */
const UTILITY_CPV = ["0931", "0932", "09123", "65", "642"];

const num = (v: unknown): number => Number(v ?? 0);
const round = (v: number): number => Math.round(v);

/** A retired EIK's successor, else itself. */
const institutionOf = (eik: string): string =>
  EDU_ENTITIES.find((e) => e.eik === eik)?.retiredEikOf ?? eik;

const skipWith = async (why: string, fix: string): Promise<never> => {
  warnSkip("edu hub_stats", why, fix);
  await end();
  process.exit(0);
};

const main = async () => {
  const t0 = Date.now();
  const missing = await missingRelations(Object.keys(INPUTS));
  if (missing.length)
    await skipWith(
      `missing relation(s): ${missing.map((m) => `${m} (${INPUTS[m]})`).join(", ")}`,
      "Run the loader(s) named in brackets, or the whole chain: pnpm run db:refresh",
    );
  if (await isEmpty("contracts"))
    await skipWith(
      "contracts is empty (db:load:pg)",
      "Load the procurement corpus first: pnpm run db:load:pg",
    );
  const [fns] = await allRows<{ ok: boolean }>(
    "SELECT to_regprocedure('national_competition(text,text)') IS NOT NULL AS ok",
  );
  if (!fns?.ok)
    await skipWith(
      "national_competition() is absent",
      "Apply 167_national_competition.sql",
    );
  const [nat] = await allRows<{
    r: { singleBidExMembers?: number; bidKnownExMembers?: number };
  }>("SELECT national_competition(NULL, NULL) AS r");
  if (nat?.r?.bidKnownExMembers == null)
    throw new Error(
      "national_competition() lacks the ex-member keys — re-apply 167_national_competition.sql; refusing to write a mixed-basis blob",
    );

  const eiks = [...EDU_SECTOR_EIKS];
  const EX = "consortium_role IS DISTINCT FROM 'member'";

  const [proc] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur,
            count(*) FILTER (WHERE ${EX}) n,
            count(*) FILTER (WHERE ${EX} AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE ${EX} AND number_of_tenderers IS NOT NULL) known,
            count(*) FILTER (WHERE ${EX} AND amount_eur IS NULL) null_amount,
            min(date) first_date, max(date) last_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );

  const byAwarder = await allRows<{
    eik: string;
    eur: string | null;
    n: string;
    single: string;
    known: string;
  }>(
    `SELECT awarder_eik eik, sum(amount_eur) eur,
            count(*) FILTER (WHERE ${EX}) n,
            count(*) FILTER (WHERE ${EX} AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE ${EX} AND number_of_tenderers IS NOT NULL) known
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
      GROUP BY 1`,
    [eiks],
  );

  const uni = new Map<string, EduHubStats["universes"][number]>();
  const inst = new Map<string, number>();
  for (const a of byAwarder) {
    const u = educationUniverseOf(a.eik);
    if (!u) continue;
    const cur = uni.get(u) ?? { universe: u, eur: 0, contracts: 0, singleBid: 0, bidKnown: 0 }; // prettier-ignore
    cur.eur += num(a.eur);
    cur.contracts += num(a.n);
    cur.singleBid += num(a.single);
    cur.bidKnown += num(a.known);
    uni.set(u, cur);
    const i = institutionOf(a.eik);
    inst.set(i, (inst.get(i) ?? 0) + num(a.eur));
  }
  const universes = [...uni.values()]
    .map((u) => ({ ...u, eur: round(u.eur) }))
    .sort((a, b) => b.eur - a.eur);
  const bodies = [...inst.entries()]
    .map(([eik, eur]) => ({ eik, eur: round(eur) }))
    .sort((a, b) => b.eur - a.eur || a.eik.localeCompare(b.eik));

  const byYear = await allRows<{ year: string; eur: string | null; n: string }>(
    `SELECT left(date, 4) AS year, sum(amount_eur) eur, count(*) FILTER (WHERE ${EX}) n
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1) AND date IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [eiks],
  );

  // A body contracting ITSELF is not money moving between two sector members, and
  // awarder_group_model (061) — the windowed in-group figure on /sector/edu/procurement
  // — drops it too, so the two sentences there count the same rows.
  const [intra] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur, count(*) n FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = ANY($1)
        AND contractor_eik <> awarder_eik AND ${EX}`,
    [eiks],
  );
  const [transfers] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur, count(*) n FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = ANY($2) AND ${EX}`,
    [eiks, EDU_STATE_TRANSFER_CONTRACTORS.map((c) => c.eik)],
  );

  const utilityCond = UTILITY_CPV.map((p) => `cpv LIKE '${p}%'`).join(" OR ");
  const contractors = await allRows<Record<string, string | null>>(
    `SELECT contractor_eik eik, max(contractor_name) name, sum(amount_eur) eur,
            count(*) n, count(DISTINCT awarder_eik) buyers,
            coalesce(sum(amount_eur) FILTER (WHERE ${utilityCond}), 0) utility_eur
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND ${EX}
        AND coalesce(contractor_eik, '') <> '' AND amount_eur IS NOT NULL
      GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1 LIMIT $2`,
    [eiks, TOP_CONTRACTORS],
  );

  const BUS = "(cpv LIKE '3410%' OR cpv LIKE '3412%')";
  const [bus] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur, count(*) n,
            count(*) FILTER (WHERE number_of_tenderers = 1) single,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) known,
            min(date) first_date, max(date) last_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = $1 AND ${BUS} AND ${EX}`,
    [EDU_LEAD_EIK],
  );
  const busSuppliers = await allRows<Record<string, string | null>>(
    `SELECT contractor_eik eik, max(contractor_name) name, sum(amount_eur) eur, count(*) n
       FROM contracts WHERE tag = 'contract' AND awarder_eik = $1 AND ${BUS} AND ${EX}
      GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1 LIMIT 5`,
    [EDU_LEAD_EIK],
  );

  const topRows = await allRows<{
    key: string;
    unp: string | null;
    awarderEik: string;
    amountEur: number | null;
    title: string | null;
    date: string | null;
    contractorName: string | null;
  }>(
    `SELECT key, unp, awarder_eik "awarderEik", amount_eur::float8 "amountEur",
            title, date, contractor_name "contractorName"
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND amount_eur IS NOT NULL AND ${EX}
      ORDER BY amount_eur DESC NULLS LAST, key LIMIT $2`,
    [eiks, PROCUREMENT_ROWS],
  );
  // Choose the groups from the window, then re-fetch every lot of the chosen
  // УНПs so a lot below the window is not dropped from its group's total.
  const chosen = groupByProcurement(topRows).slice(0, TOP_PROCUREMENTS);
  const pairs = chosen.filter((g) => g.lead.unp);
  const fullLots = pairs.length
    ? await allRows<(typeof topRows)[number]>(
        `SELECT key, unp, awarder_eik "awarderEik", amount_eur::float8 "amountEur",
                title, date, contractor_name "contractorName"
           FROM contracts
          WHERE tag = 'contract' AND amount_eur IS NOT NULL AND ${EX}
            AND (awarder_eik, unp) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
        [pairs.map((g) => g.lead.awarderEik), pairs.map((g) => g.lead.unp)],
      )
    : [];
  // A row with no УНП is its own group, so it is carried over as chosen.
  const topProcurements = groupByProcurement([
    ...chosen.filter((g) => !g.lead.unp).flatMap((g) => g.lots),
    ...fullLots,
  ])
    .slice(0, TOP_PROCUREMENTS)
    .map((g) => ({
      key: g.lead.key,
      awarderEik: g.lead.awarderEik,
      title: g.lead.title ?? "",
      date: g.lead.date ?? "",
      contractorName: g.lead.contractorName ?? "",
      eur: round(g.totalEur),
      lots: g.lots.length,
    }));

  const listEur = async (list: readonly { eik: string }[]) =>
    (
      await allRows<{ eik: string; eur: string | null }>(
        `SELECT v.eik, sum(c.amount_eur) eur
           FROM unnest($1::text[]) v(eik)
           LEFT JOIN contracts c ON c.awarder_eik = v.eik AND c.tag = 'contract'
          GROUP BY 1 ORDER BY 1`,
        [list.map((v) => v.eik)],
      )
    ).map((v) => ({ eik: v.eik, eur: round(num(v.eur)) }));

  const [eu] = await allRows<Record<string, string | null>>(
    `SELECT count(DISTINCT beneficiary_eik) beneficiaries, count(*) projects,
            sum(grant_eur) grant_eur, sum(paid_eur) paid
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );

  // ИСУН by programme, grant basis, lifetime (T5). The corpus also carries the
  // national Science Fund (BNSF) and the EEA/Norway/Swiss programmes — kept as
  // their own rows, so a reader never takes them for EU money.
  const byProgramme = await allRows<Record<string, string | null>>(
    `SELECT program_code code, max(program_name) name, count(*) projects,
            count(DISTINCT beneficiary_eik) beneficiaries,
            sum(grant_eur) grant_eur, sum(paid_eur) paid
       FROM fund_projects WHERE beneficiary_eik = ANY($1)
      GROUP BY 1 ORDER BY sum(grant_eur) DESC NULLS LAST, 1`,
    [eiks],
  );

  // The research arm (T5): БАН and ССА on THREE corpora, each its own basis —
  // procurement (awarder €), ИСУН grant, ДФЗ payout. Never summed.
  // agri_subsidies is a gitignored-input load: absent → the payout arm is null
  // („not loaded"), never 0.
  const agriMissing = (await missingRelations(["agri_subsidies"])).length > 0;
  const fundsByEik = await allRows<{
    eik: string;
    g: string | null;
    n: string;
  }>(
    `SELECT beneficiary_eik eik, sum(grant_eur) g, count(*) n
       FROM fund_projects WHERE beneficiary_eik = ANY($1) GROUP BY 1`,
    [eiks],
  );
  const agriByEik = agriMissing
    ? null
    : await allRows<{
        eik: string;
        eur: string | null;
        n: string;
        y0: string;
        y1: string;
      }>(
        `SELECT eik, sum(total_eur) eur, count(*) n, min(year) y0, max(year) y1
           FROM agri_subsidies WHERE eik = ANY($1) GROUP BY 1`,
        [eiks],
      );
  const research = (["research_ban", "research_ssa"] as const).map((u) => {
    const inU = (eik: string) => educationUniverseOf(eik) === u;
    const p = universes.find((x) => x.universe === u);
    const f = fundsByEik.filter((r) => inU(r.eik));
    const a = agriByEik?.filter((r) => inU(r.eik)) ?? null;
    const years = a?.flatMap((r) => [num(r.y0), num(r.y1)]) ?? [];
    return {
      universe: u,
      procurementEur: p?.eur ?? 0,
      procurementContracts: p?.contracts ?? 0,
      grantEur: round(f.reduce((x, r) => x + num(r.g), 0)),
      grantProjects: f.reduce((x, r) => x + num(r.n), 0),
      agriEur: a ? round(a.reduce((x, r) => x + num(r.eur), 0)) : null,
      agriPayments: a ? a.reduce((x, r) => x + num(r.n), 0) : null,
      agriFirstYear: years.length ? Math.min(...years) : null,
      agriLastYear: years.length ? Math.max(...years) : null,
    };
  });

  const out: EduHubStats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    procurement: {
      eur: round(num(proc.eur)),
      contracts: num(proc.n),
      singleBid: num(proc.single),
      bidKnown: num(proc.known),
      nationalSingleBid: num(nat.r.singleBidExMembers),
      nationalBidKnown: num(nat.r.bidKnownExMembers),
      nullAmountContracts: num(proc.null_amount),
      firstDate: proc.first_date ?? null,
      lastDate: proc.last_date ?? null,
      institutions: bodies.length,
    },
    universes,
    byYear: byYear.map((y) => ({ year: y.year, eur: round(num(y.eur)), contracts: num(y.n) })), // prettier-ignore
    inGroup: { eur: round(num(intra.eur)), contracts: num(intra.n) },
    stateTransfers: { eur: round(num(transfers.eur)), contracts: num(transfers.n) }, // prettier-ignore
    topContractors: contractors.map((c) => ({
      eik: c.eik ?? "",
      name: c.name ?? "",
      eur: round(num(c.eur)),
      contracts: num(c.n),
      buyers: num(c.buyers),
      utilityShare: num(c.eur) > 0 ? Math.round((num(c.utility_eur) / num(c.eur)) * 1000) / 1000 : 0, // prettier-ignore
    })),
    buses: {
      eur: round(num(bus.eur)),
      contracts: num(bus.n),
      singleBid: num(bus.single),
      bidKnown: num(bus.known),
      firstDate: bus.first_date ?? null,
      lastDate: bus.last_date ?? null,
      suppliers: busSuppliers.map((s) => ({ eik: s.eik ?? "", name: s.name ?? "", eur: round(num(s.eur)), contracts: num(s.n) })), // prettier-ignore
    },
    topProcurements,
    topBodies: bodies.slice(0, RAIL).map((b) => ({
      eik: b.eik,
      name: educationEntityByEik(b.eik)?.name ?? b.eik,
      eur: b.eur,
    })),
    bodyIndex: bodies,
    verifyIndex: await listEur(EDU_VERIFY),
    adjacentIndex: await listEur(EDU_ADJACENT),
    euFunds: {
      beneficiaries: num(eu.beneficiaries),
      projects: num(eu.projects),
      grantEur: round(num(eu.grant_eur)),
      paidEur: round(num(eu.paid)),
    },
    fundsByProgramme: byProgramme.map((r) => ({
      code: r.code ?? "",
      name: r.name ?? "",
      projects: num(r.projects),
      beneficiaries: num(r.beneficiaries),
      grantEur: round(num(r.grant_eur)),
      paidEur: round(num(r.paid)),
    })),
    research,
  };

  // The universe split only partitions the headline: a drift means a roster EIK
  // with no universe, or two queries reading different rows.
  const uniTotal = out.universes.reduce((s, u) => s + u.eur, 0);
  if (Math.abs(uniTotal - out.procurement.eur) > out.universes.length)
    throw new Error(
      `universe split €${uniTotal} ≠ headline €${out.procurement.eur} — a roster EIK has no universe`,
    );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(
    `edu hub_stats: ${fs.statSync(OUT).size} B → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
