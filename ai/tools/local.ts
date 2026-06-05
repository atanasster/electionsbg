// Local-elections (municipal) tools.

import {
  fetchLocalIndex,
  fetchLocalMuni,
  localCycleYear,
  resolveLocalCycle,
} from "./localDataset";
import { fmtInt, fmtPct } from "./format";
import { resolveMunicipality } from "./place";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

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
