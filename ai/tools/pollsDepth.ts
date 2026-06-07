// D1.5 — detailed polling tools: per-agency profile + the latest poll breakdown.

import { fetchData } from "./dataClient";
import {
  electionFullLabel,
  electionShortLabel,
  fmtInt,
  fmtPct,
} from "./format";
import { round2 } from "./dataset";
import { fuzzyBestMatch } from "./resolve";
import type {
  Column,
  Envelope,
  Row,
  Series,
  ToolArgs,
  ToolContext,
} from "./types";

const norm = (s: string): string =>
  s.toLowerCase().replace(/[\s.„“”"'`-]+/g, "");

// Whole-word tokens (used for exact abbreviation matches; \b is unreliable around
// Cyrillic, so we tokenise instead).
const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-zа-яё]+/i)
      .filter(Boolean),
  );

const parseNum = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// ISO "2026-04-19" -> the underscore form the label helpers expect.
const isoLabel = (iso: string, lang: "bg" | "en", full = false): string => {
  const u = iso.replace(/-/g, "_");
  return full ? electionFullLabel(u, lang) : electionShortLabel(u, lang);
};

// ---- agency profile ---------------------------------------------------------

type Bias = { key: string; meanError?: number; meanDiff?: number };
type MaePoint = { electionDate: string; mae: number; rmse: number };
type AgencyProfile = {
  agencyId: string;
  name_bg: string;
  name_en: string;
  totalPolls: number;
  overallMAE: number;
  overallMAEAdjusted?: number;
  shrunkMAE?: number;
  barrierCallRate?: number;
  grade?: string;
  medianDaysBefore?: number;
  electionsCovered?: string[];
  houseEffect?: Bias[];
  maeHistory?: MaePoint[];
};
type Agency = {
  id: string;
  name_bg: string;
  name_en: string;
  abbr_bg?: string;
  abbr_en?: string;
};
type Take = { agencyId: string; summary?: { bg?: string; en?: string } };

// Resolve a free-text agency query (often the WHOLE user utterance) to one
// agency. Full names match by substring (≥4 chars, so noise can't hit them);
// abbreviations / ids match only as a whole query token — otherwise a 2-letter
// abbr like "АР" (Алфа Рисърч) would substring-hit inside "маркет" and steal a
// "Маркет ЛИНКС" query. Longest matched key wins; a fuzzy pass catches typos.
export const matchAgency = (
  query: string,
  agencies: Agency[],
): Agency | undefined => {
  const q = norm(query);
  const toks = tokens(query);
  let best: { ag: Agency; score: number } | undefined;
  for (const a of agencies) {
    let score = 0;
    for (const name of [a.name_bg, a.name_en]) {
      const nn = norm(name);
      if (nn.length >= 4 && (q.includes(nn) || nn.includes(q)))
        score = Math.max(score, nn.length);
    }
    for (const ab of [a.abbr_bg, a.abbr_en, a.id]) {
      if (ab && toks.has(ab.toLowerCase()))
        score = Math.max(score, norm(ab).length + 1);
    }
    if (score > (best?.score ?? 0)) best = { ag: a, score };
  }
  if (best) return best.ag;
  return fuzzyBestMatch(
    query,
    agencies.map((a) => ({
      item: a,
      keys: [a.name_bg, a.name_en, a.abbr_bg, a.abbr_en].filter(
        Boolean,
      ) as string[],
    })),
    { threshold: 0.32, minLen: 4, cacheKey: "agency" },
  )?.item;
};

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
  // resolve agency id via the shared catalogue matcher (names + abbreviations)
  const ag = matchAgency(query, agencies);
  let prof =
    acc.agencyProfiles.find((p) => p.agencyId === ag?.id) ||
    acc.agencyProfiles.find((p) => {
      const nb = norm(p.name_bg);
      const ne = norm(p.name_en);
      return (
        nb.includes(q) || ne.includes(q) || q.includes(nb) || q.includes(ne)
      );
    });
  if (!prof) {
    // typo fallback: fuzzy-match the profile names directly (the catalogue +
    // abbreviation pass already ran inside matchAgency above).
    prof = fuzzyBestMatch(
      query,
      acc.agencyProfiles.map((p) => ({
        item: p,
        keys: [p.name_bg, p.name_en],
      })),
      { threshold: 0.32, minLen: 4, cacheKey: "agencyProfile" },
    )?.item;
  }
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

// ---- agency poll history (trend of an agency's published numbers) ------------
// A multi-line trend of one agency's reported support per party across all its
// polls over time — the chat answer behind "история на проучванията на X".

const MAX_POLL_LINES = 8;

const agencyNotFound = (
  tool: string,
  query: string,
  ctx: ToolContext,
  provenance: string[],
): Envelope => ({
  tool,
  domain: "elections",
  kind: "scalar",
  title:
    ctx.lang === "bg"
      ? `Не намерих агенция „${query}“`
      : `No agency matched "${query}"`,
  viz: "none",
  facts: { query },
  provenance,
});

