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

interface MunicipalFile {
  sofia: {
    year: number;
    fundedCount: number;
    appliedCount: number;
    totalEur: number;
    directions: { n: number; bg: string; count: number; eur: number }[];
  };
  chitalishta: {
    year: number;
    subsidizedPositions: number;
    totalEur: number;
    announcedEur: number;
    cutEur: number;
  };
}

interface CommissionsFile {
  order: string;
  mandateStart: string;
  mandateEnd: string;
  lotteryDate: string;
  commissions: {
    id: string;
    bg: string;
    en: string;
    members: {
      name: string;
      role: "chair" | "member";
      status: "titular" | "reserve";
      section: string;
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

// ---- who decides (artistic commissions) --------------------------------------
export const cultureCommissions = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const c = await fetchData<CommissionsFile | null>(
    "/culture/commissions.json",
  );
  if (!c || !c.commissions?.length) {
    return {
      tool: "cultureCommissions",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за комисиите" : "No commission data",
      facts: {},
      viz: "none",
      provenance: ["culture/commissions.json"],
    };
  }
  const rows = c.commissions.flatMap((com) =>
    com.members.map((m) => ({
      commission: bg ? com.bg : com.en,
      member: m.name,
      role:
        m.role === "chair"
          ? bg
            ? "председател"
            : "chair"
          : bg
            ? "член"
            : "member",
      section: m.section,
    })),
  );
  const chairOf = (id: string) => {
    const com = c.commissions.find((x) => x.id === id);
    return com?.members.find((m) => m.role === "chair")?.name ?? "—";
  };
  return {
    tool: "cultureCommissions",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Кой решава за филмовите пари (НФЦ комисии)"
      : "Who decides the film money (НФЦ commissions)",
    columns: [
      { key: "commission", label: bg ? "Комисия" : "Commission" },
      { key: "member", label: bg ? "Член" : "Member" },
      { key: "role", label: bg ? "Роля" : "Role" },
      { key: "section", label: bg ? "Раздел" : "Register section" },
    ],
    rows,
    viz: "none",
    facts: {
      order: c.order,
      mandate: `${c.mandateStart} – ${c.mandateEnd}`,
      commissions: String(c.commissions.length),
      members: String(rows.length),
      featureChair: chairOf("feature"),
      documentaryChair: chairOf("documentary"),
      animationChair: chairOf("animation"),
    },
    provenance: ["culture/commissions.json"],
  };
};

// ---- municipal + читалища ----------------------------------------------------
export const cultureMunicipal = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const m = await fetchData<MunicipalFile | null>("/culture/municipal.json");
  if (!m || !m.sofia) {
    return {
      tool: "cultureMunicipal",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за общинската култура"
        : "No municipal culture data",
      facts: {},
      viz: "none",
      provenance: ["culture/municipal.json"],
    };
  }
  const dirs = [...m.sofia.directions].sort((a, b) => b.eur - a.eur);
  return {
    tool: "cultureMunicipal",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Общинска и читалищна култура (Столична програма + читалища)"
      : "Municipal & community-centre culture (Sofia programme + читалища)",
    columns: [
      { key: "field", label: bg ? "Направление" : "Direction" },
      { key: "count", label: bg ? "Проекти" : "Projects", numeric: true },
      { key: "eur", label: bg ? "Финансиране" : "Funding", numeric: true },
    ],
    rows: dirs.map((d) => ({
      field: d.bg,
      count: String(d.count),
      eur: fmtEurCompact(d.eur, ctx.lang),
    })),
    viz: "bar",
    facts: {
      sofiaFunded: fmtInt(m.sofia.fundedCount, ctx.lang),
      sofiaApplied: fmtInt(m.sofia.appliedCount, ctx.lang),
      sofiaTotal: fmtEurCompact(m.sofia.totalEur, ctx.lang),
      sofiaRate: fmtPct(
        m.sofia.appliedCount ? m.sofia.fundedCount / m.sofia.appliedCount : 0,
        ctx.lang,
      ),
      sofiaYear: String(m.sofia.year),
      chitalishtaTotal: fmtEurCompact(m.chitalishta.totalEur, ctx.lang),
      chitalishtaPositions: fmtInt(m.chitalishta.subsidizedPositions, ctx.lang),
      chitalishtaCut: fmtEurCompact(m.chitalishta.cutEur, ctx.lang),
    },
    provenance: ["culture/municipal.json"],
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
