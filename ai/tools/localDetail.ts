// Phase B — per-município local-election detail + extraordinary (chmi) feed.

import { fetchData } from "./dataClient";
import { fmtInt, fmtPct } from "./format";
import {
  fetchLocalMuni,
  localCycleYear,
  resolveLocalCycle,
} from "./localDataset";
import { resolveMunicipality } from "./place";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

const noMuni = (tool: string, query: string, ctx: ToolContext): Envelope => ({
  tool,
  domain: "local",
  kind: "scalar",
  title:
    ctx.lang === "bg"
      ? `Не намерих община „${query}“`
      : `No municipality matched "${query}"`,
  viz: "none",
  facts: { query },
  provenance: ["municipalities.json"],
});

export const localMayorRace = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noMuni("localMayorRace", String(args.place ?? ""), ctx);
  const b = await fetchLocalMuni(cycle, place.obshtina);
  // round2 if there was a runoff, else round1
  const cands = (b.mayor.round2.length ? b.mayor.round2 : b.mayor.round1)
    .slice()
    .sort((x, y) => (y.votes ?? 0) - (x.votes ?? 0));

  const columns: Column[] = [
    { key: "name", label: ctx.lang === "bg" ? "Кандидат" : "Candidate" },
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = cands.map((c) => ({
    name: `${c.isElected ? "★ " : ""}${c.candidateName}`,
    party: c.localPartyName,
    votes: c.votes ?? null,
    pct: c.pctOfValid != null ? round2(c.pctOfValid) : null,
  }));
  const winner = b.mayor.elected;
  return {
    tool: "localMayorRace",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Кмет на ${b.obshtinaName} — ${localCycleYear(cycle)}${b.mayor.round2.length ? " (II тур)" : ""}`
        : `Mayor of ${place.nameEn} — ${localCycleYear(cycle)}${b.mayor.round2.length ? " (runoff)" : ""}`,
    columns,
    rows,
    viz: "none",
    facts: {
      municipality: b.obshtinaName,
      winner: winner
        ? `${winner.candidateName} (${winner.localPartyName})`
        : "—",
      winner_pct:
        winner?.pctOfValid != null ? fmtPct(winner.pctOfValid, ctx.lang) : "—",
      candidates: cands.length,
    },
    provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
  };
};

export const localCouncil = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const cycle = resolveLocalCycle(args.cycle as string | undefined);
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) return noMuni("localCouncil", String(args.place ?? ""), ctx);
  const b = await fetchLocalMuni(cycle, place.obshtina);
  const parties = [...b.council]
    .filter((p) => p.mandatesWon > 0)
    .sort((x, y) => y.mandatesWon - x.mandatesWon);

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "seats",
      label: ctx.lang === "bg" ? "Места" : "Seats",
      numeric: true,
      format: "int",
    },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = parties.map((p) => ({
    party: p.localPartyName,
    seats: p.mandatesWon,
    votes: p.totalVotes,
    pct: round2(p.pctOfValid),
  }));
  const totalSeats = parties.reduce((s, p) => s + p.mandatesWon, 0);
  const top = parties[0];
  return {
    tool: "localCouncil",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Общински съвет на ${b.obshtinaName} — ${localCycleYear(cycle)}`
        : `${place.nameEn} municipal council — ${localCycleYear(cycle)}`,
    columns,
    rows,
    categories: parties.map((p) => p.localPartyName),
    series: [
      {
        key: "seats",
        label: ctx.lang === "bg" ? "Места" : "Seats",
        points: parties.map((p) => ({ x: p.localPartyName, y: p.mandatesWon })),
      },
    ],
    viz: "bar",
    facts: {
      municipality: b.obshtinaName,
      total_seats: totalSeats,
      leader: top ? `${top.localPartyName} (${top.mandatesWon})` : "—",
    },
    provenance: [`${cycle}/municipalities/${place.obshtina}.json`],
  } as Envelope;
};

// ---- extraordinary (chmi) elections feed ------------------------------------

type ChmiEvent = {
  cycle: string;
  date: string;
  obshtinaCode: string;
  obshtinaName: string;
  kind: string;
  kmetstvoName?: string;
  candidateName?: string;
  localPartyName?: string;
};
type ChmiHistory = {
  byObshtina: Record<string, ChmiEvent[]>;
  allEvents: ChmiEvent[];
};

const KIND_LABEL: Record<string, { bg: string; en: string }> = {
  kmetstvo_mayor: { bg: "кмет на кметство", en: "kmetstvo mayor" },
  obshtina_mayor: { bg: "кмет на община", en: "municipality mayor" },
  council: { bg: "общински съвет", en: "council" },
};

export const chmiEvents = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const h = await fetchData<ChmiHistory>("/local_chmi_history.json");
  let events = h.allEvents;
  let placeName: string | undefined;
  if (args.place) {
    const place = await resolveMunicipality(String(args.place));
    if (place) {
      events = h.byObshtina[place.obshtina] ?? [];
      placeName = place.name;
    }
  }
  const recent = [...events]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);

  const columns: Column[] = [
    { key: "date", label: ctx.lang === "bg" ? "Дата" : "Date" },
    { key: "place", label: ctx.lang === "bg" ? "Място" : "Place" },
    { key: "kind", label: ctx.lang === "bg" ? "Вид" : "Type" },
    { key: "winner", label: ctx.lang === "bg" ? "Избран" : "Elected" },
  ];
  const rows: Row[] = recent.map((e) => ({
    date: e.date,
    place: e.kmetstvoName
      ? `${e.obshtinaName} / ${e.kmetstvoName}`
      : e.obshtinaName,
    kind: (KIND_LABEL[e.kind] ?? { bg: e.kind, en: e.kind })[ctx.lang],
    winner: e.candidateName ?? "—",
  }));
  return {
    tool: "chmiEvents",
    domain: "local",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Извънредни местни избори${placeName ? ` — ${placeName}` : ""}`
        : `Extraordinary local elections${placeName ? ` — ${placeName}` : ""}`,
    columns,
    rows,
    viz: "none",
    facts: {
      total: fmtInt(events.length, ctx.lang),
      shown: recent.length,
      latest: recent[0]?.date ?? "—",
    },
    provenance: ["local_chmi_history.json"],
  };
};