export const agencyPolls = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const query = String(args.agency ?? "");
  const [polls, details, agencies] = await Promise.all([
    fetchData<Poll[]>("/polls/polls.json"),
    fetchData<PollDetail[]>("/polls/polls_details.json"),
    fetchData<Agency[]>("/polls/agencies.json"),
  ]);
  const ag = matchAgency(query, agencies);
  if (!ag)
    return agencyNotFound("agencyPolls", query, ctx, [
      "polls/polls.json",
      "polls/agencies.json",
    ]);
  const agName = ctx.lang === "bg" ? ag.name_bg : ag.name_en;

  let mine = polls
    .filter((p) => p.agencyId === ag.id)
    .sort((a, b) => pollDate(a.id).localeCompare(pollDate(b.id)));

  // Optional windowing: a years phrase narrows by date; a bare count keeps the
  // last N polls. Neither = the full archive (what "история" usually wants).
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  if (years && mine.length) {
    const lastYear = parseInt(
      pollDate(mine[mine.length - 1].id).slice(0, 4),
      10,
    );
    const cutoff = lastYear - years;
    mine = mine.filter(
      (p) => parseInt(pollDate(p.id).slice(0, 4), 10) >= cutoff,
    );
  }
  if (n) mine = mine.slice(-n);

  if (!mine.length)
    return {
      tool: "agencyPolls",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `${agName} — няма налични проучвания`
          : `${agName} — no polls available`,
      viz: "none",
      facts: { agency: agName, agency_id: ag.id },
      provenance: ["polls/polls.json", "polls/agencies.json"],
    };

  const byPoll = new Map<string, PollDetail[]>();
  for (const d of details) {
    const arr = byPoll.get(d.pollId);
    if (arr) arr.push(d);
    else byPoll.set(d.pollId, [d]);
  }

  // One line per party (keyed by English nick for cross-poll stability); keep
  // the top parties by peak support so the chart stays legible.
  type Line = {
    label_bg: string;
    label_en: string;
    peak: number;
    byPoll: Map<string, number>;
  };
  const lineMap = new Map<string, Line>();
  for (const p of mine) {
    for (const d of byPoll.get(p.id) ?? []) {
      const key = d.nickName_en || d.nickName_bg;
      let line = lineMap.get(key);
      if (!line) {
        line = {
          label_bg: d.nickName_bg,
          label_en: d.nickName_en,
          peak: 0,
          byPoll: new Map(),
        };
        lineMap.set(key, line);
      }
      line.byPoll.set(p.id, round2(d.support));
      line.peak = Math.max(line.peak, d.support);
      line.label_bg = d.nickName_bg; // latest branding
      line.label_en = d.nickName_en;
    }
  }
  const lines = [...lineMap.values()]
    .sort((a, b) => b.peak - a.peak)
    .slice(0, MAX_POLL_LINES);

  const xOf = (p: Poll) => isoLabel(pollDate(p.id), ctx.lang, true);
  const categories = mine.map(xOf);
  const series: Series[] = lines.map((l, i) => ({
    key: `p${i}`,
    label: ctx.lang === "bg" ? l.label_bg : l.label_en,
    points: mine.map((p) => ({
      x: xOf(p),
      y: l.byPoll.has(p.id) ? l.byPoll.get(p.id)! : null,
    })),
  }));

  const first = mine[0];
  const latest = mine[mine.length - 1];
  const top = (byPoll.get(latest.id) ?? [])
    .slice()
    .sort((a, b) => b.support - a.support)[0];

  return {
    tool: "agencyPolls",
    domain: "elections",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `${agName} — история на проучванията`
        : `${agName} — poll history`,
    subtitle:
      ctx.lang === "bg"
        ? `Подкрепа по партии в ${mine.length} проучвания`
        : `Party support across ${mine.length} polls`,
    categories,
    series,
    viz: "line",
    facts: {
      agency: agName,
      agency_id: ag.id,
      polls: mine.length,
      parties_shown: lines.length,
      range: `${isoLabel(pollDate(first.id), ctx.lang)} → ${isoLabel(pollDate(latest.id), ctx.lang)}`,
      latest_poll: isoLabel(pollDate(latest.id), ctx.lang, true),
      latest_leader: top
        ? `${ctx.lang === "bg" ? top.nickName_bg : top.nickName_en} (${fmtPct(round2(top.support), ctx.lang)})`
        : "—",
    },
    provenance: [
      "polls/polls.json",
      "polls/polls_details.json",
      "polls/agencies.json",
    ],
  };
};

// ---- agency accuracy history (mean error per election over time) -------------
// One agency's forecasting accuracy across the elections it covered — the trend
// behind "точност на X през годините" / "how has X's accuracy changed".

