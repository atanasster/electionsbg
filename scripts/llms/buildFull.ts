// Build /public/llms-full.txt and /public/llms-full.en.txt — concatenated
// long-form content for AI / LLM crawlers. The /llms.txt overview is built
// separately by ./buildIndex.ts; this script writes the "full" corpora that
// some crawlers prefer (analogous to llms-full.txt in the de-facto spec).
//
// Output stays plain Markdown so a model can read it without extra parsing.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo, RegionInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
// Source data lives in /data/ post-GCS migration; the llms-full.txt output
// still belongs in /public/ so search/LLM crawlers can fetch it from the
// site root (electionsbg.com/llms-full.txt).
const DATA = path.join(PROJECT_ROOT, "data");
const PUBLIC = path.join(PROJECT_ROOT, "public");
const SITE_URL = "https://electionsbg.com";

type Lang = "bg" | "en";

const BG_MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const formatDate = (folder: string, lang: Lang): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  const months = lang === "en" ? EN_MONTHS : BG_MONTHS;
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

const fmtInt = (n: number, lang: Lang): string =>
  Math.round(n).toLocaleString(lang === "en" ? "en-US" : "bg-BG");

const fmtPct = (n: number, lang: Lang, digits = 2): string => {
  const v = n.toFixed(digits);
  return lang === "en" ? `${v}%` : `${v.replace(".", ",")}%`;
};

const fmtSignedPct = (n: number, lang: Lang, digits = 2): string => {
  const sign = n > 0 ? "+" : "";
  if (lang === "en") return `${sign}${n.toFixed(digits)} pp`;
  return `${sign}${n.toFixed(digits).replace(".", ",")} пп`;
};

type NationalSummary = {
  election: string;
  priorElection?: string;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
    deltaPct?: number;
  };
  topGainer?: { nickName: string; deltaPct: number };
  topLoser?: { nickName: string; deltaPct: number };
  paperMachine?: { paperPct: number; machinePct: number };
  anomalies?: {
    total: number;
    recount: number;
    suemgRemoved: number;
    problemSections: number;
  };
  parties: Array<{
    partyNum: number;
    nickName: string;
    name?: string;
    totalVotes: number;
    pct: number;
    deltaPct?: number;
    seats?: number;
    passedThreshold?: boolean;
  }>;
};

type ArticleMeta = {
  slug: string;
  election?: string;
  publishedAt: string;
  category?: string;
  title: { bg: string; en: string };
  summary: { bg: string; en: string };
};

const elections: ElectionInfo[] = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "src/data/json/elections.json"),
    "utf-8",
  ),
);
const latest = elections[0]?.name;

