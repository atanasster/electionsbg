// `pnpm run db:gen-health-hub-stats` → data/health/derived/hub_stats.json, the
// /sector/health hub's KPI band, hospital rail, finder index and band figures
// (docs/plans/health-hub-v1.md T2). The shape is HealthHubStats
// (src/data/health/hubStats.ts).
//
// Inputs: contracts (db:load:pg), nzok_hospital_payments
// (db:load:nzok-hospital:pg), nzok_drug_quarterly (db:load:nzok-drug-quarterly:pg),
// fund_projects (db:load:funds:pg), national_competition() (167) and the
// COMMITTED data/budget/nzok/execution_history.json (the B1 series — not in
// Postgres). Its db:refresh slot is right after db:load:nzok-drug-quarterly:pg,
// the last of those loaders.
//
// Three rules carried from the plan's audit:
//   · D3 — joint_kind='framework' rows are ceiling/N shares of a framework
//     CEILING, not money spent: never in `procurement.eur`, always reported as
//     `frameworkCeilingEur`, and kept out of every count and competition pair.
//   · A2 — nzok_hospital_payments carries €0 placeholder rows; a facility is
//     counted only on a NON-ZERO month.
//   · A3 — the B1 revenue line excludes the state transfer; the blob carries the
//     form's own balance (section Г) so no consumer derives one.
//   · The per-INN medicines file carries the HOSPITAL-administered drugs too
//     (pembrolizumab, an infusion, is its #1 INN), i.e. the payments corpus's
//     `drugs` stream. KPI 2 therefore excludes that stream, and the generator
//     asserts KPI 2 + KPI 3 < KPI 1 — each part alone below its whole was not
//     enough: payments-with-drugs + medicines overshot НЗОК's 2025 total by €34M.

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import {
  HEALTH_ENTITIES,
  HEALTH_SECTOR_EIKS,
  healthUniverseOf,
} from "../../../src/lib/healthReferenceData";
import type {
  HealthHubStats,
  HealthPaymentStream,
} from "../../../src/data/health/hubStats";
import type { NzokExecutionHistoryFile } from "../../../src/data/budget/types";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/health/derived/hub_stats.json");
const B1_HISTORY = path.join(ROOT, "data/budget/nzok/execution_history.json");

const INPUTS: Record<string, string> = {
  contracts: "db:load:pg",
  nzok_hospital_payments: "db:load:nzok-hospital:pg",
  nzok_drug_quarterly: "db:load:nzok-drug-quarterly:pg",
  fund_projects: "db:load:funds:pg",
};

const RAIL = 5;
const TOP_CONTRACTORS = 10;

const num = (v: unknown): number => Number(v ?? 0);
const round = (v: number): number => Math.round(v);
const orNull = (v: number | null | undefined): number | null =>
  v == null ? null : v;

/** A retired EIK's successor, else itself. */
const institutionOf = (eik: string): string =>
  HEALTH_ENTITIES.find((e) => e.eik === eik)?.retiredEikOf ?? eik;

