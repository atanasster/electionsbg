// Per-election national-result tools (fetch national_summary.json).

import { resolveElection } from "./args";
import { fetchNationalSummary } from "./dataClient";
import { electionFullLabel, fmtInt, fmtPct } from "./format";
import { matchParty } from "./matchParty";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

type NSParty = {
  partyNum: number;
  nickName: string;
  name: string;
  color?: string;
  totalVotes: number;
  pct: number;
  seats?: number;
  passedThreshold?: boolean;
};

type NationalSummary = {
  election: string;
  turnout?: { actual: number; registered: number; pct: number };
  parties: NSParty[];
};

export const nationalResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const ns = await fetchNationalSummary<NationalSummary>(election);
  const parties = [...ns.parties].sort((a, b) => b.totalVotes - a.totalVotes);
  const top = parties.slice(0, 12);

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
    {
      key: "seats",
      label: ctx.lang === "bg" ? "Мандати" : "Seats",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = top.map((p) => ({
    party: p.nickName,
    votes: p.totalVotes,
    pct: p.pct,
    seats: p.seats ?? 0,
  }));

  const facts: Record<string, string | number> = {
    election: electionFullLabel(election, "en"),
    parties_over_threshold: parties.filter((p) => p.passedThreshold).length,
  };
  top.slice(0, 5).forEach((p) => {
    facts[p.nickName] =
      `${fmtInt(p.totalVotes, ctx.lang)} (${fmtPct(p.pct, ctx.lang)}), ${p.seats ?? 0} ${ctx.lang === "bg" ? "мандата" : "seats"}`;
  });

  return {
    tool: "nationalResults",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Национални резултати — ${electionFullLabel(election, "bg")}`
        : `National results — ${electionFullLabel(election, "en")}`,
    columns,
    rows,
    // also expose a bar series for the renderer if it prefers a chart
    categories: top.map((p) => p.nickName),
    series: [
      {
        key: "votes",
        label: ctx.lang === "bg" ? "Гласове" : "Votes",
        points: top.map((p) => ({ x: p.nickName, y: p.totalVotes })),
      },
    ],
    viz: "bar",
    facts,
    provenance: [`${election}/national_summary.json`],
  };
};

export const partyResult = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const query = String(args.party ?? "");
  const ns = await fetchNationalSummary<NationalSummary>(election);
  const p = matchParty(query, ns.parties);

  if (!p) {
    return {
      tool: "partyResult",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма намерена партия „${query}“`
          : `No party matched "${query}"`,
      viz: "none",
      facts: { query, election: electionFullLabel(election, "en") },
      provenance: [`${election}/national_summary.json`],
    };
  }

  return {
    tool: "partyResult",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `${p.nickName} — ${electionFullLabel(election, "bg")}`
        : `${p.nickName} — ${electionFullLabel(election, "en")}`,
    subtitle: p.name,
    viz: "none",
    facts: {
      party: p.nickName,
      votes: fmtInt(p.totalVotes, ctx.lang),
      pct: fmtPct(p.pct, ctx.lang),
      seats: p.seats ?? 0,
      passed_threshold: p.passedThreshold ? "yes" : "no",
      election: electionFullLabel(election, "en"),
    },
    provenance: [`${election}/national_summary.json`],
  };
};
