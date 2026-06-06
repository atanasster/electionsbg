// Phase C — local procurement (by settlement) + the composite governance profile
// for a place (the "about my area" place-ladder dashboard).

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import {
  fetchLocalMuni,
  localCycleYear,
  resolveLocalCycle,
} from "./localDataset";
import { resolveMunicipality } from "./place";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

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
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noPlace("procurementBySettlement", String(args.place ?? ""), ctx);
  const data = await tryFetch<SettlementProc>(
    `/procurement/by_settlement/${place.ekatte}.json`,
  );
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
      provenance: [`procurement/by_settlement/${place.ekatte}.json`],
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
    facts: {
      place: place.name,
      total: fmtEurCompact(data.totalEur, ctx.lang),
      contracts: fmtInt(data.contractCount, ctx.lang),
      top_buyer: top[0]?.name ?? "—",
    },
    provenance: [`procurement/by_settlement/${place.ekatte}.json`],
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
  const cycle = resolveLocalCycle(undefined);

  const [census, local, lisi, ind, proc, air, grao, council] =
    await Promise.all([
      tryFetch<CensusMuni>(`/census/municipalities/${code}.json`),
      fetchLocalMuni(cycle, place.obshtina).catch(() => null),
      tryFetch<LisiData>("/municipal_transparency/index.json"),
      tryFetch<IndData>("/indicators.json"),
      tryFetch<SettlementProc>(
        `/procurement/by_settlement/${place.ekatte}.json`,
      ),
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
    const last = unemp[unemp.length - 1];
    facts.unemployment = `${last.value}% (${last.year})`;
    provenance.push("indicators.json");
  }
  const score = lisi?.scoresByObshtina?.[code];
  if (score) {
    facts.transparency = `${score.composite} (${ctx.lang === "bg" ? "място" : "rank"} ${score.nationalRank})`;
    provenance.push("municipal_transparency/index.json");
  }
  if (proc?.totalEur) {
    facts.local_procurement = fmtEurCompact(proc.totalEur, ctx.lang);
    provenance.push(`procurement/by_settlement/${place.ekatte}.json`);
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
    viz: "none",
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
