// Phase B — place-based governance tools (sub-national + regional indicators,
// LISI transparency, local taxes). All resolve a place via place.ts.

import { fetchData } from "./dataClient";
import { resolveMunicipality, resolveOblast } from "./place";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// LISI + local-taxes shards key Sofia as SOF00 (not the synthetic SOF).
const govCode = (obshtina: string): string =>
  obshtina === "SOF" ? "SOF00" : obshtina;

// ---- sub-national indicators (per município) --------------------------------

const SUBNAT_ALIASES: Record<string, string> = {
  безработица: "unemployment",
  unemployment: "unemployment",
  матура: "dzi",
  дзи: "dzi",
  matura: "dzi",
  dzi: "dzi",
  миграция: "netMigration",
  migration: "netMigration",
  население: "populationChange",
  population: "populationChange",
};
export const resolveSubnatKey = (raw: string): string | undefined => {
  const q = raw.toLowerCase();
  for (const [k, v] of Object.entries(SUBNAT_ALIASES))
    if (q.includes(k)) return v;
  return undefined;
};

type IndMeta = {
  labelBg: string;
  labelEn: string;
  unitBg?: string;
  unitEn?: string;
};
type IndPoint = { year: number; value: number };
type IndData = {
  indicators: Record<string, IndMeta>;
  series: Record<string, Record<string, IndPoint[]>>;
};

export const subnationalIndicator = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  const key =
    (typeof args.indicator === "string" && resolveSubnatKey(args.indicator)) ||
    "unemployment";
  if (!place) {
    return notFoundPlace(
      "subnationalIndicator",
      String(args.place ?? ""),
      ctx,
      ["indicators.json"],
    );
  }
  const d = await fetchData<IndData>("/indicators.json");
  const meta = d.indicators[key];
  const pts = d.series[key]?.[place.obshtina] ?? [];
  if (!meta || pts.length === 0) {
    return {
      tool: "subnationalIndicator",
      domain: "indicators",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за ${place.name}`
          : `No data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["indicators.json"],
    };
  }
  const label = ctx.lang === "bg" ? meta.labelBg : meta.labelEn;
  const unit = ctx.lang === "bg" ? meta.unitBg : meta.unitEn;
  const last = pts[pts.length - 1];
  return {
    tool: "subnationalIndicator",
    domain: "indicators",
    kind: "series",
    title: `${label} — ${ctx.lang === "bg" ? place.name : place.nameEn}${unit ? ` (${unit})` : ""}`,
    categories: pts.map((p) => p.year),
    series: [
      {
        key: "value",
        label,
        points: pts.map((p) => ({ x: p.year, y: p.value })),
      },
    ],
    viz: "line",
    facts: {
      place: place.name,
      indicator: label,
      latest_year: last.year,
      latest_value: last.value,
    },
    provenance: ["indicators.json"],
  };
};

// ---- regional indicators (per oblast / NUTS3) -------------------------------

const REGION_ALIASES: Record<string, string> = {
  бвп: "gdpPerCapita",
  gdp: "gdpPerCapita",
  население: "population",
  population: "population",
  миграция: "netMigration",
  migration: "netMigration",
  безработица: "ltUnemployment",
  unemployment: "ltUnemployment",
};
export const resolveRegionKey = (raw: string): string | undefined => {
  const q = raw.toLowerCase();
  for (const [k, v] of Object.entries(REGION_ALIASES))
    if (q.includes(k)) return v;
  return undefined;
};

type RegMeta = {
  titleBg: string;
  titleEn: string;
  unitLabelBg?: string;
  unitLabelEn?: string;
};
type RegData = {
  indicators: Record<string, RegMeta>;
  series: Record<string, Record<string, IndPoint[]>>;
};

