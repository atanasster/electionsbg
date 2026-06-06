// Voter-persistence tool: across two consecutive elections, what share of voters
// stayed with the same party, and the single biggest defection. Complements
// `voteTransitions` (the full flow matrix) with the loyalty headline.

import { resolveElection } from "./args";
import { fetchData } from "./dataClient";
import { ALL_ELECTIONS, round2 } from "./dataset";
import { electionShortLabel } from "./format";
import { oblastName } from "./place";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";

type Node = { id: string; label: string; labelEn?: string };
type NationalFlows = { matrix: { fromNodes: Node[]; toNodes: Node[] } };
type Defection = { fromId: string; toId: string; votes: number; share: number };
type Persistence = {
  stayedVotes: number;
  votedBothNamed: number;
  stayRate: number;
  topDefection: Defection;
};
type PersistFile = {
  from: string;
  to: string;
  national: Persistence;
  byOblast: { oblast: string; persistence: Persistence }[];
};

export const voterPersistence = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const idx = ALL_ELECTIONS.findIndex((e) => e.name === election);
  const prior =
    idx >= 0 && idx < ALL_ELECTIONS.length - 1
      ? ALL_ELECTIONS[idx + 1]
      : undefined;
  if (!prior) {
    return {
      tool: "voterPersistence",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? "Няма предходен избор за сравнение"
        : "No prior election to compare",
      viz: "none",
      facts: {},
      provenance: ["transitions/"],
    };
  }
  const pair = `${prior.name}_${election}`;
  let p: PersistFile;
  try {
    p = await fetchData(`/transitions/${pair}/persistence.json`);
  } catch {
    return {
      tool: "voterPersistence",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за устойчивост ${electionShortLabel(prior.name, "bg")} → ${electionShortLabel(election, "bg")}`
        : `No persistence data ${electionShortLabel(prior.name, "en")} → ${electionShortLabel(election, "en")}`,
      viz: "none",
      facts: {},
      provenance: [`transitions/${pair}/persistence.json`],
    };
  }
  // label the defection party ids from the flow-matrix nodes
  let labelOf = (id: string): string => id;
  try {
    const nat = await fetchData<NationalFlows>(
      `/transitions/${pair}/national.json`,
    );
    const nodes = [...nat.matrix.fromNodes, ...nat.matrix.toNodes];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    labelOf = (id: string): string => {
      const n = byId.get(id);
      return n ? (bg ? n.label : (n.labelEn ?? n.label)) : id;
    };
  } catch {
    /* fall back to raw ids */
  }

  const rows: Row[] = [...p.byOblast]
    .map((o) => ({
      oblast: oblastName(o.oblast)[ctx.lang] ?? o.oblast,
      stay: round2(o.persistence.stayRate * 100),
      defection: `${labelOf(o.persistence.topDefection.fromId)} → ${labelOf(o.persistence.topDefection.toId)}`,
    }))
    .sort((a, b) => (b.stay as number) - (a.stay as number));

  const nat = p.national;
  const def = nat.topDefection;
  const pairLabel = `${electionShortLabel(prior.name, ctx.lang)} → ${electionShortLabel(election, ctx.lang)}`;
  return {
    tool: "voterPersistence",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Устойчивост на вота ${pairLabel}`
      : `Voter persistence ${pairLabel}`,
    subtitle: bg
      ? "Дял на избирателите, останали при същата партия (по области)"
      : "Share of voters who stayed with the same party (by oblast)",
    columns: [
      { key: "oblast", label: bg ? "Област" : "Oblast" },
      {
        key: "stay",
        label: bg ? "Останали %" : "Stayed %",
        numeric: true,
        format: "pct",
      },
      {
        key: "defection",
        label: bg ? "Най-голямо преливане" : "Top defection",
      },
    ],
    rows,
    viz: "none",
    facts: {
      pair: `${electionShortLabel(prior.name, "en")} → ${electionShortLabel(election, "en")}`,
      national_stay_rate: `${round2(nat.stayRate * 100)}%`,
      top_defection: def
        ? `${labelOf(def.fromId)} → ${labelOf(def.toId)} (${round2(def.share * 100)}%)`
        : "—",
    },
    provenance: [`transitions/${pair}/persistence.json`],
  };
};
