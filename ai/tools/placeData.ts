// D3 — per-place environment / population / council tools.

import { fetchData, fetchDb } from "./dataClient";
import { fmtInt } from "./format";
import {
  resolveMunicipality,
  resolveOblast,
  resolvePlaceForData,
} from "./place";
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
  // exact município/settlement before fuzzy -> a named village resolves to its
  // own ekatte ("Баня"), not a substring município ("Долна баня").
  const q = String(args.place ?? "");
  const place = await resolvePlaceForData(q);
  if (!place) return noPlace("graoPopulation", q, ctx);
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

/** The `/api/db/council-muni` payload, narrowed to what this tool reads.
 *  Mirrors CouncilMuniDetail in src/data/council/useCouncilHub.tsx — a chat
 *  tool cannot import from src/, so the shape is restated rather than shared. */
type CouncilMuniDetail = {
  name: string;
  resolutionCount: number;
  resolutions: {
    id: string;
    decidedOn: string;
    number: string | null;
    title: string;
    tallyFor: number | null;
    tallyAgainst: number | null;
    tallyAbstain: number | null;
  }[];
};

/** 2,234 of 4,727 resolutions (47%) store the literal "(no title parsed)" —
 *  the scraper's placeholder for minutes it could read but whose subject line
 *  it could not isolate. Reading that back in a chat answer states a parser's
 *  internal condition as the subject of a public decision. The FOURTH copy of
 *  this rule (functions/spa_page.js, CouncilResolutionScreen.tsx,
 *  scripts/db/lib/council_alerts.ts); a chat tool can import from none of them. */
const councilTitle = (
  r: CouncilMuniDetail["resolutions"][number],
  lang: string,
): string => {
  const parsed =
    r.title && !/^\(?\s*no title parsed\s*\)?$/i.test(r.title.trim())
      ? r.title.trim()
      : null;
  // Bilingual: Русе is 211 of 211 placeholders, so an English reader asking
  // about it would otherwise get ten Bulgarian rows under an English title.
  // The resolution TITLES stay Bulgarian when they exist — they are the
  // instrument's own name, and translating one would be inventing it.
  if (!parsed)
    return lang === "bg"
      ? `Решение № ${r.number ?? "—"} от ${r.decidedOn}`
      : `Decision no. ${r.number ?? "—"} of ${r.decidedOn}`;
  return parsed.length > 70 ? `${parsed.slice(0, 70)}…` : parsed;
};

export const councilResolutions = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place)
    return noPlace("councilResolutions", String(args.place ?? ""), ctx);
  // ONE scoped call. This used to fetch the whole 1,542 KB council/index.json
  // to answer about one município — and that file is capped at 200 resolutions
  // per município (six of sixteen exceed it), so the tool could under-report a
  // council's own history and had no way to know it.
  //
  // The code mapping that stood here was the FOURTH copy, and the least safe:
  // it tried place.obshtina, then fell back to a fuzzy substring match of the
  // council's name across every entry. A substring fallback over 265
  // municipalities is a wrong-place answer waiting to happen in a surface that
  // speaks in sentences — „Стара Загора" contains „Загора", and the tool would
  // have answered confidently with another council's decisions. /api/db/
  // council-muni resolves the code server-side through council_muni_code, so
  // there is nothing to guess: a município with no council returns null.
  //
  // Deliberately NOT wrapped in .catch(() => null). The route's null body means
  // "this place has no council" — 249 of 265 — while a throw means the lookup
  // FAILED. Collapsing them would print „още не са индексирани" plus „Покритие:
  // 16 общини" during any outage: a false claim about our coverage, stated
  // confidently, in a surface that speaks in sentences. Same invariant
  // src/data/council/useCouncilHub.tsx documents for this route, and the
  // behaviour the previous fetchData() call had. governanceProfile's catch is
  // the opposite case and correctly stays: it omits a fact rather than making
  // a claim.
  const detail = await fetchDb<CouncilMuniDetail | null>("council-muni", {
    code: place.obshtina,
    limit: 10,
  });
  const list: CouncilMuniDetail["resolutions"] = detail?.resolutions ?? [];
  if (list.length === 0) {
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
      provenance: ["db:council-muni"],
    };
  }
  // Already ordered decided_on DESC by the route, and already capped at 10.
  const recent = list;
  const columns: Column[] = [
    { key: "date", label: ctx.lang === "bg" ? "Дата" : "Date" },
    { key: "num", label: "№" },
    { key: "title", label: ctx.lang === "bg" ? "Решение" : "Resolution" },
    { key: "vote", label: ctx.lang === "bg" ? "За/Пр/Възд" : "For/Ag/Abs" },
  ];
  const rows: Row[] = recent.map((r) => ({
    date: r.decidedOn,
    num: r.number ?? "—",
    // 47% of the corpus stores the scraper's "(no title parsed)" placeholder.
    // Reading it out loud in a chat answer publishes a parser's internal state
    // as the subject of a decision.
    title: councilTitle(r, ctx.lang),
    vote:
      r.tallyFor != null
        ? `${r.tallyFor ?? "—"}/${r.tallyAgainst ?? "—"}/${r.tallyAbstain ?? "—"}`
        : "—",
  }));
  return {
    tool: "councilResolutions",
    domain: "place",
    kind: "table",
    // The COUNCIL's name, not the place's. A reader in район Красно село is
    // served Столична община's 413 decisions, and titling that „Общински съвет
    // — Красно село" names a council that does not exist. `detail.name` is the
    // council_muni row the route resolved to; the place name is the fallback
    // only when the payload somehow lacks one.
    title:
      ctx.lang === "bg"
        ? `Решения на Общински съвет — ${detail?.name ?? place.name}`
        : `Municipal council resolutions — ${detail?.name ?? place.nameEn}`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      // hidden deep-link key -> this município's governance page (council tile)
      obshtina_id: place.obshtina,
      place: place.name,
      // The council's WHOLE history, not the ten rows shown — the route
      // reports it separately, and `list.length` is the page size.
      total: fmtInt(detail?.resolutionCount ?? list.length, ctx.lang),
      latest: recent[0]?.decidedOn ?? "—",
    },
    provenance: ["db:council-muni"],
  };
};