export const agencyAccuracyHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const query = String(args.agency ?? "");
  const [acc, agencies] = await Promise.all([
    fetchData<{ agencyProfiles: AgencyProfile[] }>("/polls/accuracy.json"),
    fetchData<Agency[]>("/polls/agencies.json"),
  ]);
  const ag = matchAgency(query, agencies);
  let prof = acc.agencyProfiles.find((p) => p.agencyId === ag?.id);
  if (!prof)
    prof = fuzzyBestMatch(
      query,
      acc.agencyProfiles.map((p) => ({
        item: p,
        keys: [p.name_bg, p.name_en],
      })),
      { threshold: 0.32, minLen: 4, cacheKey: "agencyProfile" },
    )?.item;

  const hist = (prof?.maeHistory ?? [])
    .slice()
    .sort((a, b) => a.electionDate.localeCompare(b.electionDate));
  if (!prof || !hist.length)
    return agencyNotFound("agencyAccuracyHistory", query, ctx, [
      "polls/accuracy.json",
      "polls/agencies.json",
    ]);

  const agName = ctx.lang === "bg" ? prof.name_bg : prof.name_en;
  const xOf = (h: MaePoint) => isoLabel(h.electionDate, ctx.lang);
  const categories = hist.map(xOf);
  const series: Series[] = [
    {
      key: "mae",
      label: ctx.lang === "bg" ? "Средна грешка (MAE)" : "Mean error (MAE)",
      points: hist.map((h) => ({ x: xOf(h), y: round2(h.mae) })),
    },
    {
      key: "rmse",
      label: "RMSE",
      points: hist.map((h) => ({ x: xOf(h), y: round2(h.rmse) })),
    },
  ];

  const best = [...hist].sort((a, b) => a.mae - b.mae)[0];
  const worst = [...hist].sort((a, b) => b.mae - a.mae)[0];
  const first = hist[0];
  const latest = hist[hist.length - 1];

  return {
    tool: "agencyAccuracyHistory",
    domain: "elections",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `${agName} — точност през годините`
        : `${agName} — accuracy over time`,
    subtitle:
      ctx.lang === "bg"
        ? "По-ниска грешка = по-точна прогноза"
        : "Lower error = more accurate",
    categories,
    series,
    viz: "line",
    facts: {
      agency: agName,
      agency_id: prof.agencyId,
      grade: prof.grade ?? "—",
      elections: hist.length,
      overall_mae: `${prof.overallMAE} pp`,
      best_election: `${isoLabel(best.electionDate, ctx.lang)} (${round2(best.mae)} pp)`,
      worst_election: `${isoLabel(worst.electionDate, ctx.lang)} (${round2(worst.mae)} pp)`,
      latest: `${isoLabel(latest.electionDate, ctx.lang)} (${round2(latest.mae)} pp)`,
      trend: `${round2(first.mae)} → ${round2(latest.mae)} pp`,
    },
    provenance: ["polls/accuracy.json", "polls/agencies.json"],
  };
};

// ---- comparative accuracy trend (one line per agency) -----------------------
// All multi-election agencies' mean error plotted across the same election axis —
// the trend behind "сравни точността на агенциите през годините".

export const accuracyTrend = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const acc = await fetchData<{ agencyProfiles: AgencyProfile[] }>(
    "/polls/accuracy.json",
  );
  const profiles = acc.agencyProfiles.filter((p) =>
    Number.isFinite(p.overallMAE),
  );
  // A "trend" needs ≥2 elections; single-election agencies are noted, not drawn.
  const multi = profiles.filter((p) => (p.maeHistory?.length ?? 0) >= 2);
  const singles = profiles.filter((p) => (p.maeHistory?.length ?? 0) < 2);

  const dateSet = new Set<string>();
  multi.forEach((p) =>
    (p.maeHistory ?? []).forEach((h) => dateSet.add(h.electionDate)),
  );
  const dates = [...dateSet].sort((a, b) => a.localeCompare(b));

  const ord = (p: AgencyProfile) => p.overallMAEAdjusted ?? p.overallMAE;
  const shown = [...multi]
    .sort((a, b) => ord(a) - ord(b))
    .slice(0, MAX_POLL_LINES);

  const categories = dates.map((d) => isoLabel(d, ctx.lang));
  const series: Series[] = shown.map((p) => ({
    key: p.agencyId,
    label: ctx.lang === "bg" ? p.name_bg : p.name_en,
    points: dates.map((d) => {
      const h = (p.maeHistory ?? []).find((x) => x.electionDate === d);
      return { x: isoLabel(d, ctx.lang), y: h ? round2(h.mae) : null };
    }),
  }));

  const best = [...profiles].sort((a, b) => a.overallMAE - b.overallMAE)[0];

  return {
    tool: "accuracyTrend",
    domain: "elections",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? "Точност на агенциите през годините"
        : "Pollster accuracy over time",
    subtitle:
      ctx.lang === "bg"
        ? "Средна грешка по избори — по-ниско = по-точно"
        : "Mean error by election — lower = more accurate",
    categories,
    series,
    viz: "line",
    facts: {
      agencies_shown: shown.length,
      elections: dates.length,
      range: dates.length
        ? `${isoLabel(dates[0], ctx.lang)} → ${isoLabel(dates[dates.length - 1], ctx.lang)}`
        : "—",
      most_accurate: best
        ? `${ctx.lang === "bg" ? best.name_bg : best.name_en} (${best.overallMAE} pp)`
        : "—",
      single_election_agencies: singles.length
        ? singles
            .map((p) => (ctx.lang === "bg" ? p.name_bg : p.name_en))
            .join(", ")
        : "—",
    },
    provenance: ["polls/accuracy.json"],
  };
};
