// D3 — per-place environment / population / council tools.

import { fetchData } from "./dataClient";
import { fmtInt } from "./format";
import { resolveMunicipality, resolveOblast } from "./place";
import { muniLocator, oblastLocator } from "./geo";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

const noPlace = (tool: string, query: string, ctx: ToolContext): Envelope => ({
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
});

// ---- air quality ------------------------------------------------------------

type Station = {
  id: string;
  name: string;
  obshtina?: string;
  latestReadings?: { pm10?: number; pm25?: number };
};
type AirData = {
  pollutants: Record<
    string,
    { bg: string; en: string; unit: string; euLimit?: number }
  >;
  stations: Station[];
};

export const airQuality = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noPlace("airQuality", String(args.place ?? ""), ctx);
  const d = await fetchData<AirData>("/air/index.json");
  const prefix = place.obshtina.slice(0, 3);
  let stations = d.stations.filter((s) => s.obshtina === place.obshtina);
  if (stations.length === 0)
    stations = d.stations.filter((s) => s.obshtina?.startsWith(prefix));
  if (stations.length === 0) {
    return {
      tool: "airQuality",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма станция за качество на въздуха близо до ${place.name}`
          : `No air-quality station near ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["air/index.json"],
    };
  }
  const pm10Limit = d.pollutants.pm10?.euLimit ?? 50;
  const columns: Column[] = [
    { key: "station", label: ctx.lang === "bg" ? "Станция" : "Station" },
    { key: "pm10", label: "ФПЧ10 / PM10", numeric: true },
    { key: "pm25", label: "ФПЧ2.5 / PM2.5", numeric: true },
  ];
  const rows: Row[] = stations.map((s) => ({
    station: s.name,
    pm10: s.latestReadings?.pm10 != null ? round2(s.latestReadings.pm10) : null,
    pm25: s.latestReadings?.pm25 != null ? round2(s.latestReadings.pm25) : null,
  }));
  const worst = Math.max(...stations.map((s) => s.latestReadings?.pm10 ?? 0));
  return {
    tool: "airQuality",
    domain: "place",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Качество на въздуха — ${place.name}`
        : `Air quality — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      stations: stations.length,
      worst_pm10: round2(worst),
      eu_limit_pm10: pm10Limit,
      over_limit:
        worst > pm10Limit
          ? ctx.lang === "bg"
            ? "над нормата"
            : "over limit"
          : ctx.lang === "bg"
            ? "в нормата"
            : "within limit",
    },
    provenance: ["air/index.json"],
  };
};

// ---- land use (per oblast) --------------------------------------------------

type LandScope = {
  nameBg: string;
  nameEn: string;
  totalKm2: number;
  byCategoryKm2: Record<string, number>;
  byCategoryPct?: Record<string, number>;
};
type LandData = {
  latestYear: number;
  categories: { key: string; bg: string; en: string }[];
  years: Record<
    string,
    { national: LandScope; oblasts: Record<string, LandScope> }
  >;
};

