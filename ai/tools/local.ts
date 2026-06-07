// Local-elections (municipal) tools.

import {
  fetchLocalIndex,
  fetchLocalMuni,
  localCycleNames,
  localCycleYear,
  resolveLocalCycle,
} from "./localDataset";
import { fmtInt, fmtPct } from "./format";
import { findOblastInText, resolveMunicipality, resolveOblast } from "./place";
import { muniChoropleth, muniLocator } from "./geo";
import { round2 } from "./dataset";
import type {
  Column,
  Envelope,
  GeoArea,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

// Neutral fill for independents / local nomination committees (no party colour).
const INDEP_COLOR = "#9aa0a6";

const cycleLabel = (cycle: string, lang: ToolContext["lang"]): string => {
  const y = localCycleYear(cycle);
  return lang === "bg" ? `Местни избори ${y}` : `${y} local elections`;
};

export const localCouncilVoteShare = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const idx = await fetchLocalIndex(cycle);
  const rows = [...idx.councilVoteShare]
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 12);

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const tableRows: Row[] = rows.map((r) => ({
    party: r.displayName,
    votes: r.totalVotes,
    pct: round2(r.pctOfValid),
  }));

  const facts: Record<string, string | number> = {
    cycle: localCycleYear(cycle),
    leader: rows[0]?.displayName ?? "—",
  };
  rows.slice(0, 4).forEach((r) => {
    facts[r.displayName] =
      `${fmtInt(r.totalVotes, ctx.lang)} (${fmtPct(round2(r.pctOfValid), ctx.lang)})`;
  });

  return {
    tool: "localCouncilVoteShare",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Общински съвети — гласове по партия (${cycleLabel(cycle, "bg")})`
        : `Council vote share by party (${cycleLabel(cycle, "en")})`,
    columns,
    rows: tableRows,
    categories: rows.map((r) => r.displayName),
    series: [
      {
        key: "votes",
        label: ctx.lang === "bg" ? "Гласове" : "Votes",
        points: rows.map((r) => ({ x: r.displayName, y: r.totalVotes })),
      },
    ],
    viz: "bar",
    facts,
    provenance: [`${cycle}/index.json`],
  } as Envelope;
};

export const localMayorsWon = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const idx = await fetchLocalIndex(cycle);
  const rows = [...idx.mayorsByCanonical]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "mayors",
      label: ctx.lang === "bg" ? "Кметове" : "Mayors",
      numeric: true,
      format: "int",
    },
  ];
  const facts: Record<string, string | number> = {
    cycle: localCycleYear(cycle),
    leader: rows[0] ? `${rows[0].displayName} (${rows[0].count})` : "—",
  };
  rows.slice(0, 4).forEach((r) => {
    facts[r.displayName] = r.count;
  });

  return {
    tool: "localMayorsWon",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Спечелени кметски места по партия (${cycleLabel(cycle, "bg")})`
        : `Mayors won by party (${cycleLabel(cycle, "en")})`,
    columns,
    rows: rows.map((r) => ({ party: r.displayName, mayors: r.count })),
    categories: rows.map((r) => r.displayName),
    series: [
      {
        key: "mayors",
        label: ctx.lang === "bg" ? "Кметове" : "Mayors",
        points: rows.map((r) => ({ x: r.displayName, y: r.count })),
      },
    ],
    viz: "bar",
    facts,
    provenance: [`${cycle}/index.json`],
  } as Envelope;
};

// ---- local trends across cycles --------------------------------------------
// The cross-cycle companions to localCouncilVoteShare / localMayorsWon. Each
// regular local cycle's index.json already canonicalises parties (canonicalId +
// displayName + colour), so threading a party across 2007→2023 is a join on
// canonicalId — no canonical_parties lookup needed. Builds a multi-line trend of
// the most significant parties (peak value), capped for legibility.

const MAX_LOCAL_TREND_LINES = 7;

type LocalTrendRow = {
  canonicalId: string;
  displayName: string;
  color?: string;
  value: number;
};

// The older cycles (2007/2011) didn't fully canonicalise — a party that newer
// cycles key as `gerb`/`bsp`/`p_16` (ДПС) is left as a `local:<full-name>` id,
// and 2007 even splits ГЕРБ across BOTH a clean and a local id. Merge the few
// recurring big parties by a distinctive name substring so each reads as ONE
// line; genuine local nomination committees keep their own id (and never reach
// the top-N anyway). The canonical register can't drive this — its history
// names don't include the standalone "БЪЛГАРСКА СОЦИАЛИСТИЧЕСКА ПАРТИЯ" form.
const LOCAL_ALIAS: [RegExp, string][] = [
  [/герб/, "gerb"],
  [/социалистическ/, "bsp"], // БЪЛГАРСКА СОЦИАЛИСТИЧЕСКА ПАРТИЯ → БСП
  [/движение за права/, "p_16"], // ДПС
];
const canonicalLocalId = (id: string, name: string): string => {
  if (!id.startsWith("local:")) return id; // already a clean canonical id
  const n = name.toLowerCase();
  for (const [re, cid] of LOCAL_ALIAS) if (re.test(n)) return cid;
  return id;
};

