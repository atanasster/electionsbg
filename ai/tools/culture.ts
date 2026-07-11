// Култура (culture) tools — the НФЦ film-subsidy corpus the /culture dashboard
// serves from data/culture/*.json (JSON, not DB). Amounts are already EUR.
// Mirrors the fiscal / subsidies tools' Envelope shape; tools NEVER compute a
// number in prose — the narrator only ever reads `facts`.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import { foldProducer } from "@/lib/foldProducer";
import type { ToolArgs, ToolContext, Envelope } from "./types";

interface ProducerBucket {
  producer: string;
  producerFold: string;
  eur: number;
  count: number;
  share: number;
}
interface CultureOverview {
  totalEur: number;
  filmCount: number;
  producerCount: number;
  firstYear: number;
  lastYear: number;
  byDiscipline: { discipline: string; eur: number; count: number }[];
  topProducers: ProducerBucket[];
  top10Share: number;
}
interface FilmAward {
  year: number;
  title: string;
  producer: string;
  producerFold: string;
  discipline: string;
  subsidyEur: number;
}
interface CultureFilms {
  firstYear: number;
  lastYear: number;
  films: FilmAward[];
}
interface GrantsFile {
  totalApplied: number;
  totalFunded: number;
  overallSuccessRate: number;
  totalFundedEur: number;
  totalRequestedEur: number;
  programs: {
    label: { bg: string; en: string };
    year: number;
    applied: number;
    funded: number;
    successRate: number;
    byDiscipline: {
      label: { bg: string; en: string };
      applied: number;
      funded: number;
      fundedEur: number;
    }[];
  }[];
}

const DISC_BG: Record<string, string> = {
  feature: "игрално",
  documentary: "документално",
  animation: "анимационно",
  other: "друго",
};
const DISC_EN: Record<string, string> = {
  feature: "feature",
  documentary: "documentary",
  animation: "animation",
  other: "other",
};