const COPY = {
  bg: {
    heading: "electionsbg.com — пълен дългоформатен корпус",
    intro: (siteUrl: string) =>
      `Дългоформатно българско съдържание от electionsbg.com — национално резюме, ретроспективен анализ на партиите, анализ на агенциите за социологически проучвания и пълните аналитични статии. Опресняване при всеки билд. По-кратък преглед: ${siteUrl}/llms.txt. Английски корпус: ${siteUrl}/llms-full.en.txt.`,
    site: "Сайт",
    sitemapIndex: "Сайтмап индекс",
    nationalSummaryHeading: (dateLabel: string) =>
      `Парламентарни избори ${dateLabel} — национално резюме`,
    turnout: "Избирателна активност",
    of: "от",
    registered: "регистрирани",
    topGain: "Най-голям ръст",
    topLoss: "Най-голям спад",
    paperMachine: "Хартия / машинно гласуване",
    anomaliesLine: "Засечени отклонения по секции",
    anomalyRecount: "повторно преброяване",
    anomalySuemg: "СУЕМГ свалени",
    anomalyProblem: "проблемни секции",
    partiesTableHeading: "Партии и резултати",
    tableHeader: "| Партия | Гласове | % | Δ | Мандати |",
    partyRetrospectHeading: "Партии — ретроспективен анализ",
    partyRetrospectIntro: (dateLabel: string) =>
      `Анализ на представянето на всяка партия преминала прага на ${dateLabel} — какво проработи, какво не и стратегически бележки за следващия вот.`,
    pollsHeading: "Социологически проучвания — анализ по агенции",
    pollsSiteLabel: "Сайт",
    pollsSummary: "Резюме",
    pollsLean: "Профил на отклоненията",
    pollsWarning: "Предупреждение",
    articlesHeading: "Аналитични статии",
    articlesIntro:
      "Всяка статия се публикува на български и английски. Връзките водят до отделните страници на сайта; пълните Markdown-извори са включени по-долу.",
    articlePublished: "Публикувана",
    articleCategory: "Категория",
    articleElection: "Избори",
    articleSummary: "Резюме",
    articleBgUrl: "URL (BG)",
    articleEnUrl: "URL (EN)",
    articleMdBg: "Markdown (BG)",
    articleMdEn: "Markdown (EN)",
    regionsHeading: "Области (МИР) — бързи връзки",
    governanceHeading:
      "Управление — местна йерархия (страна → област → община → населено място)",
    governanceIntro: (siteUrl: string) =>
      `Изгледът „Управление" е стълба от места: ${siteUrl}/governance (страна) → ${siteUrl}/governance/region/{област} → ${siteUrl}/governance/{код} за община (код на община) или населено място (ЕКАТТЕ). Всеки възел показва как се управлява мястото — депутати и декларации, кмет и общински съвет, общинско финансиране (Чл. 53), капиталови програми, еврофондове, обществени поръчки, местни данъци, преброяване, прозрачност (LISI) и качество на средата. Страниците за община и населено място са само на български; страниците за област имат и английски версии. Връзки към областните възли:`,
  },
  en: {
    heading: "electionsbg.com — full long-form corpus",
    intro: (siteUrl: string) =>
      `English long-form content from electionsbg.com — national summary, per-party retrospects, polling-agency analysis, and the full analytical articles. Refreshed on each build. Shorter overview: ${siteUrl}/llms.txt. Bulgarian corpus: ${siteUrl}/llms-full.txt.`,
    site: "Site",
    sitemapIndex: "Sitemap index",
    nationalSummaryHeading: (dateLabel: string) =>
      `Parliamentary elections ${dateLabel} — national summary`,
    turnout: "Turnout",
    of: "of",
    registered: "registered",
    topGain: "Biggest gain",
    topLoss: "Biggest loss",
    paperMachine: "Paper / machine vote",
    anomaliesLine: "Section-level anomalies detected",
    anomalyRecount: "recount",
    anomalySuemg: "machine flash removed",
    anomalyProblem: "problem sections",
    partiesTableHeading: "Parties and results",
    tableHeader: "| Party | Votes | % | Δ | Seats |",
    partyRetrospectHeading: "Parties — retrospective analysis",
    partyRetrospectIntro: (dateLabel: string) =>
      `Analysis of each party that cleared the threshold on ${dateLabel} — what worked, what did not, and strategic notes for the next vote.`,
    pollsHeading: "Polling — per-agency analysis",
    pollsSiteLabel: "Website",
    pollsSummary: "Summary",
    pollsLean: "Bias profile",
    pollsWarning: "Warning",
    articlesHeading: "Analytical articles",
    articlesIntro:
      "Each article is published in Bulgarian and English. Links point to the on-site pages; the full Markdown sources are inlined below.",
    articlePublished: "Published",
    articleCategory: "Category",
    articleElection: "Election",
    articleSummary: "Summary",
    articleBgUrl: "URL (BG)",
    articleEnUrl: "URL (EN)",
    articleMdBg: "Markdown (BG)",
    articleMdEn: "Markdown (EN)",
    regionsHeading: "Regions (MIR) — quick links",
    governanceHeading:
      "Governance — place ladder (country → region → município → settlement)",
    governanceIntro: (siteUrl: string) =>
      `The "Governance" view is a place ladder: ${siteUrl}/governance (country) → ${siteUrl}/governance/region/{oblast} → ${siteUrl}/governance/{id} for a município (obshtina code) or settlement (EKATTE). Each node shows how the place is governed — MPs and declarations, mayor & council, municipal financing (Article 53 transfers), capital programmes, EU funds, public procurement, local taxes, census, transparency (LISI) and quality-of-life. The município and settlement place pages are Bulgarian-only; the region pages have English mirrors. Links to the region nodes:`,
  },
} as const;

