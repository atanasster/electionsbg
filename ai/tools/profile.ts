// Phase C — local procurement (by settlement) + the composite governance profile
// for a place (the "about my area" place-ladder dashboard).

import { fetchData, fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import {
  fetchLocalMuni,
  localCycleYear,
  resolveLocalCycle,
} from "./localDataset";
import {
  oblastName,
  resolveMunicipality,
  resolveOblast,
  resolvePlaceForData,
} from "./place";
import { muniLocator, settlementLocator } from "./geo";
import { round2 } from "./dataset";
import type {
  Column,
  Envelope,
  GeoOverlay,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

// LISI / taxes / census / indicators key Sofia as SOF00, not the synthetic SOF.
const govCode = (obshtina: string): string =>
  obshtina === "SOF" ? "SOF00" : obshtina;

const tryFetch = async <T>(path: string): Promise<T | null> => {
  try {
    return await fetchData<T>(path);
  } catch {
    return null;
  }
};

// ---- procurement by settlement (keyed by ekatte) ----------------------------

type SettlementProc = {
  totalEur: number;
  contractCount: number;
  awarders: { name: string; totalEur: number }[];
};

export const procurementBySettlement = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  // exact município/settlement before fuzzy, so a village/town ("Баня") resolves
  // to its OWN ekatte instead of substring-matching a município ("Долна баня").
  const q = String(args.place ?? "");
  const place = await resolvePlaceForData(q);
  if (!place) return noPlace("procurementBySettlement", q, ctx);
  // procurement_settlement_detail — same per-settlement awarders/totals the
  // /procurement by-settlement view serves (canonical TR names, euro-rounded).
  let data: SettlementProc | null = null;
  try {
    data = await fetchDb<SettlementProc>("procurement-settlement", {
      ekatte: place.ekatte,
    });
  } catch {
    data = null;
  }
  if (!data) {
    return {
      tool: "procurementBySettlement",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за поръчки в ${place.name}`
          : `No procurement data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["db:procurement-settlement"],
    };
  }
  const top = [...data.awarders]
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, 8);
  const columns: Column[] = [
    { key: "buyer", label: ctx.lang === "bg" ? "Възложител" : "Buyer" },
    {
      key: "amount",
      label: ctx.lang === "bg" ? "Сума" : "Amount",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((a) => ({
    buyer: a.name,
    amount: fmtEurCompact(a.totalEur, ctx.lang),
  }));
  return {
    tool: "procurementBySettlement",
    domain: "place",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Обществени поръчки — ${place.name}`
        : `Public procurement — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: settlementLocator(
      place.ekatte,
      place.obshtina,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      total: fmtEurCompact(data.totalEur, ctx.lang),
      contracts: fmtInt(data.contractCount, ctx.lang),
      buyers: fmtInt(data.awarders.length, ctx.lang),
      // Average contract value — the metric the by-settlement table now
      // surfaces as a column (total ÷ contracts). Guarded against div-by-zero.
      avg_contract:
        data.contractCount > 0
          ? fmtEurCompact(data.totalEur / data.contractCount, ctx.lang)
          : "—",
      top_buyer: top[0]?.name ?? "—",
    },
    provenance: ["db:procurement-settlement"],
  };
};

// ---- procurement by oblast (aggregated from the by_settlement index) ---------
// Local-tier procurement rolled up to one oblast — the data behind the three
// per-oblast choropleths on /procurement/by-settlement (total / per-resident /
// average contract value). Sofia city and Plovdiv fold the same way the on-site
// map does (see useProcurementByOblast).

type BySettlementRow = {
  ekatte: string;
  name: string;
  province: string;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};
type BySettlementIndex = { settlements: BySettlementRow[] };
type RegionalPop = {
  series?: { population?: Record<string, { year: number; value: number }[]> };
};

// "Пловдив (област)" → "Пловдив" — the bare form the by_settlement index uses.
const bareOblast = (s: string): string =>
  s.replace(/\s*\([^)]*\)\s*/g, " ").trim();

// Oblast code → the province string the by_settlement index keys settlements on.
const oblastToProvince = (code: string, bgName: string): string => {
  if (code === "S23" || code === "S24" || code === "S25")
    return "София (столица)";
  if (code === "SFO") return "София";
  if (code === "PDV" || code === "PDV-00") return "Пловдив";
  return bareOblast(bgName);
};

// Map polygon code(s) for the highlight: Sofia city = its 3 МИР, Plovdiv =
// province + city feature, everything else = the single oblast polygon.
const oblastMapCodes = (code: string): string[] => {
  if (code === "S23" || code === "S24" || code === "S25")
    return ["S23", "S24", "S25"];
  if (code === "PDV" || code === "PDV-00") return ["PDV", "PDV-00"];
  return [code];
};

// One representative population code. The regional series stores the SAME oblast
// figure under each of Sofia's three МИР and under both Plovdiv codes, so we
// read just one (never sum) — otherwise per-resident comes out 2–3× too low.
const oblastPopCode = (code: string): string => {
  if (code === "S23" || code === "S24" || code === "S25") return "S23";
  if (code === "PDV-00") return "PDV";
  return code;
};

export const procurementByOblast = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const q = String(args.oblast ?? args.place ?? "");
  const ob = resolveOblast(q);
  if (!ob) return noPlace("procurementByOblast", q, ctx);

  const sofiaCity = ob.code === "S23" || ob.code === "S24" || ob.code === "S25";
  const label = sofiaCity
    ? bg
      ? "София (столица)"
      : "Sofia (capital)"
    : oblastName(ob.code)[ctx.lang];
  const province = oblastToProvince(ob.code, ob.name.bg);

  // procurement_by_settlement — same per-settlement index the /procurement
  // by-settlement choropleths aggregate (province/totalEur/contractCount/
  // awarderCount per settlement); euro-rounded, canonical names.
  let idx: BySettlementIndex | null = null;
  try {
    idx = await fetchDb<BySettlementIndex>("procurement-by-settlement");
  } catch {
    idx = null;
  }
  const rows = (idx?.settlements ?? []).filter((s) => s.province === province);
  if (rows.length === 0) {
    return {
      tool: "procurementByOblast",
      domain: "place",
      kind: "scalar",
      title: bg
        ? `Няма местни поръчки в ${label}`
        : `No local procurement in ${label}`,
      viz: "none",
      facts: { oblast: label },
      provenance: ["db:procurement-by-settlement"],
    };
  }

  const total = rows.reduce((a, r) => a + r.totalEur, 0);
  const contracts = rows.reduce((a, r) => a + r.contractCount, 0);
  // A buyer is HQ'd in exactly one settlement, so summing per-settlement buyer
  // counts gives the oblast's distinct buyers — no double-count.
  const buyers = rows.reduce((a, r) => a + r.awarderCount, 0);
  const top = [...rows].sort((a, b) => b.totalEur - a.totalEur).slice(0, 8);

  // Per-resident: total ÷ latest registered population (regional.json, ×1000).
  const popJson = await tryFetch<RegionalPop>("/regional.json");
  const series = popJson?.series?.population?.[oblastPopCode(ob.code)];
  const population = series?.length
    ? series[series.length - 1].value * 1000
    : 0;
  const perResident = population > 0 ? total / population : undefined;

  const columns: Column[] = [
    { key: "settlement", label: bg ? "Населено място" : "Settlement" },
    { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
  ];
  const tableRows: Row[] = top.map((s) => ({
    settlement: s.name,
    amount: fmtEurCompact(s.totalEur, ctx.lang),
  }));

  const geo: GeoOverlay = {
    level: "oblast",
    mode: "locator",
    source: "/regions_map.json",
    joinKey: "nuts3",
    metricLabel: label,
    areas: oblastMapCodes(ob.code).map((c) => ({ code: c, label })),
    focus: oblastMapCodes(ob.code),
  };

  return {
    tool: "procurementByOblast",
    domain: "place",
    kind: "table",
    title: bg
      ? `Обществени поръчки — ${label}`
      : `Public procurement — ${label}`,
    columns,
    rows: tableRows,
    viz: "none",
    geo,
    facts: {
      oblast: label,
      total: fmtEurCompact(total, ctx.lang),
      contracts: fmtInt(contracts, ctx.lang),
      buyers: fmtInt(buyers, ctx.lang),
      avg_contract:
        contracts > 0 ? fmtEurCompact(total / contracts, ctx.lang) : "—",
      per_resident:
        perResident != null
          ? `${fmtEurCompact(perResident, ctx.lang)}${bg ? "/жит." : "/cap"}`
          : "—",
      settlements: fmtInt(rows.length, ctx.lang),
      top_settlement: top[0]?.name ?? "—",
    },
    provenance: ["db:procurement-by-settlement", "regional.json"],
  };
};

// ---- composite governance profile -------------------------------------------

type CensusMuni = { population: number };
type LisiData = {
  scoresByObshtina: Record<string, { composite: number; nationalRank: number }>;
};
type IndData = {
  series: Record<string, Record<string, { year: number; value: number }[]>>;
};
type AirData = {
  stations: { obshtina?: string; latestReadings?: { pm10?: number } }[];
};
type GraoData = { settlements: Record<string, { permanent: number }> };
type CouncilData = { resolutionsByObshtina: Record<string, unknown[]> };

export const governanceProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noPlace("governanceProfile", String(args.place ?? ""), ctx);
  const code = govCode(place.obshtina);
  // an as-of year re-anchors the year-aware slices (the local cycle + the
  // indicator series); snapshot slices (census 2021, LISI, procurement) are
  // single-vintage and stay latest.
  const asOfYear =
    args.year != null && args.year !== "" ? Number(args.year) : undefined;
  const cycle = resolveLocalCycle(
    asOfYear != null ? String(asOfYear) : undefined,
  );

  const [census, local, lisi, ind, proc, air, grao, council] =
    await Promise.all([
      tryFetch<CensusMuni>(`/census/municipalities/${code}.json`),
      fetchLocalMuni(cycle, place.obshtina).catch(() => null),
      tryFetch<LisiData>("/municipal_transparency/index.json"),
      tryFetch<IndData>("/indicators.json"),
      fetchDb<SettlementProc>("procurement-settlement", {
        ekatte: place.ekatte,
      }).catch(() => null),
      tryFetch<AirData>("/air/index.json"),
      tryFetch<GraoData>("/grao_population.json"),
      tryFetch<CouncilData>("/council/index.json"),
    ]);

  const facts: Record<string, string | number> = {
    place: place.name,
    oblast: place.oblastName[ctx.lang],
  };
  const provenance: string[] = ["municipalities.json"];

  if (census?.population) {
    facts.population = fmtInt(census.population, ctx.lang);
    provenance.push(`census/municipalities/${code}.json`);
  }
  if (local) {
    const elected = local.mayor.elected;
    const topCouncil = [...local.council].sort(
      (a, b) => b.mandatesWon - a.mandatesWon,
    )[0];
    const turnout =
      local.protocol.numRegisteredVoters > 0
        ? round2(
            (100 * local.protocol.totalActualVoters) /
              local.protocol.numRegisteredVoters,
          )
        : null;
    facts.mayor = elected
      ? `${elected.candidateName} (${elected.localPartyName})`
      : "—";
    facts.council_leader = topCouncil
      ? `${topCouncil.localPartyName} (${topCouncil.mandatesWon})`
      : "—";
    facts.local_turnout = `${fmtPct(turnout, ctx.lang)} (${localCycleYear(cycle)})`;
    provenance.push(`${cycle}/municipalities/${place.obshtina}.json`);
  }
  const unemp = ind?.series?.unemployment?.[code];
  if (unemp && unemp.length) {
    const sel =
      asOfYear != null
        ? (unemp.find((p) => Number(p.year) === asOfYear) ??
          unemp[unemp.length - 1])
        : unemp[unemp.length - 1];
    facts.unemployment = `${sel.value}% (${sel.year})`;
    provenance.push("indicators.json");
  }
  const score = lisi?.scoresByObshtina?.[code];
  if (score) {
    facts.transparency = `${score.composite} (${ctx.lang === "bg" ? "място" : "rank"} ${score.nationalRank})`;
    provenance.push("municipal_transparency/index.json");
  }
  if (proc?.totalEur) {
    facts.local_procurement = fmtEurCompact(proc.totalEur, ctx.lang);
    provenance.push("db:procurement-settlement");
  }
  const graoRec = grao?.settlements?.[place.ekatte];
  if (graoRec?.permanent) {
    facts.registered_population = fmtInt(graoRec.permanent, ctx.lang);
    provenance.push("grao_population.json");
  }
  if (air?.stations) {
    const prefix = place.obshtina.slice(0, 3);
    const st = air.stations.filter(
      (s) => s.obshtina === place.obshtina || s.obshtina?.startsWith(prefix),
    );
    const worst = Math.max(0, ...st.map((s) => s.latestReadings?.pm10 ?? 0));
    if (worst > 0) {
      facts.air_pm10 = `${Math.round(worst)} µg/m³`;
      provenance.push("air/index.json");
    }
  }
  const resolutions = council?.resolutionsByObshtina?.[place.obshtina];
  if (resolutions?.length) {
    facts.council_resolutions = resolutions.length;
    provenance.push("council/index.json");
  }

  return {
    tool: "governanceProfile",
    domain: "place",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Профил на ${place.name}`
        : `${place.nameEn} — governance profile`,
    subtitle:
      asOfYear != null
        ? ctx.lang === "bg"
          ? `Към ${asOfYear} г. (където има данни)`
          : `As of ${asOfYear} (where available)`
        : undefined,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts,
    provenance,
  };
};

// ---- compare two places side by side ----------------------------------------
// Reuses governanceProfile for each place and lines the facts up in two columns.
const COMPARE_KEYS: { key: string; bg: string; en: string }[] = [
  { key: "population", bg: "Население", en: "Population" },
  {
    key: "registered_population",
    bg: "Регистрирано нас.",
    en: "Registered pop.",
  },
  { key: "mayor", bg: "Кмет", en: "Mayor" },
  {
    key: "council_leader",
    bg: "Първа партия в съвета",
    en: "Top council party",
  },
  { key: "local_turnout", bg: "Активност (местни)", en: "Turnout (local)" },
  { key: "unemployment", bg: "Безработица", en: "Unemployment" },
  { key: "transparency", bg: "Прозрачност (LISI)", en: "Transparency (LISI)" },
  { key: "local_procurement", bg: "Поръчки", en: "Procurement" },
  { key: "air_pm10", bg: "ФПЧ10", en: "PM10" },
  {
    key: "council_resolutions",
    bg: "Решения на съвета",
    en: "Council resolutions",
  },
];

export const comparePlaces = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const aq = String(args.a ?? "");
  const bq = String(args.b ?? "");
  const [pa, pb] = await Promise.all([
    resolveMunicipality(aq),
    resolveMunicipality(bq),
  ]);
  if (!pa || !pb) {
    return noPlace("comparePlaces", !pa ? aq : bq, ctx);
  }
  const [profA, profB] = await Promise.all([
    governanceProfile({ place: aq }, ctx),
    governanceProfile({ place: bq }, ctx),
  ]);
  const fa = profA.facts;
  const fb = profB.facts;
  const rows: Row[] = COMPARE_KEYS.filter(
    (k) => fa[k.key] != null || fb[k.key] != null,
  ).map((k) => ({
    metric: ctx.lang === "bg" ? k.bg : k.en,
    a: fa[k.key] ?? "—",
    b: fb[k.key] ?? "—",
  }));
  const nameA = String(fa.place ?? pa.name);
  const nameB = String(fb.place ?? pb.name);
  return {
    tool: "comparePlaces",
    domain: "place",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Сравнение: ${nameA} срещу ${nameB}`
        : `Comparison: ${nameA} vs ${nameB}`,
    columns: [
      { key: "metric", label: ctx.lang === "bg" ? "Показател" : "Metric" },
      { key: "a", label: nameA },
      { key: "b", label: nameB },
    ],
    rows,
    viz: "none",
    facts: { a: nameA, b: nameB, compared: rows.length },
    provenance: ["municipalities.json", ...profA.provenance.slice(1)],
  };
};

