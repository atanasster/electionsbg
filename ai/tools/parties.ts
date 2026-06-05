// Cross-election party timeline. Threads a party's identity across renames /
// coalitions via canonical_parties.json, then reads each election's vote total
// from the bundled elections.json (computing % from that election's total).

import { fetchCanonicalParties } from "./dataClient";
import { electionByName, round2, totalPartyVotes } from "./dataset";
import { electionShortLabel, fmtPct } from "./format";
import { matchParty } from "./matchParty";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type CanonHistory = {
  election: string;
  partyNum: number;
  nickName: string;
  name?: string;
  nameEn?: string;
};
type CanonParty = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  color?: string;
  history: CanonHistory[];
};
type Canonical = { parties: CanonParty[] };

// Adapt a canonical party to the matchParty shape using its display names +
// every historical nickName as aliases.
const toPartyLike = (c: CanonParty) => ({
  nickName: c.displayName,
  name: c.displayNameEn,
  commonName: Array.from(new Set(c.history.map((h) => h.nickName))),
});

export const partyTimeline = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const query = String(args.party ?? "");
  const canon = await fetchCanonicalParties<Canonical>();

  const likes = canon.parties.map(toPartyLike);
  const matchedLike = matchParty(query, likes);
  const matched = matchedLike
    ? canon.parties[likes.indexOf(matchedLike)]
    : undefined;

  if (!matched) {
    return {
      tool: "partyTimeline",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма намерена партия „${query}“`
          : `No party matched "${query}"`,
      viz: "none",
      facts: { query },
      provenance: ["canonical_parties.json"],
    };
  }

  // oldest -> newest along the timeline
  const history = [...matched.history].sort((a, b) =>
    a.election.localeCompare(b.election),
  );

  const points = history.map((h) => {
    const label = electionShortLabel(h.election, ctx.lang);
    const e = electionByName(h.election);
    const vote = e?.results?.votes?.find((v) => v.partyNum === h.partyNum);
    const tot = e ? totalPartyVotes(e) : 0;
    const pct =
      vote && tot > 0 ? round2((100 * (vote.totalVotes ?? 0)) / tot) : null;
    return { x: label, y: pct };
  });

  const facts: Record<string, string | number> = {
    party: matched.displayName,
    appearances: history.length,
  };
  history.forEach((h, i) => {
    facts[electionShortLabel(h.election, "en")] =
      points[i].y == null ? "n/a" : fmtPct(points[i].y, ctx.lang);
  });
  const valued = points.filter((p) => p.y != null) as {
    x: string;
    y: number;
  }[];
  if (valued.length) {
    facts.peak_pct = Math.max(...valued.map((p) => p.y));
    facts.latest_pct = valued[valued.length - 1].y;
  }

  return {
    tool: "partyTimeline",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `${matched.displayName} през годините`
        : `${matched.displayNameEn ?? matched.displayName} over time`,
    categories: points.map((p) => p.x),
    series: [
      {
        key: "pct",
        label: ctx.lang === "bg" ? "Дял %" : "Vote share %",
        color: matched.color,
        points: points.map((p) => ({ x: p.x, y: p.y })),
      },
    ],
    viz: "line",
    facts,
    provenance: ["canonical_parties.json", "elections.json"],
  };
};
