// Транспорт tools — the chat surface for the /sector/transport pack. The transport
// group's procurement is served live from Postgres (the same awarder-group-model the
// dashboard uses), so these tools aggregate the 11-EIK state-transport group the way
// the pack does, and add the EU-funds absorption the corpus can't show on its own.
//
//   transportSpending  — group procurement by MODE (rail/maritime/aviation/road) +
//                        what it buys by function + competition signals.
//   transportEuFunds   — ИСУН EU-funds contracted vs paid (absorption) per beneficiary.
//
// ⚠ ROADS ARE A SEPARATE SECTOR — АПИ/Автомагистрали are NOT in this group; the roads
// dashboard has its own `roadsSpending` tool. Every fact goes through ctx.lang and the
// tool never computes prose numbers — narrate() reads env.facts. Mirrors the МВР /
// defense tools' Envelope shape.

import { fetchDb, fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";
import type { GroupModelPayload } from "@/lib/awarderModel";
import {
  buildTransportModelFromAggregates,
  categoryLabel,
} from "@/lib/transportAttributes";
import {
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_UNIVERSES,
  transportEntityByEik,
  transportUniverseLabel,
  transportUniverseOf,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

const pct = (share: number | null, lang: "bg" | "en"): string =>
  fmtPct(share == null ? null : Math.round(share * 100), lang);

// "Къде отиват парите за транспорт?" — the state transport group's procurement folded
// by mode + function, the chat analog of the /sector/transport pack.
export const transportSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const payload = await fetchDb<GroupModelPayload>("awarder-group-model", {
    eiks: TRANSPORT_SECTOR_EIKS.join(","),
  });
  const m = buildTransportModelFromAggregates(payload);

  // Mode split from the per-unit rollup (universe is a reference-data lookup, not in
  // the payload). Ordered by the canonical universe order, biggest kept.
  const byMode = new Map<TransportUniverse, number>();
  for (const u of payload.byUnit) {
    const uni = transportUniverseOf(u.eik);
    if (!uni) continue;
    byMode.set(uni, (byMode.get(uni) ?? 0) + u.totalEur);
  }
  const total = m.totalEur;
  const modeRows = TRANSPORT_UNIVERSES.map((uni) => ({
    uni,
    eur: byMode.get(uni) ?? 0,
  })).filter((r) => r.eur > 0);
  modeRows.sort((a, b) => b.eur - a.eur);

  const rows: Row[] = modeRows.map((r) => ({
    mode: transportUniverseLabel(r.uni, ctx.lang),
    amount: fmtEurCompact(r.eur, ctx.lang),
    share: total > 0 ? pct(r.eur / total, ctx.lang) : "—",
  }));

  const topMode = modeRows[0];
  const railEur = byMode.get("rail") ?? 0;
  const topCat = [...m.categories]
    .filter((c) => c.id !== "other" && c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)[0];
  const topCon = m.suppliers[0];

  return {
    tool: "transportSpending",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Транспорт — държавната група (МТС, НКЖИ, БДЖ, пристанища)"
      : "Transport — the state group (МТС, НКЖИ, БДЖ, ports)",
    subtitle: bg
      ? "Обществени поръчки по вид транспорт (АОП). Пътищата (АПИ) са отделен сектор."
      : "Procurement by transport mode (AOP). Roads (АПИ) are a separate sector.",
    columns: [
      { key: "mode", label: bg ? "Вид транспорт" : "Mode" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_value: fmtEurCompact(total, ctx.lang),
      contracts: fmtInt(m.contractCount, ctx.lang),
      rail_share: total > 0 ? pct(railEur / total, ctx.lang) : "—",
      top_mode: topMode
        ? `${transportUniverseLabel(topMode.uni, ctx.lang)} (${fmtEurCompact(topMode.eur, ctx.lang)})`
        : "—",
      top_function: topCat
        ? `${categoryLabel(topCat.id, ctx.lang)} (${fmtEurCompact(topCat.totalEur, ctx.lang)})`
        : "—",
      single_bid_share: pct(m.singleBidShare, ctx.lang),
      direct_award_share: pct(m.directShare, ctx.lang),
      top_contractor: topCon
        ? `${topCon.name} (${fmtEurCompact(topCon.totalEur, ctx.lang)})`
        : "—",
      note: bg
        ? "Пътната инфраструктура (АПИ) е отделен сектор и не е включена в тези суми."
        : "Road infrastructure (АПИ) is a separate sector and is not included here.",
    },
    provenance: ["db:awarder-group-model"],
  };
};

interface FundsRollup {
  operators: {
    eik: string;
    contractedEur: number;
    paidEur: number;
    projectCount: number;
  }[];
}

// "Колко европейски пари усвоява транспортът?" — the ИСУН absorption story: contracted
// vs actually paid across the transport group (ОП „Транспортна свързаност" / ОПТ).
export const transportEuFunds = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const { operators } = await fetchDb<FundsRollup>("awarder-funds-rollup", {
    eiks: TRANSPORT_SECTOR_EIKS.join(","),
  });
  const rows0 = operators.filter((o) => o.contractedEur > 0);
  const contracted = rows0.reduce((s, o) => s + o.contractedEur, 0);
  const paid = rows0.reduce((s, o) => s + o.paidEur, 0);
  const absorption = contracted > 0 ? paid / contracted : 0;

  const named = rows0
    .map((o) => ({
      eik: o.eik,
      name: nameOfEik(o.eik),
      contractedEur: o.contractedEur,
      abs: o.contractedEur > 0 ? o.paidEur / o.contractedEur : 0,
    }))
    .sort((a, b) => b.contractedEur - a.contractedEur);

  const rows: Row[] = named.slice(0, 8).map((o) => ({
    beneficiary: o.name,
    contracted: fmtEurCompact(o.contractedEur, ctx.lang),
    absorbed: pct(o.abs, ctx.lang),
  }));

  const top = named[0];
  // The sharpest signal: a big beneficiary that has drawn almost nothing.
  const stalled = [...named]
    .filter((o) => o.contractedEur >= 1e7)
    .sort((a, b) => a.abs - b.abs)[0];

  return {
    tool: "transportEuFunds",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Европейски средства за транспорт (ИСУН)"
      : "EU funds for transport (ИСУН)",
    subtitle: bg
      ? "Договорени срещу реално изплатени (усвояване), за програмния период"
      : "Contracted vs actually paid (absorption), programme-period totals",
    columns: [
      { key: "beneficiary", label: bg ? "Бенефициент" : "Beneficiary" },
      {
        key: "contracted",
        label: bg ? "Договорени" : "Contracted",
        numeric: true,
      },
      { key: "absorbed", label: bg ? "Усвоени" : "Absorbed", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_contracted: fmtEurCompact(contracted, ctx.lang),
      total_paid: fmtEurCompact(paid, ctx.lang),
      absorption: pct(absorption, ctx.lang),
      top_beneficiary: top
        ? `${top.name} (${fmtEurCompact(top.contractedEur, ctx.lang)}, ${pct(top.abs, ctx.lang)})`
        : "—",
      lowest_absorber: stalled
        ? `${stalled.name} (${fmtEurCompact(stalled.contractedEur, ctx.lang)}, ${pct(stalled.abs, ctx.lang)})`
        : "—",
      note: bg
        ? "Сумите са за целия програмен период (ОПТ / ОП Транспортна свързаност), не по избран парламент."
        : "Figures are programme-period totals (ОПТ / Transport Connectivity), not scoped to a parliament.",
    },
    provenance: ["db:awarder-funds-rollup (ИСУН)"],
  };
};

interface RailSubsidyFile {
  years: {
    fiscalYear: number;
    bdzPassengerPsoEur: number | null;
    nkzhiOperatingEur: number | null;
    bdzCapitalEur: number | null;
    nkzhiCapitalEur: number | null;
  }[];
}
interface RailRidershipFile {
  series: { year: number; passengers: number | null }[];
}

const fmtEur2 = (v: number, lang: "bg" | "en"): string =>
  lang === "bg"
    ? `${v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : `€${v.toFixed(2)}`;

// "Колко субсидира държавата влака?" — the rail subsidy-dependency answer: the PSO
// subsidy per passenger (the €/ticket the taxpayer adds) + the total rail subsidy split.
export const railSubsidy = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const [sub, ride] = await Promise.all([
    fetchData<RailSubsidyFile>("/transport/rail_subsidy.json"),
    fetchData<RailRidershipFile>("/transport/rail_ridership.json"),
  ]);
  const paxByYear = new Map(ride.series.map((s) => [s.year, s.passengers]));
  const rows = sub.years
    .map((y) => {
      const pso = y.bdzPassengerPsoEur;
      const pax = paxByYear.get(y.fiscalYear) ?? null;
      return {
        year: y.fiscalYear,
        pso,
        nkzhi: (y.nkzhiOperatingEur ?? 0) + (y.nkzhiCapitalEur ?? 0),
        bdzCapital: y.bdzCapitalEur ?? 0,
        pax,
        perPax: pso != null && pax && pax > 0 ? pso / pax : null,
      };
    })
    .filter((r) => r.perPax != null)
    .sort((a, b) => a.year - b.year);
  const latest = rows[rows.length - 1];

  const total =
    (latest?.pso ?? 0) + (latest?.nkzhi ?? 0) + (latest?.bdzCapital ?? 0);

  return {
    tool: "railSubsidy",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? "Субсидия за железниците на пътник"
      : "Rail subsidy per passenger",
    viz: "line",
    value: latest?.perPax ?? 0,
    categories: rows.map((r) => r.year),
    series: [
      {
        key: "perPax",
        label: bg ? "Субсидия/пътник (PSO)" : "Subsidy/passenger (PSO)",
        points: rows.map((r) => ({ x: r.year, y: r.perPax as number })),
      },
    ],
    facts: {
      latest_year: String(latest?.year ?? "—"),
      subsidy_per_passenger:
        latest?.perPax != null ? fmtEur2(latest.perPax, ctx.lang) : "—",
      total_rail_subsidy: fmtEurCompact(total, ctx.lang),
      bdz_pso: latest?.pso != null ? fmtEurCompact(latest.pso, ctx.lang) : "—",
      nkzhi_subsidy: fmtEurCompact(latest?.nkzhi ?? 0, ctx.lang),
      passengers: latest?.pax != null ? fmtInt(latest.pax, ctx.lang) : "—",
      note: bg
        ? "Субсидията на пътник ползва само PSO (оперативната субсидия за превоза); НКЖИ е инфраструктура. Бюджетирана субсидия (ЗДБ); пътници от Eurostat (национален жп ≈ БДЖ)."
        : "“Per passenger” uses the PSO (operating) subsidy only; НКЖИ is infrastructure. Budgeted subsidy (State Budget Law); passengers from Eurostat (national rail ≈ БДЖ).",
    },
    provenance: [
      "transport/rail_subsidy.json (ЗДБ)",
      "transport/rail_ridership.json (Eurostat rail_pa_total)",
    ],
  };
};

// Canonical group-member name for a beneficiary EIK; the funds endpoint carries no
// name, so we label from the reference data (any non-member EIK is unexpected here).
const nameOfEik = (eik: string): string =>
  transportEntityByEik(eik)?.name ?? `ЕИК ${eik}`;