// Shared builder: `rowsOf` lists a cycle's party rows (canonical id + metric).
const buildLocalTrend = async (
  ctx: ToolContext,
  opts: {
    tool: string;
    rowsOf: (
      idx: Awaited<ReturnType<typeof fetchLocalIndex>>,
    ) => LocalTrendRow[];
    title: { bg: string; en: string };
    subtitle: { bg: string; en: string };
    seriesLabel: { bg: string; en: string };
    unit: { bg: string; en: string };
    pct: boolean; // true: format facts as %; false: raw count
  },
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // chronological (oldest → newest) for a left-to-right x-axis
  const cycles = [...localCycleNames()].reverse();
  const idxs = await Promise.all(cycles.map((c) => fetchLocalIndex(c)));

  // consolidated key → {displayName,color} + per-cycle value map. Rows that
  // collapse to the same key in one cycle are SUMMED (e.g. 2007's two ГЕРБ
  // rows); branding prefers a clean (non-local) row, newest cycle winning.
  const meta = new Map<
    string,
    { name: string; color?: string; clean: boolean }
  >();
  const valueByCycle = new Map<string, Map<string, number>>();
  cycles.forEach((c, i) => {
    const m = new Map<string, number>();
    for (const r of opts.rowsOf(idxs[i])) {
      if (r.value == null) continue;
      const key = canonicalLocalId(r.canonicalId, r.displayName);
      m.set(key, (m.get(key) ?? 0) + r.value);
      const clean = !r.canonicalId.startsWith("local:");
      const prev = meta.get(key);
      // prefer a clean row's branding; among clean (or among local) newest wins
      if (!prev || clean || !prev.clean)
        meta.set(key, { name: r.displayName, color: r.color, clean });
    }
    valueByCycle.set(c, m);
  });

  const peakOf = (id: string): number =>
    Math.max(0, ...cycles.map((c) => valueByCycle.get(c)?.get(id) ?? 0));
  const drawn = [...meta.keys()]
    .sort((a, b) => peakOf(b) - peakOf(a))
    .slice(0, MAX_LOCAL_TREND_LINES);

  const categories = cycles.map((c) => localCycleYear(c));
  const series = drawn.map((id, i) => {
    const m = meta.get(id)!;
    return {
      key: `p${i}`,
      label: m.name,
      color: m.color ?? INDEP_COLOR,
      points: cycles.map((c) => {
        const v = valueByCycle.get(c)?.get(id);
        return { x: localCycleYear(c), y: v == null ? null : round2(v) };
      }),
    };
  });

  const fmtVal = (v: number) =>
    opts.pct ? fmtPct(round2(v), ctx.lang) : fmtInt(v, ctx.lang);
  const facts: Record<string, string | number> = { cycles: cycles.length };
  // latest-cycle leader + each drawn party's first→latest trajectory
  const latest = cycles[cycles.length - 1];
  const latestVals = drawn
    .map((id) => ({ id, v: valueByCycle.get(latest)?.get(id) ?? 0 }))
    .sort((a, b) => b.v - a.v);
  if (latestVals[0])
    facts.leader = `${meta.get(latestVals[0].id)!.name} (${fmtVal(latestVals[0].v)})`;
  drawn.forEach((id) => {
    const vals = cycles
      .map((c) => valueByCycle.get(c)?.get(id))
      .filter((v): v is number => v != null);
    if (!vals.length) return;
    const first = vals[0];
    const last = vals[vals.length - 1];
    facts[meta.get(id)!.name] =
      first === last ? fmtVal(last) : `${fmtVal(first)} → ${fmtVal(last)}`;
  });

  const span = `${localCycleYear(cycles[0])}–${localCycleYear(latest)}`;
  return {
    tool: opts.tool,
    domain: "local",
    kind: "series",
    title: bg ? `${opts.title.bg} (${span})` : `${opts.title.en} (${span})`,
    subtitle: bg ? opts.subtitle.bg : opts.subtitle.en,
    categories,
    series,
    viz: "line",
    facts,
    provenance: cycles.map((c) => `${c}/index.json`),
  };
};

