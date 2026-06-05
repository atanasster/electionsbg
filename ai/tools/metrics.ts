// Single-election metric tools + a two-election comparison. All pure (bundled
// elections.json) -> no fetches.

import { resolveElection } from "./args";
import {
  electionByName,
  machinePct,
  totalPartyVotes,
  turnoutPct,
} from "./dataset";
import { electionFullLabel, fmtInt, fmtPct } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

const notFound = (
  tool: string,
  election: string,
  lang: ToolContext["lang"],
): Envelope => ({
  tool,
  kind: "scalar",
  title:
    lang === "bg" ? `Няма данни за ${election}` : `No data for ${election}`,
  viz: "none",
  facts: { election },
  provenance: ["elections.json"],
});

const winnerOf = (election: string) => {
  const e = electionByName(election);
  const votes = e?.results?.votes ?? [];
  if (votes.length === 0) return undefined;
  return votes.reduce((a, b) => (b.totalVotes > a.totalVotes ? b : a));
};

export const machineVoteShare = (
  args: ToolArgs,
  ctx: ToolContext,
): Envelope => {
  const election = resolveElection(args, ctx);
  const e = electionByName(election);
  if (!e) return notFound("machineVoteShare", election, ctx.lang);
  const pct = machinePct(e);
  const p = e.results?.protocol;
  return {
    tool: "machineVoteShare",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Машинно гласуване — ${electionFullLabel(election, "bg")}`
        : `Machine voting — ${electionFullLabel(election, "en")}`,
    viz: "none",
    facts: {
      election: electionFullLabel(election, "en"),
      machine_share: fmtPct(pct, ctx.lang),
      machine_votes: fmtInt(p?.numValidMachineVotes ?? 0, ctx.lang),
      paper_votes: fmtInt(p?.numValidVotes ?? 0, ctx.lang),
    },
    provenance: ["elections.json"],
  };
};

export const turnout = (args: ToolArgs, ctx: ToolContext): Envelope => {
  const election = resolveElection(args, ctx);
  const e = electionByName(election);
  if (!e) return notFound("turnout", election, ctx.lang);
  const pct = turnoutPct(e);
  const p = e.results?.protocol;
  return {
    tool: "turnout",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `Избирателна активност — ${electionFullLabel(election, "bg")}`
        : `Voter turnout — ${electionFullLabel(election, "en")}`,
    viz: "none",
    facts: {
      election: electionFullLabel(election, "en"),
      turnout: fmtPct(pct, ctx.lang),
      voters: fmtInt(p?.totalActualVoters ?? 0, ctx.lang),
      registered: fmtInt(p?.numRegisteredVoters ?? 0, ctx.lang),
    },
    provenance: ["elections.json"],
  };
};

export const compareElections = (
  args: ToolArgs,
  ctx: ToolContext,
): Envelope => {
  const a = resolveElection({ election: args.a }, ctx);
  // `b` defaults to the context election (latest) if omitted
  const b = resolveElection({ election: args.b }, ctx);
  const ea = electionByName(a);
  const eb = electionByName(b);
  if (!ea || !eb) return notFound("compareElections", `${a} / ${b}`, ctx.lang);

  const la = electionFullLabel(a, ctx.lang);
  const lb = electionFullLabel(b, ctx.lang);
  const wa = winnerOf(a);
  const wb = winnerOf(b);

  const columns: Column[] = [
    { key: "metric", label: ctx.lang === "bg" ? "Показател" : "Metric" },
    { key: "a", label: la },
    { key: "b", label: lb },
  ];
  const rows: Row[] = [
    {
      metric: ctx.lang === "bg" ? "Активност" : "Turnout",
      a: fmtPct(turnoutPct(ea), ctx.lang),
      b: fmtPct(turnoutPct(eb), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Машинно гласуване" : "Machine voting",
      a: fmtPct(machinePct(ea), ctx.lang),
      b: fmtPct(machinePct(eb), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Първа партия" : "Top party",
      a: wa ? `${wa.nickName} (${fmtInt(wa.totalVotes, ctx.lang)})` : "—",
      b: wb ? `${wb.nickName} (${fmtInt(wb.totalVotes, ctx.lang)})` : "—",
    },
    {
      metric: ctx.lang === "bg" ? "Действителни гласове" : "Valid votes",
      a: fmtInt(totalPartyVotes(ea), ctx.lang),
      b: fmtInt(totalPartyVotes(eb), ctx.lang),
    },
  ];

  return {
    tool: "compareElections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Сравнение: ${la} срещу ${lb}`
        : `Compare: ${la} vs ${lb}`,
    columns,
    rows,
    viz: "none",
    facts: {
      a: la,
      b: lb,
      turnout_a: fmtPct(turnoutPct(ea), ctx.lang),
      turnout_b: fmtPct(turnoutPct(eb), ctx.lang),
      machine_a: fmtPct(machinePct(ea), ctx.lang),
      machine_b: fmtPct(machinePct(eb), ctx.lang),
    },
    provenance: ["elections.json"],
  };
};
