// Candidate preferential-vote results by name. Resolves a person name to a
// candidate in the election's candidates.json, then reads their per-район
// preferential vote counts from candidates/<name>/preferences_stats.json.
// Numbers are computed from the official files, never generated.

import { fetchData } from "./dataClient";
import { electionFullLabel, fmtInt } from "./format";
import { OBLASTS } from "./place";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type CandidateRow = {
  name: string;
  name_en: string;
  oblast: string;
  partyNum: number;
  pref: string;
};
type PrefEntry = {
  elections_date: string;
  party?: { name?: string; nickName?: string };
  preferences?: { oblast: string; pref: string; preferences: number }[];
};
type PrefStats = { stats?: PrefEntry[] };

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const oblastName = (code: string, lang: "bg" | "en"): string =>
  OBLASTS[code]?.[lang] ?? code;

const notFound = (
  query: string,
  lang: "bg" | "en",
  election: string,
): Envelope => ({
  tool: "candidateResult",
  kind: "scalar",
  viz: "none",
  title:
    lang === "bg"
      ? `Не е намерен кандидат „${query}“`
      : `No candidate found for "${query}"`,
  facts: {
    [lang === "bg" ? "търсене" : "query"]: query,
    [lang === "bg" ? "избор" : "election"]: electionFullLabel(election, lang),
    [lang === "bg" ? "подсказка" : "hint"]:
      lang === "bg"
        ? "Опитайте с пълно име (име и фамилия)."
        : "Try a full first + last name.",
  },
  provenance: [`${election}/candidates.json`],
});

export const candidateResult = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const election = (args.election as string) || ctx.election;
  const query = String(args.name ?? "").trim();
  if (!query) return notFound(query, lang, election);

  const list = await fetchData<CandidateRow[]>(`/${election}/candidates.json`);
  const qt = norm(query).split(" ").filter(Boolean);
  const first = qt[0];
  const last = qt[qt.length - 1];
  // Latin query -> match the transliterated name; Cyrillic -> the BG name.
  const useEn = /[a-z]/i.test(query) && !/[Ѐ-ӿ]/.test(query);
  const matches = list.filter((c) => {
    const toks = norm(useEn ? c.name_en : c.name)
      .split(" ")
      .filter(Boolean);
    return (
      toks.length >= 2 && toks[0] === first && toks[toks.length - 1] === last
    );
  });
  if (!matches.length) return notFound(query, lang, election);

  // the same person can appear across several районs; canonical BG name is stable
  const cand = matches[0];

  let stats: PrefStats | undefined;
  try {
    stats = await fetchData<PrefStats>(
      `/${election}/candidates/${cand.name}/preferences_stats.json`,
    );
  } catch {
    /* no per-candidate prefs file — fall back to candidates.json below */
  }
  const entry = stats?.stats?.find((s) => s.elections_date === election);
  const party = entry?.party?.nickName || entry?.party?.name || "";
  const who = lang === "bg" ? cand.name : cand.name_en || cand.name;
  const title =
    lang === "bg"
      ? `Преференции — ${who}${party ? ` (${party})` : ""} — ${electionFullLabel(election, lang)}`
      : `Preferential votes — ${who}${party ? ` (${party})` : ""} — ${electionFullLabel(election, lang)}`;

  if (entry?.preferences?.length) {
    const rows = entry.preferences
      .map((p) => ({
        oblast: oblastName(p.oblast, lang),
        votes: p.preferences,
      }))
      .sort((a, b) => b.votes - a.votes);
    const total = rows.reduce((s, r) => s + r.votes, 0);
    return {
      tool: "candidateResult",
      kind: "table",
      viz: "none",
      title,
      columns: [
        {
          key: "oblast",
          label: lang === "bg" ? "Район (МИР)" : "Region (MIR)",
        },
        {
          key: "votes",
          label: lang === "bg" ? "Преференции" : "Preferential votes",
          numeric: true,
          format: "int",
        },
      ],
      rows: rows.map((r) => ({ oblast: r.oblast, votes: r.votes })),
      facts: {
        name: who,
        party,
        total_preferences: total,
        regions: rows.length,
        top_region: rows[0]
          ? `${rows[0].oblast}: ${fmtInt(rows[0].votes, lang)}`
          : "",
      },
      provenance: [
        `${election}/candidates/${cand.name}/preferences_stats.json`,
      ],
    };
  }

  // fallback: candidates.json only (party + район + ballot number, no counts)
  const regions = [...new Set(matches.map((m) => oblastName(m.oblast, lang)))];
  return {
    tool: "candidateResult",
    kind: "scalar",
    viz: "none",
    title,
    facts: {
      name: who,
      [lang === "bg" ? "район" : "region"]: regions.join(", "),
      [lang === "bg" ? "преф. №" : "ballot #"]: [
        ...new Set(matches.map((m) => m.pref)),
      ].join(", "),
    },
    provenance: [`${election}/candidates.json`],
  };
};