export const landUse = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<LandData>("/landuse/index.json");
  const yearKey = String(d.latestYear ?? Object.keys(d.years).sort().pop());
  const yr = d.years[yearKey];
  const obl = args.oblast ? resolveOblast(String(args.oblast)) : undefined;
  const scope =
    obl && yr.oblasts[obl.code] ? yr.oblasts[obl.code] : yr.national;
  const total = scope.totalKm2 || 0;
  const rows: Row[] = d.categories
    .map((c) => {
      const km2 = scope.byCategoryKm2[c.key] ?? 0;
      return {
        category: ctx.lang === "bg" ? c.bg : c.en,
        km2: round2(km2),
        pct: total > 0 ? round2((100 * km2) / total) : 0,
      };
    })
    .filter((r) => (r.km2 as number) > 0)
    .sort((a, b) => (b.km2 as number) - (a.km2 as number));
  const name = ctx.lang === "bg" ? scope.nameBg : scope.nameEn;
  return {
    tool: "landUse",
    domain: "indicators",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Земеползване — ${name} (${yearKey})`
        : `Land use — ${name} (${yearKey})`,
    columns: [
      {
        key: "category",
        label: ctx.lang === "bg" ? "Тип територия" : "Land type",
      },
      { key: "km2", label: "km²", numeric: true },
      { key: "pct", label: "%", numeric: true, format: "pct" },
    ],
    rows,
    categories: rows.map((r) => r.category as string),
    series: [
      {
        key: "km2",
        label: "km²",
        points: rows.map((r) => ({
          x: r.category as string,
          y: r.km2 as number,
        })),
      },
    ],
    viz: "bar",
    // Highlight the oblast on the map when one is named (national view has no
    // single area to locate).
    ...(obl ? { geo: oblastLocator(obl.code, obl.name[ctx.lang]) } : {}),
    facts: {
      scope: name,
      total_km2: fmtInt(Math.round(total), ctx.lang),
      largest: rows[0]?.category ?? "—",
    },
    provenance: ["landuse/index.json"],
  } as Envelope;
};

// ---- GRAO registered population ---------------------------------------------

type GraoData = {
  asOf?: string;
  settlements: Record<string, { permanent: number; current: number }>;
};

export const graoPopulation = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noPlace("graoPopulation", String(args.place ?? ""), ctx);
  const d = await fetchData<GraoData>("/grao_population.json");
  const rec = d.settlements[place.ekatte];
  if (!rec) {
    return {
      tool: "graoPopulation",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма ГРАО данни за ${place.name}`
          : `No GRAO data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["grao_population.json"],
    };
  }
  return {
    tool: "graoPopulation",
    domain: "place",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Регистрирано население (ГРАО) — ${place.name}`
        : `Registered population (GRAO) — ${place.nameEn}`,
    subtitle:
      ctx.lang === "bg"
        ? "по постоянен и настоящ адрес (административен център)"
        : "by permanent and current address (administrative centre)",
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      permanent: fmtInt(rec.permanent, ctx.lang),
      current: fmtInt(rec.current, ctx.lang),
      as_of: d.asOf ?? "—",
    },
    provenance: ["grao_population.json"],
  };
};

// ---- municipal council resolutions ------------------------------------------

type Resolution = {
  date: string;
  session?: string;
  number?: string;
  title: string;
  tally?: { for?: number; against?: number; abstain?: number };
};
type CouncilData = {
  resolutionsByObshtina: Record<string, Resolution[]>;
  meta?: Record<string, { name?: string }>;
};

const normName = (s: string): string =>
  s.toLowerCase().replace(/[\s.\-_/]+/g, "");

export const councilResolutions = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noPlace("councilResolutions", String(args.place ?? ""), ctx);
  const d = await fetchData<CouncilData>("/council/index.json");
  // The council ingest keys some oblast centres with a different obshtina code
  // than municipalities.json (e.g. Русе = RSE01 vs RSE27). Try the code first,
  // then fall back to matching the council entry's name.
  let list = d.resolutionsByObshtina[place.obshtina];
  if (!list && d.meta) {
    const target = normName(place.name);
    for (const [code, m] of Object.entries(d.meta)) {
      if (m.name && normName(m.name).includes(target)) {
        list = d.resolutionsByObshtina[code];
        break;
      }
    }
  }
  if (!list || list.length === 0) {
    return {
      tool: "councilResolutions",
      domain: "place",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Решенията на ОбС ${place.name} още не са индексирани`
          : `${place.nameEn} council resolutions aren't indexed yet`,
      viz: "none",
      facts: {
        place: place.name,
        note:
          ctx.lang === "bg"
            ? "Покритие: 16 общини"
            : "Coverage: 16 municipalities",
      },
      provenance: ["council/index.json"],
    };
  }
  const recent = [...list]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  const columns: Column[] = [
    { key: "date", label: ctx.lang === "bg" ? "Дата" : "Date" },
    { key: "num", label: "№" },
    { key: "title", label: ctx.lang === "bg" ? "Решение" : "Resolution" },
    { key: "vote", label: ctx.lang === "bg" ? "За/Пр/Възд" : "For/Ag/Abs" },
  ];
  const rows: Row[] = recent.map((r) => ({
    date: r.date,
    num: r.number ?? "—",
    title: r.title.length > 70 ? `${r.title.slice(0, 70)}…` : r.title,
    vote: r.tally
      ? `${r.tally.for ?? "—"}/${r.tally.against ?? "—"}/${r.tally.abstain ?? "—"}`
      : "—",
  }));
  return {
    tool: "councilResolutions",
    domain: "place",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Решения на Общински съвет — ${place.name}`
        : `Municipal council resolutions — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      place: place.name,
      total: fmtInt(list.length, ctx.lang),
      latest: recent[0]?.date ?? "—",
    },
    provenance: ["council/index.json"],
  };
};
