// Census-correlation tools: how a party's vote share correlates with Census-2021
// demographics across municipalities (Pearson r), and which demographic metric
// most divides the parties (cleavages). Reads the precomputed correlation files.

import { resolveElection } from "./args";
import { fetchData, fetchNationalSummary } from "./dataClient";
import { electionFullLabel } from "./format";
import { matchParty } from "./matchParty";
import { round2 } from "./dataset";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";

// Bilingual labels for every census metric used in the correlation files.
export const METRIC_LABELS: Record<string, { bg: string; en: string }> = {
  ethnicBulgarian: { bg: "българи", en: "Bulgarian ethnicity" },
  ethnicTurkish: { bg: "турци", en: "Turkish ethnicity" },
  ethnicRoma: { bg: "роми", en: "Roma ethnicity" },
  religionChristian: { bg: "християни", en: "Christian" },
  religionMuslim: { bg: "мюсюлмани", en: "Muslim" },
  religionNoneOrUndecl: {
    bg: "без/неуточнено вероизповедание",
    en: "no/undeclared religion",
  },
  eduTertiary: { bg: "висше образование", en: "tertiary education" },
  eduSecondary: { bg: "средно образование", en: "secondary education" },
  eduPrimaryOrLower: {
    bg: "основно или по-ниско образование",
    en: "primary education or lower",
  },
  employmentRate: { bg: "заетост", en: "employment rate" },
  unemploymentRate: { bg: "безработица", en: "unemployment rate" },
  activityRate: { bg: "икономическа активност", en: "activity rate" },
  genderFemale: { bg: "дял жени", en: "female share" },
  ageUnder15: { bg: "под 15 г.", en: "under 15" },
  age15_29: { bg: "15–29 г.", en: "aged 15–29" },
  age30_44: { bg: "30–44 г.", en: "aged 30–44" },
  age45_64: { bg: "45–64 г.", en: "aged 45–64" },
  age65plus: { bg: "65+ г.", en: "aged 65+" },
};

const metricLabel = (key: string, lang: ToolContext["lang"]): string =>
  METRIC_LABELS[key]?.[lang] ?? key;

// ---- per-party demographic correlations -------------------------------------

type Correlation = { metric: string; r: number; n: number };

export const partyDemographics = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const query = String(args.party ?? "");
  const ns = await fetchNationalSummary<{
    parties: {
      partyNum: number;
      nickName: string;
      name?: string;
      commonName?: string[];
    }[];
  }>(election);
  const party = matchParty(query, ns.parties);
  if (!party) {
    return {
      tool: "partyDemographics",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма намерена партия „${query}“`
        : `No party matched "${query}"`,
      viz: "none",
      facts: { query, election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/national_summary.json`],
    };
  }
  let d: { correlations: Correlation[] };
  try {
    d = await fetchData(
      `/${election}/parties/demographics/${party.partyNum}.json`,
    );
  } catch {
    return {
      tool: "partyDemographics",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма демографски корелации за ${party.nickName}`
        : `No demographic correlations for ${party.nickName}`,
      viz: "none",
      facts: {
        party: party.nickName,
        election: electionFullLabel(election, ctx.lang),
      },
      provenance: [`${election}/parties/demographics/${party.partyNum}.json`],
    };
  }
  // strongest absolute correlations first
  const ranked = [...d.correlations].sort(
    (a, b) => Math.abs(b.r) - Math.abs(a.r),
  );
  const top = ranked.slice(0, 12);
  const rows: Row[] = top.map((c) => ({
    metric: metricLabel(c.metric, ctx.lang),
    r: round2(c.r),
    n: c.n,
  }));
  const pos = ranked.find((c) => c.r > 0);
  const neg = ranked.find((c) => c.r < 0);
  return {
    tool: "partyDemographics",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Демографски корелации — ${party.nickName} (${electionFullLabel(election, "bg")})`
      : `Demographic correlations — ${party.nickName} (${electionFullLabel(election, "en")})`,
    subtitle: bg
      ? "Корелация на дела на партията с демографията по общини (Пиърсън r)"
      : "Correlation of the party's share with municipal demographics (Pearson r)",
    columns: [
      { key: "metric", label: bg ? "Показател" : "Metric" },
      { key: "r", label: "r", numeric: true },
      {
        key: "n",
        label: bg ? "Общини" : "Municipalities",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      party: party.nickName,
      election: electionFullLabel(election, ctx.lang),
      strongest_positive: pos
        ? `${metricLabel(pos.metric, ctx.lang)} (r=${round2(pos.r)})`
        : "—",
      strongest_negative: neg
        ? `${metricLabel(neg.metric, ctx.lang)} (r=${round2(neg.r)})`
        : "—",
    },
    provenance: [`${election}/parties/demographics/${party.partyNum}.json`],
  };
};

// ---- demographic cleavages (which metric most divides the parties) ----------

type CleavageParty = { partyNum: number; nickName: string };
type CleavageRow = { metric: string; rs: number[]; spread: number };

export const demographicCleavages = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let d: { parties: CleavageParty[]; rows: CleavageRow[] };
  try {
    d = await fetchData(`/${election}/dashboard/demographic_cleavages.json`);
  } catch {
    return {
      tool: "demographicCleavages",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за демографски разделения — ${electionFullLabel(election, "bg")}`
        : `No demographic-cleavage data — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/dashboard/demographic_cleavages.json`],
    };
  }
  // most polarizing metrics first (widest spread of r across parties)
  const ranked = [...d.rows].sort((a, b) => b.spread - a.spread);
  const top = ranked.slice(0, 12);
  // for each metric, name the most-positive and most-negative party. Only label
  // a side when the correlation actually has that sign (else "—"), so the
  // "Strongest (+)" column never names a party whose r is negative.
  const partyAt = (i: number): string => d.parties[i]?.nickName ?? "—";
  const extremes = (rs: number[]): { pos: string; neg: string } => {
    let hi = 0;
    let lo = 0;
    rs.forEach((r, i) => {
      if (r > rs[hi]) hi = i;
      if (r < rs[lo]) lo = i;
    });
    return {
      pos: rs[hi] > 0 ? partyAt(hi) : "—",
      neg: rs[lo] < 0 ? partyAt(lo) : "—",
    };
  };
  const rows: Row[] = top.map((r) => {
    const e = extremes(r.rs);
    return {
      metric: metricLabel(r.metric, ctx.lang),
      spread: round2(r.spread),
      most_positive: e.pos,
      most_negative: e.neg,
    };
  });
  const div = top[0];
  return {
    tool: "demographicCleavages",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Демографски разделения — ${electionFullLabel(election, "bg")}`
      : `Demographic cleavages — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Кои демографски показатели най-силно разделят партиите"
      : "Which demographics most divide the parties",
    columns: [
      { key: "metric", label: bg ? "Показател" : "Metric" },
      { key: "spread", label: bg ? "Разлика в r" : "r spread", numeric: true },
      { key: "most_positive", label: bg ? "Най-силно (+)" : "Strongest (+)" },
      { key: "most_negative", label: bg ? "Най-силно (−)" : "Strongest (−)" },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      most_divisive: div
        ? `${metricLabel(div.metric, ctx.lang)} (Δr=${round2(div.spread)})`
        : "—",
      parties: d.parties
        .slice(0, 6)
        .map((p) => p.nickName)
        .join(", "),
    },
    provenance: [`${election}/dashboard/demographic_cleavages.json`],
  };
};