export const localCouncilTrend = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> =>
  buildLocalTrend(ctx, {
    tool: "localCouncilTrend",
    rowsOf: (idx) =>
      idx.councilVoteShare.map((r) => ({
        canonicalId: r.canonicalId,
        displayName: r.displayName,
        color: r.color,
        value: r.pctOfValid,
      })),
    title: {
      bg: "Общински съвети — дял на гласовете по партия",
      en: "Council vote share by party",
    },
    subtitle: {
      bg: "Дял от действителните гласове за общинските съвети, по цикли",
      en: "Share of valid council votes, across local-election cycles",
    },
    seriesLabel: { bg: "Дял %", en: "Share %" },
    unit: { bg: "%", en: "%" },
    pct: true,
  });

export const localMayorsTrend = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> =>
  buildLocalTrend(ctx, {
    tool: "localMayorsTrend",
    rowsOf: (idx) =>
      idx.mayorsByCanonical.map((r) => ({
        canonicalId: r.canonicalId,
        displayName: r.displayName,
        color: r.color,
        value: r.count,
      })),
    title: {
      bg: "Спечелени кметски места по партия",
      en: "Mayors won by party",
    },
    subtitle: {
      bg: "Брой кметски места по партия, по цикли",
      en: "Mayoralties won by party, across local-election cycles",
    },
    seriesLabel: { bg: "Кметове", en: "Mayors" },
    unit: { bg: "кмета", en: "mayors" },
    pct: false,
  });

// Oblast-level mayors-by-party rollup: aggregate each município's elected mayor
// across a whole province, canonicalised to the index's party display names so
// the noisy local-coalition strings collapse (the 17 "БСП ЗА БЪЛГАРИЯ /..."
// variants -> one "БСП-ОЛ"). Answers "колко кмета спечели всяка партия в област
// Пловдив". For Sofia city the "municipalities" are the 24 районни кметове
// (read from the SOF bundle's districts, not separate bundles).
type ElectedLike = {
  candidateName?: string;
  localPartyName?: string;
  primaryCanonicalId?: string | null;
  isIndependent?: boolean;
};