const skipWith = async (why: string, fix: string): Promise<never> => {
  warnSkip("health hub_stats", why, fix);
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
  for (const t of [
    "contracts",
    "nzok_hospital_payments",
    "nzok_drug_quarterly",
  ])
    if (await isEmpty(t))
      await skipWith(`${t} is empty (${INPUTS[t]})`, `pnpm run ${INPUTS[t]}`);
  if (!fs.existsSync(B1_HISTORY))
    await skipWith(
      "data/budget/nzok/execution_history.json is absent",
      "pnpm exec tsx scripts/nzok/write_execution.ts",
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

  // ── the year KPIs 1–3 share ────────────────────────────────────────────────
  const b1 = JSON.parse(
    fs.readFileSync(B1_HISTORY, "utf-8"),
  ) as NzokExecutionHistoryFile;
  const decembers = b1.points
    .filter((p) => p.month === 12 && p.expenditureEur != null)
    .sort((a, b) => a.year - b.year);
  const [payYear] = await allRows<{ y: number | null }>(
    // Complete in EVERY stream — KPI 2 sums them, and `devices` has run a month
    // short of `bmp` (2023, 2024) as well as ahead of it (2026).
    `SELECT max(y)::int y FROM (
       SELECT y FROM (
         SELECT extract(year FROM period) y, stream, count(DISTINCT period) n
           FROM nzok_hospital_payments GROUP BY 1, 2) s
        GROUP BY y
       HAVING min(n) = 12
          AND count(*) = (SELECT count(DISTINCT stream) FROM nzok_hospital_payments)) t`,
  );
  const [drugYear] = await allRows<{ y: number | null }>(
    `SELECT max(y)::int y FROM (
       SELECT left(quarter, 4)::int y FROM nzok_drug_quarterly
        GROUP BY 1 HAVING count(DISTINCT quarter) = 4) t`,
  );
  const lastB1 = decembers.at(-1)?.year ?? null;
  if (lastB1 == null || payYear?.y == null || drugYear?.y == null)
    throw new Error(
      `no complete year in one of the three corpora (B1 December ${lastB1}, payments ${payYear?.y}, pharmacy ${drugYear?.y}) — refusing to state KPIs 1–3 for different years`,
    );
  const year = Math.min(lastB1, payYear.y, drugYear.y);
  const dec = decembers.find((p) => p.year === year);
  if (!dec) throw new Error(`B1 has no December ${year} point`);

  // ── KPI 2: hospital payments ───────────────────────────────────────────────
  const streams =
    await allRows<{ stream: HealthPaymentStream; eur: string; facilities: string }>( // prettier-ignore
      `SELECT stream, sum(month_eur) eur,
            count(DISTINCT reg_no) FILTER (WHERE month_eur <> 0) facilities
       FROM nzok_hospital_payments
      WHERE extract(year FROM period) = $1
      GROUP BY 1 ORDER BY sum(month_eur) DESC`,
      [year],
    );
  const [pay] = await allRows<Record<string, string | null>>(
    `SELECT sum(month_eur) eur,
            count(DISTINCT reg_no) FILTER (WHERE month_eur <> 0) facilities,
            sum(month_eur) FILTER (WHERE stream <> 'drugs') care_eur,
            count(DISTINCT reg_no) FILTER (WHERE month_eur <> 0 AND stream <> 'drugs') care_facilities,
            count(*) FILTER (WHERE month_eur = 0) placeholders,
            to_char(max(period), 'YYYY-MM') last_period
       FROM nzok_hospital_payments WHERE extract(year FROM period) = $1`,
    [year],
  );
  const hospitals = await allRows<{ eik: string; name: string; eur: string }>(
    `SELECT eik, (array_agg(name ORDER BY period DESC, month_eur DESC, reg_no))[1] name, sum(month_eur) eur
       FROM nzok_hospital_payments
      WHERE extract(year FROM period) = $1 AND coalesce(eik, '') <> ''
      GROUP BY 1 ORDER BY sum(month_eur) DESC, 1 LIMIT $2`,
    [year, RAIL],
  );

  // ── KPI 3: medicines (pharmacy + hospital) ─────────────────────────────────
  const [pharm] = await allRows<Record<string, string | null>>(
    `SELECT sum(eur) eur, count(DISTINCT inn) FILTER (WHERE eur <> 0) inns
       FROM nzok_drug_quarterly WHERE left(quarter, 4) = $1`,
    [String(year)],
  );

  // ── KPI 4: procurement ─────────────────────────────────────────────────────
  const eiks = [...HEALTH_SECTOR_EIKS];
  const EX = "consortium_role IS DISTINCT FROM 'member'";
  const NF = "joint_kind IS DISTINCT FROM 'framework'";
  const FW = "joint_kind = 'framework'";

  const [proc] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) FILTER (WHERE ${NF}) eur,
            count(*) FILTER (WHERE ${EX} AND ${NF}) n,
            count(*) FILTER (WHERE ${EX} AND ${NF} AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE ${EX} AND ${NF} AND number_of_tenderers IS NOT NULL) known,
            count(*) FILTER (WHERE ${EX} AND ${NF} AND amount_eur IS NULL) null_amount,
            coalesce(sum(amount_eur) FILTER (WHERE ${FW}), 0) fw_eur,
            count(*) FILTER (WHERE ${FW}) fw_n,
            min(date) first_date, max(date) last_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );

  const byAwarder = await allRows<Record<string, string | null>>(
    `SELECT awarder_eik eik, sum(amount_eur) FILTER (WHERE ${NF}) eur,
            count(*) FILTER (WHERE ${EX} AND ${NF}) n,
            count(*) FILTER (WHERE ${EX} AND ${NF} AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE ${EX} AND ${NF} AND number_of_tenderers IS NOT NULL) known,
            coalesce(sum(amount_eur) FILTER (WHERE ${FW}), 0) fw_eur
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
      GROUP BY 1`,
    [eiks],
  );
  const uni = new Map<string, HealthHubStats["universes"][number]>();
  const inst = new Map<string, number>();
  for (const a of byAwarder) {
    const eik = a.eik ?? "";
    const u = healthUniverseOf(eik);
    if (!u) continue;
    const cur = uni.get(u) ?? { universe: u, eur: 0, contracts: 0, singleBid: 0, bidKnown: 0, frameworkCeilingEur: 0 }; // prettier-ignore
    cur.eur += num(a.eur);
    cur.contracts += num(a.n);
    cur.singleBid += num(a.single);
    cur.bidKnown += num(a.known);
    cur.frameworkCeilingEur += num(a.fw_eur);
    uni.set(u, cur);
    const i = institutionOf(eik);
    inst.set(i, (inst.get(i) ?? 0) + num(a.eur));
  }
  const universes = [...uni.values()]
    .map((u) => ({
      ...u,
      eur: round(u.eur),
      frameworkCeilingEur: round(u.frameworkCeilingEur),
    })) // prettier-ignore
    .sort((a, b) => b.eur - a.eur);
  const bodies = [...inst.entries()]
    .map(([eik, eur]) => ({ eik, eur: round(eur) }))
    .sort((a, b) => b.eur - a.eur || a.eik.localeCompare(b.eik));

  const byYear = await allRows<Record<string, string | null>>(
    `SELECT left(date, 4) AS year,
            coalesce(sum(amount_eur) FILTER (WHERE ${NF}), 0) eur,
            coalesce(sum(amount_eur) FILTER (WHERE ${FW}), 0) fw_eur,
            count(*) FILTER (WHERE ${EX} AND ${NF}) n
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1) AND date IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [eiks],
  );

  // A4: grouped by EIK, named by the most recent spelling (Софарма files under
  // four). A self-award (buyer EIK in the supplier field) is not a supplier.
  const contractors = await allRows<Record<string, string | null>>(
    `SELECT contractor_eik eik,
            (array_agg(contractor_name ORDER BY date DESC NULLS LAST, key))[1] name,
            sum(amount_eur) eur, count(*) n
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND ${EX} AND ${NF}
        AND coalesce(contractor_eik, '') <> '' AND contractor_eik <> awarder_eik
        AND amount_eur IS NOT NULL
      GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1 LIMIT $2`,
    [eiks, TOP_CONTRACTORS],
  );

  const [eu] = await allRows<Record<string, string | null>>(
    `SELECT count(DISTINCT beneficiary_eik) beneficiaries, count(*) projects,
            sum(grant_eur) grant_eur, sum(paid_eur) paid
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );

  const out: HealthHubStats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    year,
    nzok: {
      expenditureEur: dec.expenditureEur ?? 0,
      revenueEur: orNull(dec.revenueEur),
      transfersEur: orNull(dec.transfersEur),
      balanceEur: orNull(dec.balanceEur),
    },
    nzokByYear: decembers.map((p) => ({
      year: p.year,
      expenditureEur: p.expenditureEur ?? 0,
      revenueEur: orNull(p.revenueEur),
      transfersEur: orNull(p.transfersEur),
      balanceEur: orNull(p.balanceEur),
    })),
    payments: {
      eur: round(num(pay.eur)),
      facilities: num(pay.facilities),
      careEur: round(num(pay.care_eur)),
      careFacilities: num(pay.care_facilities),
      byStream: streams.map((s) => ({ stream: s.stream, eur: round(num(s.eur)), facilities: num(s.facilities) })), // prettier-ignore
      placeholderRows: num(pay.placeholders),
      lastPeriod: pay.last_period ?? "",
    },
    medicines: { eur: round(num(pharm.eur)), inns: num(pharm.inns) },
    procurement: {
      eur: round(num(proc.eur)),
      contracts: num(proc.n),
      singleBid: num(proc.single),
      bidKnown: num(proc.known),
      nationalSingleBid: num(nat.r.singleBidExMembers),
      nationalBidKnown: num(nat.r.bidKnownExMembers),
      frameworkCeilingEur: round(num(proc.fw_eur)),
      frameworkCeilingContracts: num(proc.fw_n),
      nullAmountContracts: num(proc.null_amount),
      firstDate: proc.first_date ?? null,
      lastDate: proc.last_date ?? null,
      institutions: bodies.length,
    },
    universes,
    byYear: byYear.map((y) => ({
      year: y.year ?? "",
      eur: round(num(y.eur)),
      frameworkCeilingEur: round(num(y.fw_eur)),
      contracts: num(y.n),
    })),
    topContractors: contractors.map((c) => ({
      eik: c.eik ?? "",
      name: c.name ?? "",
      eur: round(num(c.eur)),
      contracts: num(c.n),
    })),
    topHospitals: hospitals.map((h) => ({ eik: h.eik, name: h.name, eur: round(num(h.eur)) })), // prettier-ignore
    bodyIndex: bodies,
    euFunds: {
      beneficiaries: num(eu.beneficiaries),
      projects: num(eu.projects),
      grantEur: round(num(eu.grant_eur)),
      paidEur: round(num(eu.paid)),
    },
  };

  // KPI 2 and KPI 3 are DISJOINT parts paid out of KPI 1: their SUM must stay
  // below it. Checking each alone passed while the two overlapped by €0.8bn.
  const parts = out.payments.careEur + out.medicines.eur;
  if (parts >= out.nzok.expenditureEur)
    throw new Error(
      `hospital care €${out.payments.careEur} + medicines €${out.medicines.eur} ≥ НЗОК expenditure €${out.nzok.expenditureEur} for ${year} — the parts overlap or sit on different years or bases`,
    );
  // The universe split only partitions the headline.
  const uniTotal = out.universes.reduce((s, u) => s + u.eur, 0);
  if (Math.abs(uniTotal - out.procurement.eur) > out.universes.length)
    throw new Error(
      `universe split €${uniTotal} ≠ headline €${out.procurement.eur} — a roster EIK has no universe`,
    );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(
    `health hub_stats (${year}): ${fs.statSync(OUT).size} B → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
