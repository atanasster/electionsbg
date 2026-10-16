// Транспорт tools — the chat surface for the /sector/transport hub. The transport
// group's procurement is served live from Postgres (the same awarder-group-model the
// dashboard uses), so these tools aggregate the curated state-transport group (every
// EIK in TRANSPORT_ENTITIES) the way
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
  directShareKnown,
  reattributedModes,
} from "@/lib/transportAttributes";
import {
  TRANSPORT_EIK,
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_UNIVERSES,
  transportEntityByEik,
  transportUniverseLabel,
  transportUniverseOf,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

const pct = (share: number | null, lang: "bg" | "en"): string =>
  fmtPct(share == null ? null : Math.round(share * 100), lang);

interface GroupRollup {
  operators: {
    eik: string;
    contractCount: number;
    bidKnownN: number;
    singleBidN: number;
  }[];
  exMembers?: boolean;
}
interface NationalCompetition {
  singleBidExMembers?: number;
  bidKnownExMembers?: number;
}

// "Къде отиват парите за транспорт?" — the state transport group's procurement by
// mode + function, the chat analog of /sector/transport/procurement. Two rules keep
// it from contradicting the hub (docs/plans/transport-hub-v1.md C8):
//   • the mode split RE-ATTRIBUTES the ministry's rail contracts (PSO 6021*, rolling
//     stock 346*) to rail — reattributedModes(), the hub's KPI 2 rule (D8);
//   • the single-bid share is the EX-MEMBER pair (awarder-group-rollup?exMembers=1)
//     beside the national ex-member rate — the hub's KPI 3 basis. The group model's
//     own pair counts the €0 consortium-member rows and reads biased down.
export const transportSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const eiks = TRANSPORT_SECTOR_EIKS.join(",");
  const [payload, ministry, rollup, national] = await Promise.all([
    fetchDb<GroupModelPayload>("awarder-group-model", { eiks }),
    fetchDb<GroupModelPayload>("awarder-group-model", { eiks: TRANSPORT_EIK }),
    fetchDb<GroupRollup>("awarder-group-rollup", { eiks, exMembers: "1" }),
    fetchDb<NationalCompetition>("national-competition", {}),
  ]);
  const m = buildTransportModelFromAggregates(payload);

  // Mode split, re-attributed; Σ modes == the group total by construction.
  const byMode = new Map<TransportUniverse, number>(
    reattributedModes(payload.byUnit, ministry.byCpv).map((r) => [
      r.universe,
      r.eur,
    ]),
  );
  const rawByMode = new Map<TransportUniverse, number>();
  for (const u of payload.byUnit) {
    const uni = transportUniverseOf(u.eik);
    if (uni) rawByMode.set(uni, (rawByMode.get(uni) ?? 0) + u.totalEur);
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
  const rawRailEur = rawByMode.get("rail") ?? 0;
  const topCat = [...m.categories]
    .filter((c) => c.id !== "other" && c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)[0];
  const topCon = m.suppliers[0];

  // Ex-member competition, only when the server confirms the basis.
  const known = rollup.exMembers
    ? rollup.operators.reduce((a, o) => a + o.bidKnownN, 0)
    : 0;
  const single = rollup.operators.reduce((a, o) => a + o.singleBidN, 0);
  const contracts = rollup.operators.reduce((a, o) => a + o.contractCount, 0);
  const nat =
    national?.bidKnownExMembers && national.singleBidExMembers != null
      ? national.singleBidExMembers / national.bidKnownExMembers
      : null;
  const direct = directShareKnown(payload.byMethod);

  return {
    tool: "transportSpending",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Транспорт — държавната група (МТС, НКЖИ, БДЖ, пристанища)"
      : "Transport — the state group (МТС, НКЖИ, БДЖ, ports)",
    subtitle: bg
      ? "Обществени поръчки по вид транспорт (АОП); договорите на МТС за жп превози и подвижен състав са към железниците. Пътищата (АПИ) са отделен сектор."
      : "Procurement by transport mode (AOP); МТС's rail-service and rolling-stock contracts count as rail. Roads (АПИ) are a separate sector.",
    columns: [
      { key: "mode", label: bg ? "Вид транспорт" : "Mode" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_value: fmtEurCompact(total, ctx.lang),
      contracts: fmtInt(contracts || m.contractCount, ctx.lang),
      rail_share: total > 0 ? pct(railEur / total, ctx.lang) : "—",
      rail_share_by_awarder:
        total > 0 ? pct(rawRailEur / total, ctx.lang) : "—",
      top_mode: topMode
        ? `${transportUniverseLabel(topMode.uni, ctx.lang)} (${fmtEurCompact(topMode.eur, ctx.lang)})`
        : "—",
      top_function: topCat
        ? `${categoryLabel(topCat.id, ctx.lang)} (${fmtEurCompact(topCat.totalEur, ctx.lang)})`
        : "—",
      single_bid_share: known > 0 ? pct(single / known, ctx.lang) : "—",
      national_single_bid_share:
        known > 0 && nat != null ? pct(nat, ctx.lang) : "—",
      bid_known_coverage:
        known > 0 && contracts > 0 ? pct(known / contracts, ctx.lang) : "—",
      direct_award_share:
        direct.knownEur > 0
          ? pct(direct.directEur / direct.knownEur, ctx.lang)
          : "—",
      top_contractor: topCon
        ? `${topCon.name} (${fmtEurCompact(topCon.totalEur, ctx.lang)})`
        : "—",
      note: bg
        ? "Делът с една оферта е без участниците в обединения и е до средното за всички възложители на същата база; делът без обявление е от стойността с известна процедура. Пътната инфраструктура (АПИ) е отделен сектор и не е включена."
        : "The single-bid share excludes consortium members and sits beside the all-buyer average on the same basis; the direct-award share is of the value with a known procedure. Road infrastructure (АПИ) is a separate sector and is not included.",
    },
    provenance: [
      "db:awarder-group-model",
      "db:awarder-group-rollup (exMembers)",
      "db:national-competition",
    ],
  };
};

interface FundsRollup {
  basis?: string;
  operators: {
    eik: string;
    grantEur?: number;
    totalEur?: number;
    paidEur: number;
    projectCount: number;
  }[];
}

// "Колко европейски пари усвоява транспортът?" — ИСУН on the GRANT basis (БФП,
// fund_projects — D6): the grant awarded against what has been paid, the hub's
// /money#funds figure. The total project value (own contribution included) is a
// secondary fact; dividing paid by it halved the absorption rate.
export const transportEuFunds = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const { operators, basis } = await fetchDb<FundsRollup>(
    "awarder-funds-rollup",
    { eiks: TRANSPORT_SECTOR_EIKS.join(","), basis: "grant" },
  );
  // An older function ignores ?basis and answers on the total-value basis; refuse
  // to label that as grant aid.
  const rows0 =
    basis === "grant" ? operators.filter((o) => (o.grantEur ?? 0) > 0) : [];
  const grant = rows0.reduce((s, o) => s + (o.grantEur ?? 0), 0);
  const paid = rows0.reduce((s, o) => s + o.paidEur, 0);
  const projectTotal = rows0.reduce((s, o) => s + (o.totalEur ?? 0), 0);
  const absorption = grant > 0 ? paid / grant : 0;

  const named = rows0
    .map((o) => ({
      eik: o.eik,
      name: nameOfEik(o.eik),
      grantEur: o.grantEur ?? 0,
      abs: (o.grantEur ?? 0) > 0 ? o.paidEur / (o.grantEur ?? 0) : 0,
    }))
    .sort((a, b) => b.grantEur - a.grantEur);

  const rows: Row[] = named.slice(0, 8).map((o) => ({
    beneficiary: o.name,
    contracted: fmtEurCompact(o.grantEur, ctx.lang),
    absorbed: pct(o.abs, ctx.lang),
  }));

  const top = named[0];
  // The sharpest signal: a big beneficiary that has drawn almost nothing.
  const stalled = [...named]
    .filter((o) => o.grantEur >= 1e7)
    .sort((a, b) => a.abs - b.abs)[0];

  return {
    tool: "transportEuFunds",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Европейски средства за транспорт (ИСУН)"
      : "EU funds for transport (ИСУН)",
    subtitle: bg
      ? "Безвъзмездна помощ срещу реално изплатено, за програмния период"
      : "Grant aid vs actually paid, programme-period totals",
    columns: [
      { key: "beneficiary", label: bg ? "Бенефициент" : "Beneficiary" },
      {
        key: "contracted",
        label: bg ? "Безвъзмездна помощ" : "Grant",
        numeric: true,
      },
      { key: "absorbed", label: bg ? "Изплатени" : "Paid", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      total_grant: grant > 0 ? fmtEurCompact(grant, ctx.lang) : "—",
      total_paid: grant > 0 ? fmtEurCompact(paid, ctx.lang) : "—",
      total_project_value:
        projectTotal > 0 ? fmtEurCompact(projectTotal, ctx.lang) : "—",
      absorption: grant > 0 ? pct(absorption, ctx.lang) : "—",
      top_beneficiary: top
        ? `${top.name} (${fmtEurCompact(top.grantEur, ctx.lang)}, ${pct(top.abs, ctx.lang)})`
        : "—",
      lowest_absorber: stalled
        ? `${stalled.name} (${fmtEurCompact(stalled.grantEur, ctx.lang)}, ${pct(stalled.abs, ctx.lang)})`
        : "—",
      note: bg
        ? "Безвъзмездната финансова помощ (БФП) по проектите в ИСУН, за целия програмен период — не по избран парламент. Общата стойност на проектите включва и собственото участие."
        : "The grant aid (БФП) on the ИСУН projects, over the whole programme period — not scoped to a parliament. The total project value includes the own contribution.",
    },
    provenance: ["db:awarder-funds-rollup?basis=grant (ИСУН fund_projects)"],
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