export const localOblastMayors = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const raw = String(args.place ?? "");
  const ob = resolveOblast(raw) ?? findOblastInText(raw);
  const bg = ctx.lang === "bg";
  if (!ob) {
    return {
      tool: "localOblastMayors",
      domain: "local",
      kind: "scalar",
      title: bg
        ? `Не разпознах област „${raw}“`
        : `No province matched "${raw}"`,
      viz: "none",
      facts: { query: raw },
      provenance: [`${cycle}/index.json`],
    };
  }
  const idx = await fetchLocalIndex(cycle);
  const canon: Record<string, string> = {};
  const canonColor: Record<string, string> = {};
  for (const r of idx.mayorsByCanonical) {
    canon[r.canonicalId] = r.displayName;
    if (r.color) canonColor[r.canonicalId] = r.color;
  }
  for (const r of idx.councilVoteShare) {
    if (!canon[r.canonicalId]) canon[r.canonicalId] = r.displayName;
    if (!canonColor[r.canonicalId] && r.color)
      canonColor[r.canonicalId] = r.color;
  }
  const INDEP = bg ? "Независими / местни листи" : "Independents / local lists";
  const colorOf = (e: ElectedLike | null | undefined): string => {
    const id = e?.primaryCanonicalId;
    return (id && canonColor[id]) || INDEP_COLOR;
  };

  // map an elected mayor to a canonical party label; null canonical id (local
  // nomination committees) and independents collapse into the INDEP bucket.
  const partyOf = (e: ElectedLike | null | undefined): string | null => {
    if (!e) return null;
    const id = e.primaryCanonicalId;
    if (id && canon[id]) return canon[id];
    if (e.isIndependent || !id) return INDEP;
    return e.localPartyName || INDEP;
  };

  const isSofiaCity = ob.code.startsWith("S2"); // S23/S24/S25 -> Sofia districts
  const elected: (ElectedLike | null)[] = [];
  // Per-município winner (obshtina + elected mayor's party colour) for the map.
  const muniAreas: GeoArea[] = [];
  let level: string;
  let scope: string;
  if (isSofiaCity) {
    const b = await fetchLocalMuni(cycle, "SOF");
    for (const d of (b.districts ?? []) as { elected?: ElectedLike | null }[])
      elected.push(d.elected ?? null);
    level = bg ? "районни кметове" : "district mayors";
    scope = bg ? "София" : "Sofia";
  } else {
    const munis = idx.municipalities.filter(
      (m) => m.oblast === ob.code || m.oblast.startsWith(`${ob.code}-`),
    );
    const bundles = await Promise.all(
      munis.map(async (m) => {
        try {
          return await fetchLocalMuni(cycle, m.obshtinaCode);
        } catch {
          return null;
        }
      }),
    );
    munis.forEach((m, i) => {
      const e = bundles[i]?.mayor?.elected ?? null;
      elected.push(e);
      if (e)
        muniAreas.push({
          code: m.obshtinaCode,
          label: m.name,
          color: colorOf(e),
          display: partyOf(e) ?? INDEP,
        });
    });
    level = bg ? "кметове" : "mayors";
    scope = bg ? ob.name.bg : ob.name.en;
  }

  const tally = new Map<string, number>();
  let resolved = 0;
  for (const e of elected) {
    const p = partyOf(e);
    if (!p) continue;
    resolved++;
    tally.set(p, (tally.get(p) ?? 0) + 1);
  }
  const rows: Row[] = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([party, mayors]) => ({ party, mayors }));

  if (!rows.length) {
    return {
      tool: "localOblastMayors",
      domain: "local",
      kind: "scalar",
      title: bg
        ? `Няма данни за кметове в ${scope} (${localCycleYear(cycle)})`
        : `No mayor data for ${scope} (${localCycleYear(cycle)})`,
      viz: "none",
      facts: { oblast: scope, cycle: localCycleYear(cycle) },
      provenance: [`${cycle}/index.json`],
    };
  }

  const facts: Record<string, string | number> = {
    oblast: scope,
    cycle: localCycleYear(cycle),
    level,
    total: resolved,
    leader: `${rows[0].party} (${rows[0].mayors})`,
  };
  rows.slice(0, 4).forEach((r) => {
    facts[String(r.party)] = Number(r.mayors);
  });

  return {
    tool: "localOblastMayors",
    domain: "local",
    kind: "table",
    title: bg
      ? `Спечелени кметски места по партия — ${scope} (${localCycleYear(cycle)})`
      : `Mayors won by party — ${scope} (${localCycleYear(cycle)})`,
    columns: [
      { key: "party", label: bg ? "Партия / коалиция" : "Party / coalition" },
      {
        key: "mayors",
        label: bg ? "Кметове" : "Mayors",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    categories: rows.map((r) => String(r.party)),
    series: [
      {
        key: "mayors",
        label: bg ? "Кметове" : "Mayors",
        points: rows.map((r) => ({ x: String(r.party), y: Number(r.mayors) })),
      },
    ],
    viz: "bar",
    // Municipality winner map within the oblast: each муниципалитет filled with
    // its elected mayor's party colour (Sofia districts have no nuts4 polygon, so
    // muniAreas is empty there and the map is omitted).
    ...(muniAreas.length
      ? {
          geo: muniChoropleth(ob.code, muniAreas, {
            metricLabel: bg ? "Кмет" : "Mayor",
            colorMode: "explicit" as const,
          }),
        }
      : {}),
    facts,
    provenance: [`${cycle}/index.json`, `${cycle}/municipalities/*.json`],
  };
};

export const localMunicipality = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) {
    return {
      tool: "localMunicipality",
      domain: "local",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Не намерих община „${args.place ?? ""}“`
          : `No municipality matched "${args.place ?? ""}"`,
      viz: "none",
      facts: { query: String(args.place ?? "") },
      provenance: ["municipalities.json"],
    };
  }

  let b;
  try {
    b = await fetchLocalMuni(cycle, place.obshtina);
  } catch {
    return {
      tool: "localMunicipality",
      domain: "local",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма местни данни за ${place.name} (${localCycleYear(cycle)})`
          : `No local data for ${place.name} (${localCycleYear(cycle)})`,
      viz: "none",
      facts: { place: place.name, cycle: localCycleYear(cycle) },
      provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
    };
  }

  const elected = b.mayor.elected;
  const topCouncil = [...b.council].sort(
    (x, y) => y.mandatesWon - x.mandatesWon,
  )[0];
  const turnout =
    b.protocol.numRegisteredVoters > 0
      ? round2(
          (100 * b.protocol.totalActualVoters) / b.protocol.numRegisteredVoters,
        )
      : null;

  return {
    tool: "localMunicipality",
    domain: "local",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `${b.obshtinaName} — ${cycleLabel(cycle, "bg")}`
        : `${place.nameEn} — ${cycleLabel(cycle, "en")}`,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      ctx.lang === "bg" ? place.name : place.nameEn,
    ),
    facts: {
      // hidden deep-link keys (consumed by ai/render/links.ts)
      obshtina_id: place.obshtina,
      cycle_id: cycle,
      municipality: b.obshtinaName,
      mayor: elected
        ? `${elected.candidateName} (${elected.localPartyName})`
        : ctx.lang === "bg"
          ? "не е избран на тези данни"
          : "not resolved",
      mayor_pct:
        elected?.pctOfValid != null
          ? fmtPct(elected.pctOfValid, ctx.lang)
          : "—",
      top_council_party: topCouncil
        ? `${topCouncil.localPartyName} (${topCouncil.mandatesWon} ${ctx.lang === "bg" ? "места" : "seats"})`
        : "—",
      turnout: fmtPct(turnout, ctx.lang),
    },
    provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
  };
};