// ---- my-area recent-activity feed (alerts) ---------------------------------
// The per-município "Последна активност" feed materialised by
// scripts/myarea/build_alerts.ts — procurement (announced/awarded/annex), EU
// funds (incl. snapshot-diff new/modified), council resolutions, capital
// programmes, local elections and plenary keyword hits. Keyed by obshtina.

type AlertEventRow = {
  date: string;
  kind:
    | "procurement"
    | "eu_funds"
    | "local_election"
    | "capital_program"
    | "plenary_keyword"
    | "council_resolution";
  headline_bg: string;
  headline_en: string;
  detail?: string;
  programPeriod?: string;
  noticeType?: "announced" | "awarded" | "annex";
  changeType?: "new" | "modified";
};
type AlertsFeed = { obshtina: string; events: AlertEventRow[] };

// Sofia city's alert feed is keyed SFO_CITY in build_alerts (municipalities.json),
// while resolvePlaceForData hands back the synthetic "SOF" obshtina.
const alertObshtina = (obshtina: string): string =>
  obshtina === "SOF" ? "SFO_CITY" : obshtina;

const eventTypeLabel = (e: AlertEventRow, bg: boolean): string => {
  if (e.kind === "procurement") {
    if (e.noticeType === "announced")
      return bg ? "Обявена поръчка" : "Announced";
    if (e.noticeType === "annex") return bg ? "Анекс" : "Amendment";
    return bg ? "Възложена поръчка" : "Awarded";
  }
  if (e.kind === "eu_funds") {
    if (e.changeType === "new")
      return bg ? "Нов проект (ЕС)" : "New EU project";
    if (e.changeType === "modified")
      return bg ? "Промяна (ЕС)" : "EU project changed";
    return bg ? "Еврофонд" : "EU funds";
  }
  if (e.kind === "council_resolution")
    return bg ? "Решение на ОбС" : "Council vote";
  if (e.kind === "local_election")
    return bg ? "Местни избори" : "Local election";
  if (e.kind === "capital_program")
    return bg ? "Капиталова програма" : "Capital programme";
  return bg ? "Парламент" : "Parliament";
};