const buildCorpus = (lang: Lang): string => {
  const t = COPY[lang];
  const lines: string[] = [];

  lines.push(`# ${t.heading}`);
  lines.push("");
  lines.push(`> ${t.intro(SITE_URL)}`);
  lines.push("");
  lines.push(`${t.site}: ${SITE_URL}`);
  lines.push(`${t.sitemapIndex}: ${SITE_URL}/sitemap_index.xml`);
  lines.push("");

  // National summary --------------------------------------------------
  const nsFile = path.join(DATA, latest ?? "", "national_summary.json");
  let summary: NationalSummary | null = null;
  if (latest && fs.existsSync(nsFile)) {
    summary = JSON.parse(fs.readFileSync(nsFile, "utf-8"));
  }
  if (latest && summary) {
    lines.push(`## ${t.nationalSummaryHeading(formatDate(latest, lang))}`);
    lines.push("");
    lines.push(
      `${t.turnout}: ${fmtPct(summary.turnout.pct, lang)} (${fmtInt(summary.turnout.actual, lang)} ${t.of} ${fmtInt(summary.turnout.registered, lang)} ${t.registered}).`,
    );
    if (summary.topGainer && summary.topLoser) {
      lines.push(
        `${t.topGain}: ${summary.topGainer.nickName} (${fmtSignedPct(summary.topGainer.deltaPct, lang)}). ${t.topLoss}: ${summary.topLoser.nickName} (${fmtSignedPct(summary.topLoser.deltaPct, lang)}).`,
      );
    }
    if (summary.paperMachine) {
      lines.push(
        `${t.paperMachine}: ${fmtPct(summary.paperMachine.paperPct, lang)} / ${fmtPct(summary.paperMachine.machinePct, lang)}.`,
      );
    }
    if (summary.anomalies) {
      lines.push(
        `${t.anomaliesLine}: ${fmtInt(summary.anomalies.total, lang)} (${t.anomalyRecount}: ${fmtInt(summary.anomalies.recount, lang)}; ${t.anomalySuemg}: ${fmtInt(summary.anomalies.suemgRemoved, lang)}; ${t.anomalyProblem}: ${fmtInt(summary.anomalies.problemSections, lang)}).`,
      );
    }
    lines.push("");
    lines.push(`### ${t.partiesTableHeading}`);
    lines.push("");
    lines.push(t.tableHeader);
    lines.push("|---|---:|---:|---:|---:|");
    for (const p of summary.parties) {
      lines.push(
        `| ${p.nickName} | ${fmtInt(p.totalVotes, lang)} | ${fmtPct(p.pct, lang)} | ${
          p.deltaPct != null ? fmtSignedPct(p.deltaPct, lang) : ""
        } | ${p.seats ?? ""} |`,
      );
    }
    lines.push("");
  }

  // Party retrospects -------------------------------------------------
  if (latest) {
    const partiesFile = path.join(DATA, latest, "cik_parties.json");
    const assessmentDir = path.join(DATA, latest, "parties", "assessment");
    if (fs.existsSync(partiesFile) && fs.existsSync(assessmentDir)) {
      const parties: PartyInfo[] = JSON.parse(
        fs.readFileSync(partiesFile, "utf-8"),
      );
      const partyByNum = new Map(parties.map((p) => [p.number, p]));
      const files = fs
        .readdirSync(assessmentDir)
        .filter((f) => f.endsWith(".json"));
      const usable: { partyNum: number; party: PartyInfo; body: string }[] = [];
      for (const f of files) {
        const partyNum = parseInt(f.replace(".json", ""), 10);
        const party = partyByNum.get(partyNum);
        if (!party) continue;
        try {
          const a = JSON.parse(
            fs.readFileSync(path.join(assessmentDir, f), "utf-8"),
          );
          const body = lang === "en" ? a.en : a.bg;
          if (!body) continue;
          usable.push({ partyNum, party, body });
        } catch {
          continue;
        }
      }
      if (usable.length) {
        lines.push(`## ${t.partyRetrospectHeading}`);
        lines.push("");
        lines.push(t.partyRetrospectIntro(formatDate(latest, lang)));
        lines.push("");
        const langPrefix = lang === "en" ? "/en" : "";
        for (const u of usable) {
          const { party, body } = u;
          const label =
            party.name && party.name !== party.nickName
              ? `${party.name} (${party.nickName})`
              : party.nickName;
          lines.push(`### ${label}`);
          lines.push("");
          lines.push(
            `URL: ${SITE_URL}${langPrefix}/party/${encodeURIComponent(party.nickName)}`,
          );
          lines.push("");
          lines.push(body);
          lines.push("");
        }
      }
    }
  }

  // Polls -------------------------------------------------------------
  const pollsAnalysis = path.join(DATA, "polls", "analysis.json");
  const pollsAgencies = path.join(DATA, "polls", "agencies.json");
  if (fs.existsSync(pollsAnalysis) && fs.existsSync(pollsAgencies)) {
    const analysis = JSON.parse(fs.readFileSync(pollsAnalysis, "utf-8"));
    const agencies = JSON.parse(fs.readFileSync(pollsAgencies, "utf-8"));
    const agencyById = new Map<
      string,
      { name_bg: string; name_en?: string; website?: string | null }
    >(
      agencies.map(
        (a: {
          id: string;
          name_bg: string;
          name_en?: string;
          website?: string | null;
        }) => [a.id, a],
      ),
    );
    if (Array.isArray(analysis.agencyTakes) && analysis.agencyTakes.length) {
      lines.push(`## ${t.pollsHeading}`);
      lines.push("");
      const langPrefix = lang === "en" ? "/en" : "";
      for (const take of analysis.agencyTakes) {
        const agency = agencyById.get(take.agencyId);
        if (!agency) continue;
        const agencyName =
          lang === "en" ? (agency.name_en ?? agency.name_bg) : agency.name_bg;
        lines.push(`### ${agencyName}`);
        lines.push("");
        lines.push(
          `URL: ${SITE_URL}${langPrefix}/polls/${encodeURIComponent(take.agencyId)}`,
        );
        if (agency.website)
          lines.push(`${t.pollsSiteLabel}: ${agency.website}`);
        lines.push("");
        if (take.summary?.[lang]) {
          lines.push(`**${t.pollsSummary}:** ${take.summary[lang]}`);
          lines.push("");
        }
        if (take.lean?.[lang]) {
          lines.push(`**${t.pollsLean}:** ${take.lean[lang]}`);
          lines.push("");
        }
        if (take.warning?.[lang]) {
          lines.push(`**${t.pollsWarning}:** ${take.warning[lang]}`);
          lines.push("");
        }
      }
    }
  }

  // Articles ----------------------------------------------------------
  const articlesIndexFile = path.join(PUBLIC, "articles", "index.json");
  if (fs.existsSync(articlesIndexFile)) {
    const articles: ArticleMeta[] = JSON.parse(
      fs.readFileSync(articlesIndexFile, "utf-8"),
    );
    if (articles.length) {
      lines.push(`## ${t.articlesHeading}`);
      lines.push("");
      lines.push(`> ${t.articlesIntro}`);
      lines.push("");
      const sorted = [...articles].sort((a, b) =>
        (b.publishedAt || "").localeCompare(a.publishedAt || ""),
      );
      for (const a of sorted) {
        const mdFile = path.join(PUBLIC, "articles", `${a.slug}-${lang}.md`);
        const title = a.title?.[lang];
        const summary = a.summary?.[lang];
        if (!title) continue;
        lines.push(`### ${title}`);
        lines.push("");
        lines.push(
          `${t.articleBgUrl}: ${SITE_URL}/articles/${a.slug}  |  ${t.articleEnUrl}: ${SITE_URL}/en/articles/${a.slug}`,
        );
        lines.push(`${t.articleMdBg}: ${SITE_URL}/articles/${a.slug}-bg.md`);
        lines.push(`${t.articleMdEn}: ${SITE_URL}/articles/${a.slug}-en.md`);
        lines.push(`${t.articlePublished}: ${a.publishedAt}`);
        if (a.category) lines.push(`${t.articleCategory}: ${a.category}`);
        if (a.election) lines.push(`${t.articleElection}: ${a.election}`);
        lines.push("");
        if (summary) {
          lines.push(`**${t.articleSummary}:** ${summary}`);
          lines.push("");
        }
        if (fs.existsSync(mdFile)) {
          const body = fs.readFileSync(mdFile, "utf-8").trim();
          // Strip the document's own h1 (we already used it as h3 above) so
          // the outline of the corpus stays consistent.
          const stripped = body.replace(/^#\s+[^\n]*\n+/, "");
          lines.push(stripped);
          lines.push("");
        }
      }
    }
  }

  // Region quick-reference -------------------------------------------
  const regionsFile = path.join(PROJECT_ROOT, "src/data/json/regions.json");
  if (fs.existsSync(regionsFile)) {
    const regions: RegionInfo[] = JSON.parse(
      fs.readFileSync(regionsFile, "utf-8"),
    );
    const valid = regions.filter((r) => r.oblast !== "32");
    if (valid.length) {
      lines.push(`## ${t.regionsHeading}`);
      lines.push("");
      const langPrefix = lang === "en" ? "/en" : "";
      for (const r of valid) {
        const name =
          lang === "en"
            ? r.long_name_en || r.name_en || r.name
            : r.long_name || r.name;
        lines.push(
          `- ${name}: ${SITE_URL}${langPrefix}/municipality/${r.oblast}`,
        );
      }
      lines.push("");

      // Governance place ladder — region-node links. Region pages have /en
      // mirrors; the Sofia-city place node (SOF00) is BG-only, so it always
      // carries the BG URL.
      lines.push(`## ${t.governanceHeading}`);
      lines.push("");
      lines.push(t.governanceIntro(SITE_URL));
      lines.push("");
      for (const r of valid) {
        const name =
          lang === "en"
            ? r.long_name_en || r.name_en || r.name
            : r.long_name || r.name;
        lines.push(
          `- ${name}: ${SITE_URL}${langPrefix}/governance/region/${r.oblast}`,
        );
      }
      lines.push(
        `- ${lang === "en" ? "Sofia (capital)" : "София (столица)"}: ${SITE_URL}/governance/SOF00`,
      );
      lines.push("");
    }
  }

  return lines.join("\n");
};

const writeOutput = (filename: string, content: string) => {
  fs.writeFileSync(path.join(PUBLIC, filename), content, "utf-8");
  // Also write to dist/ so the file ships in the same build that generated it.
  // Without this, postbuild's update lands in public/ and only reaches dist/
  // on the *next* vite build — a one-build-stale gap.
  const dist = path.join(PROJECT_ROOT, "dist");
  if (fs.existsSync(dist)) {
    fs.writeFileSync(path.join(dist, filename), content, "utf-8");
  }
  console.log(
    `${filename}: ${Buffer.byteLength(content, "utf-8")} bytes, ${content.split("\n").length} lines`,
  );
};

writeOutput("llms-full.txt", buildCorpus("bg"));
writeOutput("llms-full.en.txt", buildCorpus("en"));
