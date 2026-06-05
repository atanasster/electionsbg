// D1.5 — detailed polling tools: per-agency profile + the latest poll breakdown.

import { fetchData } from "./dataClient";
import { fmtInt, fmtPct } from "./format";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

const norm = (s: string): string =>
  s.toLowerCase().replace(/[\s.„“”"'`-]+/g, "");

// ---- agency profile ---------------------------------------------------------

type Bias = { key: string; meanError?: number; meanDiff?: number };
type AgencyProfile = {
  agencyId: string;
  name_bg: string;
  name_en: string;
  totalPolls: number;
  overallMAE: number;
  shrunkMAE?: number;
  barrierCallRate?: number;
  grade?: string;
  medianDaysBefore?: number;
  electionsCovered?: string[];
  houseEffect?: Bias[];
};
type Agency = {
  id: string;
  name_bg: string;
  name_en: string;
  abbr_bg?: string;
  abbr_en?: string;
};
type Take = { agencyId: string; summary?: { bg?: string; en?: string } };

export const agencyProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const query = String(args.agency ?? "");
  const [acc, agencies] = await Promise.all([
    fetchData<{ agencyProfiles: AgencyProfile[] }>("/polls/accuracy.json"),
    fetchData<Agency[]>("/polls/agencies.json"),
  ]);
  const q = norm(query);
  // resolve agency id via the agencies catalogue (names + abbreviations)
  const ag = agencies.find((a) =>
    [a.name_bg, a.name_en, a.abbr_bg, a.abbr_en, a.id]
      .filter(Boolean)
      .some((n) => {
        const nn = norm(String(n));
        return nn.length > 1 && (nn === q || nn.includes(q) || q.includes(nn));
      }),
  );
  const prof =
    acc.agencyProfiles.find((p) => p.agencyId === ag?.id) ||
    acc.agencyProfiles.find((p) => {
      const nb = norm(p.name_bg);
      const ne = norm(p.name_en);
      return (
        nb.includes(q) || ne.includes(q) || q.includes(nb) || q.includes(ne)
      );
    });
  if (!prof) {
    return {
      tool: "agencyProfile",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Не намерих агенция „${query}“`
          : `No agency matched "${query}"`,
      viz: "none",
      facts: { query },
      provenance: ["polls/accuracy.json", "polls/agencies.json"],
    };
  }
  // the AI "take" summary, if present
  let take = "";
  try {
    const an = await fetchData<{ agencyTakes: Take[] }>("/polls/analysis.json");
    const t = an.agencyTakes.find((x) => x.agencyId === prof.agencyId);
    take = (ctx.lang === "bg" ? t?.summary?.bg : t?.summary?.en) ?? "";
  } catch {
    /* analysis optional */
  }
  const house = (prof.houseEffect ?? [])
    .slice()
    .sort((a, b) => Math.abs(b.meanDiff ?? 0) - Math.abs(a.meanDiff ?? 0))[0];

  return {
    tool: "agencyProfile",
    domain: "elections",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `${prof.name_bg} — социологически профил`
        : `${prof.name_en} — pollster profile`,
    subtitle: take
      ? take.length > 280
        ? `${take.slice(0, 280)}…`
        : take
      : undefined,
    viz: "none",
    facts: {
      grade: prof.grade ?? "—",
      polls: prof.totalPolls,
      mean_error: `${prof.overallMAE} pp`,
      shrunk_error: prof.shrunkMAE != null ? `${prof.shrunkMAE} pp` : "—",
      threshold_calls:
        prof.barrierCallRate != null
          ? fmtPct(round2(prof.barrierCallRate * 100), ctx.lang)
          : "—",
      elections_covered: prof.electionsCovered?.length ?? 0,
      median_days_before: prof.medianDaysBefore ?? "—",
      house_effect: house
        ? `${house.key} (${house.meanDiff! > 0 ? "+" : ""}${house.meanDiff} pp)`
        : "—",
    },
    provenance: [
      "polls/accuracy.json",
      "polls/agencies.json",
      "polls/analysis.json",
    ],
  };
};

// ---- latest poll ------------------------------------------------------------

type Poll = {
  id: string;
  agencyId: string;
  fieldwork?: string;
  electionDate: string | null;
  respondents?: number | null;
};
type PollDetail = {
  pollId: string;
  nickName_bg: string;
  nickName_en: string;
  support: number;
};

const pollDate = (id: string): string => {
  const m = id.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};

export const latestPolls = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const [polls, details, agencies] = await Promise.all([
    fetchData<Poll[]>("/polls/polls.json"),
    fetchData<PollDetail[]>("/polls/polls_details.json"),
    fetchData<Agency[]>("/polls/agencies.json"),
  ]);
  const latest = [...polls].sort((a, b) =>
    pollDate(b.id).localeCompare(pollDate(a.id)),
  )[0];
  if (!latest) {
    return {
      tool: "latestPolls",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg" ? "Няма налични проучвания" : "No polls available",
      viz: "none",
      facts: {},
      provenance: ["polls/polls.json"],
    };
  }
  const ag = agencies.find((a) => a.id === latest.agencyId);
  const agName = ag
    ? ctx.lang === "bg"
      ? ag.name_bg
      : ag.name_en
    : latest.agencyId;
  const rows = details
    .filter((d) => d.pollId === latest.id)
    .sort((a, b) => b.support - a.support)
    .slice(0, 14);

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "support",
      label: ctx.lang === "bg" ? "Подкрепа" : "Support",
      numeric: true,
      format: "pct",
    },
  ];
  const tableRows: Row[] = rows.map((d) => ({
    party: ctx.lang === "bg" ? d.nickName_bg : d.nickName_en,
    support: round2(d.support),
  }));
  const ifNow = latest.electionDate === null;
  const leader = rows[0];
  return {
    tool: "latestPolls",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Последно проучване — ${agName}${ifNow ? " (ако изборите бяха сега)" : ""}`
        : `Latest poll — ${agName}${ifNow ? " (if elections were now)" : ""}`,
    subtitle: latest.fieldwork
      ? ctx.lang === "bg"
        ? `Теренна работа: ${latest.fieldwork}`
        : `Fieldwork: ${latest.fieldwork}`
      : undefined,
    columns,
    rows: tableRows,
    categories: rows.map((d) =>
      ctx.lang === "bg" ? d.nickName_bg : d.nickName_en,
    ),
    series: [
      {
        key: "support",
        label: ctx.lang === "bg" ? "Подкрепа %" : "Support %",
        points: rows.map((d) => ({
          x: ctx.lang === "bg" ? d.nickName_bg : d.nickName_en,
          y: round2(d.support),
        })),
      },
    ],
    viz: "bar",
    facts: {
      agency: agName,
      date: pollDate(latest.id),
      respondents: latest.respondents
        ? fmtInt(latest.respondents, ctx.lang)
        : "—",
      leader: leader
        ? `${ctx.lang === "bg" ? leader.nickName_bg : leader.nickName_en} (${fmtPct(round2(leader.support), ctx.lang)})`
        : "—",
      if_now: ifNow ? "yes" : "no",
    },
    provenance: ["polls/polls.json", "polls/polls_details.json"],
  } as Envelope;
};