export const myAreaAlerts = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const q = String(args.place ?? "");
  const place = await resolvePlaceForData(q);
  if (!place) return noPlace("myAreaAlerts", q, ctx);
  const key = alertObshtina(place.obshtina);
  const feed = await tryFetch<AlertsFeed>(`/myarea/alerts/${key}.json`);
  if (!feed || feed.events.length === 0) {
    return {
      tool: "myAreaAlerts",
      domain: "place",
      kind: "scalar",
      title: bg
        ? `Няма скорошна активност за ${place.name}`
        : `No recent activity for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`myarea/alerts/${key}.json`],
    };
  }
  // Count by kind + sub-type so the LLM can summarise "what's new here".
  const count = (pred: (e: AlertEventRow) => boolean): number =>
    feed.events.filter(pred).length;
  const announced = count((e) => e.noticeType === "announced");
  const awarded = count((e) => e.noticeType === "awarded");
  const annex = count((e) => e.noticeType === "annex");
  const euNew = count((e) => e.changeType === "new");
  const euModified = count((e) => e.changeType === "modified");

  const top = feed.events.slice(0, 12);
  const columns: Column[] = [
    { key: "date", label: bg ? "Дата" : "Date" },
    { key: "type", label: bg ? "Вид" : "Type" },
    { key: "what", label: bg ? "Какво" : "What" },
  ];
  const rows: Row[] = top.map((e) => ({
    date: e.programPeriod ?? e.date,
    type: eventTypeLabel(e, bg),
    what: bg ? e.headline_bg : e.headline_en,
  }));
  return {
    tool: "myAreaAlerts",
    domain: "place",
    kind: "table",
    title: bg
      ? `Скорошна активност — ${place.name}`
      : `Recent activity — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      bg ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      events: fmtInt(feed.events.length, ctx.lang),
      procurement_announced: fmtInt(announced, ctx.lang),
      procurement_awarded: fmtInt(awarded, ctx.lang),
      procurement_annex: fmtInt(annex, ctx.lang),
      eu_new: fmtInt(euNew, ctx.lang),
      eu_modified: fmtInt(euModified, ctx.lang),
    },
    provenance: [`myarea/alerts/${key}.json`],
  };
};

