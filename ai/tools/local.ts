// Local-elections (municipal) tools.

import {
  fetchLocalIndex,
  fetchLocalMuni,
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