export const regionIndicator = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const obl = resolveOblast(String(args.oblast ?? ""));
  const key =
    (typeof args.indicator === "string" && resolveRegionKey(args.indicator)) ||
    "gdpPerCapita";
  if (!obl) {
    return notFoundPlace("regionIndicator", String(args.oblast ?? ""), ctx, [
      "regional.json",
    ]);
  }
  const d = await fetchData<RegData>("/regional.json");
  const meta = d.indicators[key];
  const pts = d.series[key]?.[obl.code] ?? [];
  if (!meta || pts.length === 0) {
    return {
      tool: "regionIndicator",
      domain: "indicators",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за ${obl.name.bg}`
          : `No data for ${obl.name.en}`,
      viz: "none",
      facts: { oblast: obl.name[ctx.lang] },
      provenance: ["regional.json"],
    };
  }
  const title = ctx.lang === "bg" ? meta.titleBg : meta.titleEn;
  const unit = ctx.lang === "bg" ? meta.unitLabelBg : meta.unitLabelEn;
  const last = pts[pts.length - 1];
  return {
    tool: "regionIndicator",
    domain: "indicators",
    kind: "series",
    title: `${title} — ${obl.name[ctx.lang]}${unit ? ` (${unit})` : ""}`,
    categories: pts.map((p) => p.year),
    series: [
      {
        key: "value",
        label: title,
        points: pts.map((p) => ({ x: p.year, y: p.value })),
      },
    ],
    viz: "line",
    facts: {
      oblast: obl.name[ctx.lang],
      indicator: title,
      latest_year: last.year,
      latest_value: last.value,
    },
    provenance: ["regional.json"],
  };
};

// ---- LISI transparency (27 oblast centres) ----------------------------------

type LisiData = {
  nationalAverage: number;
  scoresByObshtina: Record<string, { composite: number; nationalRank: number }>;
};

export const transparencyScore = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) {
    return notFoundPlace("transparencyScore", String(args.place ?? ""), ctx, [
      "municipal_transparency/index.json",
    ]);
  }
  const d = await fetchData<LisiData>("/municipal_transparency/index.json");
  const score = d.scoresByObshtina[govCode(place.obshtina)];
  if (!score) {
    return {
      tool: "transparencyScore",
      domain: "indicators",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `LISI обхваща само 27 областни центъра — ${place.name} не е сред тях`
          : `LISI covers only 27 oblast centres — ${place.nameEn} isn't one`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["municipal_transparency/index.json"],
    };
  }
  return {
    tool: "transparencyScore",
    domain: "indicators",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Прозрачност (LISI) — ${place.name}`
        : `Transparency (LISI) — ${place.nameEn}`,
    viz: "none",
    facts: {
      place: place.name,
      composite: score.composite,
      national_rank: score.nationalRank,
      national_average: d.nationalAverage,
    },
    provenance: ["municipal_transparency/index.json"],
  };
};

// ---- local taxes (per município) --------------------------------------------

type TaxIndicator = {
  key: string;
  unit: string;
  label: { bg: string; en: string };
};
type TaxIndex = {
  indicators: TaxIndicator[];
  nationalAverages: Record<string, number>;
};
type TaxShard = {
  obshtina: string;
  ipi: Record<string, { latestValue: number; nationalRank: number }>;
};

export const localTaxes = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) {
    return notFoundPlace("localTaxes", String(args.place ?? ""), ctx, [
      "local_taxes/index.json",
    ]);
  }
  const idx = await fetchData<TaxIndex>("/local_taxes/index.json");
  let shard: TaxShard;
  try {
    shard = await fetchData<TaxShard>(
      `/local_taxes/${govCode(place.obshtina)}.json`,
    );
  } catch {
    return {
      tool: "localTaxes",
      domain: "indicators",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данъчни данни за ${place.name}`
          : `No tax data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: [`local_taxes/${govCode(place.obshtina)}.json`],
    };
  }
  const columns: Column[] = [
    { key: "tax", label: ctx.lang === "bg" ? "Данък" : "Tax" },
    {
      key: "value",
      label: ctx.lang === "bg" ? "Ставка" : "Rate",
      numeric: true,
    },
    { key: "avg", label: ctx.lang === "bg" ? "Средно" : "Avg", numeric: true },
    {
      key: "rank",
      label: ctx.lang === "bg" ? "Място" : "Rank",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = idx.indicators
    .filter((ind) => shard.ipi[ind.key])
    .map((ind) => ({
      tax: ind.label[ctx.lang],
      value: `${shard.ipi[ind.key].latestValue} ${ind.unit}`,
      avg: `${idx.nationalAverages[ind.key]} ${ind.unit}`,
      rank: shard.ipi[ind.key].nationalRank,
    }));
  return {
    tool: "localTaxes",
    domain: "indicators",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Местни данъци — ${place.name}`
        : `Local taxes — ${place.nameEn}`,
    columns,
    rows,
    viz: "none",
    facts: {
      place: place.name,
      indicators: rows.length,
    },
    provenance: [
      "local_taxes/index.json",
      `local_taxes/${govCode(place.obshtina)}.json`,
    ],
  };
};

// ---- shared --------------------------------------------------------

function notFoundPlace(
  tool: string,
  query: string,
  ctx: ToolContext,
  provenance: string[],
): Envelope {
  return {
    tool,
    domain: "indicators",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Не намерих място „${query}“`
        : `No place matched "${query}"`,
    viz: "none",
    facts: { query },
    provenance,
  };
}