// ---- EU-funds projects for a place (incl. new/modified) ---------------------

type FundsMuniSummary = {
  rollup: { contractCount: number; totalEur: number; paidEur: number };
  topContracts: {
    title: string;
    totalEur: number;
    paidEur: number;
    programName: string;
    beneficiaryName: string;
  }[];
};
type FundsChange = {
  contractNumber: string;
  title: string;
  type: "new" | "modified";
  totalEur?: number;
};
type FundsChangesFeed = { changes: FundsChange[] };

export const placeEuProjects = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const q = String(args.place ?? "");
  const place = await resolvePlaceForData(q);
  if (!place) return noPlace("placeEuProjects", q, ctx);
  // Sofia city's funds shards are keyed S22 (districts S23xx/S24xx/S25xx);
  // resolvePlaceForData hands back the synthetic "SOF" and build_alerts uses
  // "SFO_CITY", so the funds tree never has a SOF/SFO_CITY shard.
  const obshtina =
    place.obshtina === "SOF" || place.obshtina === "SFO_CITY"
      ? "S22"
      : place.obshtina;
  const summary = await tryFetch<FundsMuniSummary>(
    `/funds/projects/by-muni/${obshtina}-summary.json`,
  );
  const changes = await tryFetch<FundsChangesFeed>(
    `/funds/projects/changes/${obshtina}.json`,
  );
  if (!summary) {
    return {
      tool: "placeEuProjects",
      domain: "place",
      kind: "scalar",
      title: bg
        ? `Няма проекти от еврофондове за ${place.name}`
        : `No EU-funds projects for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`funds/projects/by-muni/${obshtina}-summary.json`],
    };
  }
  const newCount = changes?.changes.filter((c) => c.type === "new").length ?? 0;
  const modCount =
    changes?.changes.filter((c) => c.type === "modified").length ?? 0;
  const top = summary.topContracts.slice(0, 8);
  const columns: Column[] = [
    { key: "project", label: bg ? "Проект" : "Project" },
    { key: "value", label: bg ? "Стойност" : "Value", numeric: true },
    { key: "paid", label: bg ? "Изплатено" : "Paid", numeric: true },
  ];
  const rows: Row[] = top.map((c) => ({
    project: c.title,
    value: fmtEurCompact(c.totalEur, ctx.lang),
    paid: fmtEurCompact(c.paidEur, ctx.lang),
  }));
  return {
    tool: "placeEuProjects",
    domain: "place",
    kind: "table",
    title: bg
      ? `Проекти от еврофондове — ${place.name}`
      : `EU-funds projects — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      bg ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      contracts: fmtInt(summary.rollup.contractCount, ctx.lang),
      total: fmtEurCompact(summary.rollup.totalEur, ctx.lang),
      paid: fmtEurCompact(summary.rollup.paidEur, ctx.lang),
      new_projects: fmtInt(newCount, ctx.lang),
      modified_projects: fmtInt(modCount, ctx.lang),
    },
    provenance: [
      `funds/projects/by-muni/${obshtina}-summary.json`,
      `funds/projects/changes/${obshtina}.json`,
    ],
  };
};

function noPlace(tool: string, query: string, ctx: ToolContext): Envelope {
  return {
    tool,
    domain: "place",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Не намерих място „${query}“`
        : `No place matched "${query}"`,
    viz: "none",
    facts: { query },
    provenance: ["municipalities.json"],
  };
}