// ---- national overview -------------------------------------------------------
export const cultureOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const o = await fetchData<CultureOverview | null>("/culture/overview.json");
  if (!o) {
    return {
      tool: "cultureOverview",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за култура" : "No culture data",
      facts: {},
      viz: "none",
      provenance: ["culture/overview.json"],
    };
  }
  const disc = o.byDiscipline.map((d) => ({
    label: (bg ? DISC_BG : DISC_EN)[d.discipline] ?? d.discipline,
    total: fmtEurCompact(d.eur, ctx.lang),
    count: d.count,
  }));
  return {
    tool: "cultureOverview",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Държавна субсидия за кино (НФЦ) — ${o.firstYear}–${o.lastYear}`
      : `State film subsidy (НФЦ) — ${o.firstYear}–${o.lastYear}`,
    subtitle: bg ? "По вид кино" : "By discipline",
    columns: [
      { key: "label", label: bg ? "Вид" : "Discipline" },
      { key: "total", label: bg ? "Субсидия" : "Subsidy", numeric: true },
      { key: "count", label: bg ? "Проекти" : "Projects", numeric: true },
    ],
    rows: disc,
    viz: "bar",
    facts: {
      total: fmtEurCompact(o.totalEur, ctx.lang),
      films: fmtInt(o.filmCount, ctx.lang),
      producers: fmtInt(o.producerCount, ctx.lang),
      top10Share: fmtPct(o.top10Share, ctx.lang),
      biggestProducer: o.topProducers[0]?.producer ?? "—",
      span: `${o.firstYear}–${o.lastYear}`,
    },
    provenance: ["culture/overview.json"],
  };
};

// ---- top grantees ------------------------------------------------------------
export const topCultureGrantees = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const o = await fetchData<CultureOverview | null>("/culture/overview.json");
  if (!o) {
    return {
      tool: "topCultureGrantees",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни" : "No data",
      facts: {},
      viz: "none",
      provenance: ["culture/overview.json"],
    };
  }
  const top = o.topProducers.slice(0, 10);
  return {
    tool: "topCultureGrantees",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Най-финансирани продуценти (НФЦ)"
      : "Top-funded producers (НФЦ)",
    columns: [
      { key: "name", label: bg ? "Продуцент" : "Producer" },
      { key: "total", label: bg ? "Субсидия" : "Subsidy", numeric: true },
      { key: "count", label: bg ? "Проекти" : "Projects", numeric: true },
    ],
    rows: top.map((p) => ({
      name: p.producer,
      total: fmtEurCompact(p.eur, ctx.lang),
      count: p.count,
    })),
    viz: "bar",
    facts: {
      top10Share: fmtPct(o.top10Share, ctx.lang),
      biggestProducer: top[0]?.producer ?? "—",
      biggestAmount: top[0] ? fmtEurCompact(top[0].eur, ctx.lang) : "—",
    },
    provenance: ["culture/overview.json"],
  };
};

// ---- grant success rate ------------------------------------------------------
export const cultureGrantSuccess = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const g = await fetchData<GrantsFile | null>("/culture/grants.json");
  if (!g || g.programs.length === 0) {
    return {
      tool: "cultureGrantSuccess",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за грантове" : "No grant data",
      facts: {},
      viz: "none",
      provenance: ["culture/grants.json"],
    };
  }
  const progs = [...g.programs].sort((a, b) => b.successRate - a.successRate);
  const best = progs[0];
  const worst = progs[progs.length - 1];
  return {
    tool: "cultureGrantSuccess",
    domain: "fiscal",
    kind: "table",
    title: bg ? "Успеваемост на грантовете на НФК" : "НФК grant success rate",
    columns: [
      { key: "field", label: bg ? "Програма" : "Programme" },
      { key: "ratio", label: bg ? "Финансирани" : "Funded", numeric: true },
      { key: "rate", label: bg ? "Успеваемост" : "Rate", numeric: true },
    ],
    rows: progs.map((p) => ({
      field: bg ? p.label.bg : p.label.en,
      ratio: `${p.funded}/${p.applied}`,
      rate: fmtPct(p.successRate, ctx.lang),
    })),
    viz: "bar",
    facts: {
      rate: fmtPct(g.overallSuccessRate, ctx.lang),
      applied: fmtInt(g.totalApplied, ctx.lang),
      funded: fmtInt(g.totalFunded, ctx.lang),
      totalFunded: fmtEurCompact(g.totalFundedEur, ctx.lang),
      bestField: best ? (bg ? best.label.bg : best.label.en) : "—",
      bestRate: best ? fmtPct(best.funded / best.applied, ctx.lang) : "—",
      worstField: worst ? (bg ? worst.label.bg : worst.label.en) : "—",
      worstRate: worst ? fmtPct(worst.funded / worst.applied, ctx.lang) : "—",
    },
    provenance: ["culture/grants.json"],
  };
};

// ---- one producer ------------------------------------------------------------
export const filmSubsidyForProducer = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.company ?? args.metric ?? "").trim();
  const f = await fetchData<CultureFilms | null>("/culture/films.json");
  if (!f || !query) {
    return {
      tool: "filmSubsidyForProducer",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни" : "No data",
      facts: {},
      viz: "none",
      provenance: ["culture/films.json"],
    };
  }
  // Guard the substring match: a too-short fold (or an empty stored key) would
  // match unrelated films — `q.includes("")` is always true — so require a
  // meaningful length on BOTH the query fold and each stored producer key.
  const q = foldProducer(query);
  const mine =
    q.length < 3
      ? []
      : f.films.filter(
          (x) =>
            x.producerFold.length >= 3 &&
            (x.producerFold.includes(q) || q.includes(x.producerFold)),
        );
  if (mine.length === 0) {
    return {
      tool: "filmSubsidyForProducer",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? `Няма филмова субсидия за „${query}"`
        : `No film subsidy for “${query}”`,
      facts: { producer: query },
      viz: "none",
      provenance: ["culture/films.json"],
    };
  }
  const totalEur = mine.reduce((s, x) => s + x.subsidyEur, 0);
  const name = mine[0].producer;
  const top = [...mine]
    .sort((a, b) => b.subsidyEur - a.subsidyEur)
    .slice(0, 10);
  return {
    tool: "filmSubsidyForProducer",
    domain: "fiscal",
    kind: "table",
    title: bg ? `Филмова субсидия за ${name}` : `Film subsidy for ${name}`,
    columns: [
      { key: "title", label: bg ? "Проект" : "Project" },
      { key: "year", label: bg ? "Година" : "Year", numeric: true },
      { key: "total", label: bg ? "Субсидия" : "Subsidy", numeric: true },
    ],
    rows: top.map((x) => ({
      title: x.title,
      year: x.year,
      total: fmtEurCompact(x.subsidyEur, ctx.lang),
    })),
    viz: "none",
    facts: {
      producer: name,
      total: fmtEurCompact(totalEur, ctx.lang),
      films: fmtInt(mine.length, ctx.lang),
    },
    provenance: ["culture/films.json"],
  };
};
