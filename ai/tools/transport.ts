// Транспорт tools — the chat surface for the /sector/transport hub. The transport
// group's procurement is served live from Postgres (the same awarder-group-model and
// ex-member rollup the hub's sub-pages read), so these tools aggregate the curated
// state-transport group (every EIK in TRANSPORT_ENTITIES) on the hub's own rules
// (docs/plans/transport-hub-v1.md C8).
//
//   transportSpending  — group procurement by MODE (rail/maritime/aviation/road) +
//                        what it buys by function + competition signals.
//   transportEuFunds   — ИСУН grant aid (БФП) vs paid, per beneficiary.
//   railSubsidy        — the PSO subsidy per passenger + the total rail subsidy.
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
  railSubsidyRows,
  railSubsidyAnchor,
  type RailSubsidyFile,
  type RailRidershipFile,
} from "@/lib/railSubsidy";
import {
  buildTransportModelFromAggregates,
  categoryLabel,
  directShareKnown,
  reattributedModes,
} from "@/lib/transportAttributes";
import {
  TRANSPORT_EIK,
  TRANSPORT_EU_FUNDS_EXCLUDED,
  TRANSPORT_SECTOR_EIKS,
  euFundsExcludedCaption,
  euFundsPassThroughCaption,
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
      // Ex-member basis only — the group model's own count includes the €0
      // consortium-member rows and would disagree with the hub.
      contracts: rollup.exMembers ? fmtInt(contracts, ctx.lang) : "—",
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
  excluded?: string[];
  operators: {
    eik: string;
    grantEur?: number;
    paidEur: number;
    projectCount: number;
  }[];
}

// "Колко европейски пари усвоява транспортът?" — ИСУН on the GRANT basis (БФП,
// fund_projects — D6): the grant awarded against what has been paid, the hub's
// /money#funds figure. Without the declared out-of-sector projects (the RRP
// broadband project — transport-hub-v1 audit 2026-10-17, T2) and with NO total
// project value: a phased project carries its total once per phase, so a sum
// double-counts (T3).
export const transportEuFunds = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const exclude = TRANSPORT_EU_FUNDS_EXCLUDED.map((x) => x.contractNumber);
  const { operators, basis, excluded } = await fetchDb<FundsRollup>(
    "awarder-funds-rollup",
    {
      eiks: TRANSPORT_SECTOR_EIKS.join(","),
      basis: "grant",
      exclude: exclude.join(","),
    },
  );
  const excludedApplied = exclude.every((c) => (excluded ?? []).includes(c));
  // An older function ignores ?basis and answers on the total-value basis; refuse
  // to label that as grant aid.
  const rows0 =
    basis === "grant" ? operators.filter((o) => (o.grantEur ?? 0) > 0) : [];
  const grant = rows0.reduce((s, o) => s + (o.grantEur ?? 0), 0);
  const paid = rows0.reduce((s, o) => s + o.paidEur, 0);
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
      absorption: grant > 0 ? pct(absorption, ctx.lang) : "—",
      top_beneficiary: top
        ? `${top.name} (${fmtEurCompact(top.grantEur, ctx.lang)}, ${pct(top.abs, ctx.lang)})`
        : "—",
      lowest_absorber: stalled
        ? `${stalled.name} (${fmtEurCompact(stalled.grantEur, ctx.lang)}, ${pct(stalled.abs, ctx.lang)})`
        : "—",
      note: [
        bg
          ? "Безвъзмездната финансова помощ (БФП) по проектите в ИСУН, за целия програмен период — не по избран парламент."
          : "The grant aid (БФП) on the ИСУН projects, over the whole programme period — not scoped to a parliament.",
        euFundsExcludedCaption(ctx.lang, excludedApplied),
        euFundsPassThroughCaption(ctx.lang),
      ]
        .filter(Boolean)
        .join(" "),
    },
    provenance: ["db:awarder-funds-rollup?basis=grant (ИСУН fund_projects)"],
  };
};

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
  // The hub's own rules (src/lib/railSubsidy.ts): a null capital transfer is
  // UNPUBLISHED, not zero, so the total and НКЖИ are null for such a year (T9 F3).
  const rows = railSubsidyRows(sub, ride).filter((r) => r.perPassenger != null);
  const latest = railSubsidyAnchor(rows);

  return {
    tool: "railSubsidy",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? "Субсидия за железниците на пътник"
      : "Rail subsidy per passenger",
    viz: "line",
    value: latest?.perPassenger ?? 0,
    categories: rows.map((r) => r.year),
    series: [
      {
        key: "perPax",
        label: bg ? "Субсидия/пътник (PSO)" : "Subsidy/passenger (PSO)",
        points: rows.map((r) => ({ x: r.year, y: r.perPassenger as number })),
      },
    ],
    facts: {
      latest_year: String(latest?.year ?? "—"),
      subsidy_per_passenger:
        latest?.perPassenger != null
          ? fmtEur2(latest.perPassenger, ctx.lang)
          : "—",
      total_rail_subsidy:
        latest?.total != null ? fmtEurCompact(latest.total, ctx.lang) : "—",
      bdz_pso: latest?.pso != null ? fmtEurCompact(latest.pso, ctx.lang) : "—",
      nkzhi_subsidy:
        latest?.nkzhi != null ? fmtEurCompact(latest.nkzhi, ctx.lang) : "—",
      passengers:
        latest?.passengers != null ? fmtInt(latest.passengers, ctx.lang) : "—",
      note: bg
        ? `Субсидията на пътник ползва само PSO (оперативната субсидия за превоза); НКЖИ е инфраструктура. Бюджетирана субсидия (ЗДБ); пътници от Eurostat (национален жп ≈ БДЖ).${latest?.capitalMissing ? ` Капиталовите трансфери за ${latest.year} г. не са разписани в Закона за държавния бюджет, затова обща сума за годината няма.` : ""}`
        : `“Per passenger” uses the PSO (operating) subsidy only; НКЖИ is infrastructure. Budgeted subsidy (State Budget Law); passengers from Eurostat (national rail ≈ БДЖ).${latest?.capitalMissing ? ` The capital transfers for ${latest.year} are not set out in the State Budget Law, so there is no total for that year.` : ""}`,
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
