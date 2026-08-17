// Build /public/llms-full.txt and /public/llms-full.en.txt — concatenated
// long-form content for AI / LLM crawlers. The /llms.txt overview is built
// separately by ./buildIndex.ts; this script writes the "full" corpora that
// some crawlers prefer (analogous to llms-full.txt in the de-facto spec).
//
// Output stays plain Markdown so a model can read it without extra parsing.
//
// NOT purely filesystem-driven any more: the judiciary table is read from
// Postgres at build time (the same seo_courts.ts enumeration the prerender and
// the sitemap use), so this script has a top-level await and a database
// dependency. Both sources degrade to [] rather than throwing — but because
// these outputs are COMMITTED, writeOutput refuses to publish a corpus that
// LOST a section rather than silently shrinking the served file.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo, RegionInfo } from "@/data/dataTypes";
import { readSeoCourts, type SeoCourt } from "../db/lib/seo_courts";
import { readSeoCouncils, type SeoCouncil } from "../db/lib/seo_councils";
import {
  readSeoPensionFunds,
  type SeoPensionFund,
} from "../prerender/kfnFunds";
import {
  judicialKindLabel,
  judicialNum,
  judicialTierAdjective,
} from "@/lib/judicialKind";
import { kfnFundName } from "@/lib/kfnFundSlug";
import { kfnSharePct } from "@/lib/kfnPeriod";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
// Source data lives in /data/ post-GCS migration; the llms-full.txt output
// still belongs in /public/ so search/LLM crawlers can fetch it from the
// site root (electionsbg.com/llms-full.txt).
const DATA = path.join(PROJECT_ROOT, "data");
const PUBLIC = path.join(PROJECT_ROOT, "public");
const SITE_URL = SITE_ORIGIN;

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
  draft?: boolean;
  unlisted?: boolean;
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
    councilHeading: "Общински съвети — решения и поименни гласувания",
    councilIntro: (siteUrl: string, covered: number, named: number) =>
      `Няма централен регистър на решенията на общинските съвети — всеки от 265-те съвета публикува своите сам, на своя сайт и в свой формат. Тук са ${covered} от тях, всеки със страница на ${siteUrl}/council/{код}. „Поименни вота" значи, че протоколът записва кой съветник как е гласувал; само ${named} съвета публикуват такива, при останалите има само общ сбор „за/против/въздържал се". Тире НЕ значи нула — значи, че този съвет не публикува поименно гласуване. Протоколите изброяват само гласувалите, няма запис кой е отсъствал, затова „участие" е дял от решенията с поименно гласуване, а не присъствие. Обзор: ${siteUrl}/council.`,
    councilTable:
      "| Съвет | Решения | Поименни вота | Последно решение | Последно поименно | URL |",
    judiciaryHeading: "Съдебна власт — органи, натовареност и магистрати",
    judiciaryIntro: (siteUrl: string) =>
      `Всеки съд, прокуратура и следствен отдел има собствена страница на ${siteUrl}/court/{код}. „Постъпили" и „свършени" са ДЕЙСТВИТЕЛНА натовареност — брой дела на съдия на месец за последната публикувана от ВСС година. Тире значи, че ВСС не публикува натовареност за този орган: така е за всички прокуратури и следствени отдели, а от съдилищата — само за ВКС и ВАС. Тирето не бива да се чете като нула. „Магистрати" са лицата с имуществени декларации в ИВСС от този орган. Обзор: ${siteUrl}/judiciary.`,
    judiciaryTable:
      "| Орган | Вид | Ниво | Седалище | Съдии | Магистрати | Постъпили/съдия/мес. | Свършени/съдия/мес. | Година | URL |",
    budgetHeading:
      "Държавният бюджет — началото и четиринадесетте страници под него",
    budgetIntro: (siteUrl: string) =>
      `Модулът „Бюджет" (${siteUrl}/budget) е разделен на страници, всяка с една задача и една декларирана основа. КОЛОНАТА „ОСНОВА" Е НАЙ-ВАЖНАТА: числата на този сайт идват от ЧЕТИРИ различни периметъра, които не се събират помежду си. „Държавен бюджет" е касовият отчет по КФП на Министерството на финансите — 24,78 млрд. евро разходи за 2024 г. „Сектор S13" е Евростат: държава плюс общини плюс социални фондове — 41,06 млрд. евро за същата година. „Социални фондове" е касовият отчет на НОИ, а трансферът от държавния бюджет към ДОО (5,89 млрд. евро за 2024 г.) е ЕДНИ И СЪЩИ ПАРИ, видени от двата края — веднъж като „Трансфери (нето)" в разходите на държавния бюджет и веднъж като приход на фонда. „Общини" е трети периметър. Сборове през периметрите дават числа, които Министерството на финансите не публикува никъде.`,
    budgetTable: "| Страница | На какво отговаря | Основа | Обхват | URL |",
    pensionsHeading:
      "Частни пенсионни фондове (КФН) — нетни активи и осигурени лица",
    pensionsIntro: (siteUrl: string) =>
      `Фондовете от втори и трети стълб, по тримесечни данни на КФН. Всеки има страница на ${siteUrl}/pension-fund/{slug}. „Дял сред същия вид" се смята спрямо фондовете от СЪЩИЯ вид (УПФ, ППФ, ДПФ, ДПФПС), а НЕ спрямо целия стълб — втори стълб са УПФ и ППФ заедно, трети са ДПФ и ДПФПС. Универсален и доброволен фонд не са сравними. Обзор на пенсиите: ${siteUrl}/pensions.`,
    pensionsTable:
      "| Фонд | Вид | Дружество | Осигурени лица | Нетни активи (EUR) | Дял сред същия вид | Тримесечие | URL |",
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
    councilHeading: "Municipal councils — decisions and named votes",
    councilIntro: (siteUrl: string, covered: number, named: number) =>
      `There is no central register of Bulgarian municipal-council decisions — each of the 265 councils publishes its own, on its own site, in its own format. ${covered} of them are here, each with a page at ${siteUrl}/en/council/{code}. "Named votes" means the minutes record how each councillor voted; only ${named} councils publish those, the rest give a for/against/abstained total only. A dash is NOT a zero — it means that council publishes no named vote. The minutes list only the councillors who voted, with no record of who was absent, so participation is a share of the decisions with a named vote, not an attendance rate. Overview: ${siteUrl}/en/council.`,
    councilTable:
      "| Council | Decisions | Named votes | Latest decision | Latest named vote | URL |",
    judiciaryHeading: "The judiciary — bodies, caseload and magistrates",
    judiciaryIntro: (siteUrl: string) =>
      `Every court, prosecution office and investigation service has its own page at ${siteUrl}/en/court/{code}. "Filed" and "resolved" are ACTUAL workload — cases per judge per month for the latest year the Supreme Judicial Council published. A dash means the Supreme Judicial Council publishes no workload for that body: that covers every prosecution office and investigation service, and among the courts only the two Supreme Courts. A dash is not a zero. "Magistrates" are the people filing asset declarations with the Judicial Inspectorate from that body. Overview: ${siteUrl}/en/judiciary.`,
    judiciaryTable:
      "| Body | Kind | Seat | Judges | Magistrates | Filed/judge/mo. | Resolved/judge/mo. | Year | URL |",
    budgetHeading: "The state budget — the hub and the fourteen pages under it",
    budgetIntro: (siteUrl: string) =>
      `The budget module (${siteUrl}/en/budget) is split into pages, each with one job and one declared basis. THE "BASIS" COLUMN IS THE IMPORTANT ONE: the figures on this site come from FOUR different perimeters that do not add together. "State budget" is the Ministry of Finance КФП cash report — €24.78bn of expenditure in 2024. "Sector S13" is Eurostat: the state plus municipalities plus the social funds — €41.06bn for the same year. "Social funds" is the NSSI cash report, and the state budget's transfer to the pension fund (€5.89bn in 2024) is THE SAME MONEY seen from both ends — once as "Transfers (net)" in state budget expenditure and once as fund revenue. "Municipalities" is a third perimeter. Summing across perimeters produces figures the Ministry of Finance publishes nowhere.`,
    budgetTable: "| Page | What it answers | Basis | Coverage | URL |",
    pensionsHeading:
      "Private pension funds (FSC) — net assets and insured persons",
    pensionsIntro: (siteUrl: string) =>
      `Pillar 2 and 3 funds, from the Financial Supervision Commission's quarterly register. Each has a page at ${siteUrl}/en/pension-fund/{slug}. "Share of fund type" is computed within the SAME type (UPF, PPF, VPF, VPFOS), NOT across the whole pillar — pillar 2 is UPF plus PPF, pillar 3 is VPF plus VPFOS. A universal and a voluntary fund are not comparable. Pensions overview: ${siteUrl}/en/pensions.`,
    pensionsTable:
      "| Fund | Type | Company | Insured | Net assets (EUR) | Share of fund type | Quarter | URL |",
    governanceIntro: (siteUrl: string) =>
      `The "Governance" view is a place ladder: ${siteUrl}/governance (country) → ${siteUrl}/governance/region/{oblast} → ${siteUrl}/governance/{id} for a município (obshtina code) or settlement (EKATTE). Each node shows how the place is governed — MPs and declarations, mayor & council, municipal financing (Article 53 transfers), capital programmes, EU funds, public procurement, local taxes, census, transparency (LISI) and quality-of-life. The município and settlement place pages are Bulgarian-only; the region pages have English mirrors. Links to the region nodes:`,
  },
} as const;

// A markdown table cell must not contain a raw pipe, and no name in either
// corpus does today — but a court name is free text from the ИВСС register, so
// escape rather than assume.
const cell = (v: string | number | null | undefined): string =>
  v == null || v === "" ? "—" : String(v).replace(/\|/g, "\\|");

/** A markdown separator row from a per-column alignment: "r" right-aligns. */
const sep = (align: string[]): string =>
  `| ${align.map((a) => (a === "r" ? "---:" : "---")).join(" | ")} |`;

const buildCorpus = (
  lang: Lang,
  courts: SeoCourt[],
  councils: SeoCouncil[],
  funds: SeoPensionFund[],
): string => {
  const t = COPY[lang];
  const lines: string[] = [];
  // One derivation for the whole corpus. The EN root is `/en`, NOT `/en/` —
  // the asymmetry CLAUDE.md calls out — and it was written out five times.
  const langPrefix = lang === "en" ? "/en" : "";

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
    // Exclude unpublished drafts and unlisted articles so their bodies never
    // reach the committed llms-full.txt (which deploys to production) — same
    // guard buildIndex.ts uses.
    const published = articles.filter((a) => !a.draft && !a.unlisted);
    if (published.length) {
      lines.push(`## ${t.articlesHeading}`);
      lines.push("");
      lines.push(`> ${t.articlesIntro}`);
      lines.push("");
      const sorted = [...published].sort((a, b) =>
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

  // Judiciary + private pensions ---------------------------------------
  // Compact and tabular, which is the shape an LLM answers from most reliably.
  // Both are small enough to fit an overview corpus without crowding it.
  //
  // A dash is NOT a zero anywhere below, and the intro prose says so: for a
  // court it means the ВСС published no workload for it (true of ВКС and ВАС
  // among others), and for `Магистрати` it means the dimension was not loaded
  // on the database this corpus was built from. Emitting 0 for either would
  // turn a gap in the source into a claim about the body.
  if (councils.length) {
    lines.push(`## ${t.councilHeading}`);
    lines.push("");
    lines.push(
      t.councilIntro(
        SITE_URL,
        councils.length,
        councils.filter((c) => c.hasNamedVotes).length,
      ),
    );
    lines.push("");
    lines.push(t.councilTable);
    lines.push(sep(["-", "r", "r", "-", "-", "-"]));
    for (const c of councils) {
      const cells = [
        cell(c.name),
        fmtInt(c.resolutions, lang),
        // A dash, never 0: eleven of the sixteen publish no named vote at all,
        // and a zero would read as "they voted and nobody was recorded".
        c.hasNamedVotes ? fmtInt(c.namedVotes, lang) : "—",
        cell(c.newestDecidedOn ?? "—"),
        // Behind the previous column wherever a council has stopped publishing
        // named votes — the one thing the decision list cannot say.
        cell(c.hasNamedVotes ? (c.newestNamedOn ?? "—") : "—"),
        `${SITE_URL}${langPrefix}/council/${c.code}`,
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  if (courts.length) {
    lines.push(`## ${t.judiciaryHeading}`);
    lines.push("");
    lines.push(t.judiciaryIntro(SITE_URL));
    lines.push("");
    lines.push(t.judiciaryTable);
    // Numeric columns right-aligned, matching the party table above.
    lines.push(
      sep(
        lang === "bg"
          ? ["-", "-", "-", "-", "r", "r", "r", "r", "r", "-"]
          : ["-", "-", "-", "r", "r", "r", "r", "r", "-"],
      ),
    );
    for (const c of courts) {
      const hasLoad = c.sourcesBuilt && c.year != null;
      const cells = [
        cell(c.name),
        cell(judicialKindLabel(c.kind)[lang]),
        // The BG table keeps the tier, agreed with its kind noun so a model
        // recombining the two cells does not produce "апелативен прокуратура".
        // The EN table drops the column: the tier exists only in Bulgarian, and
        // a Cyrillic cell under an English header is worse than no cell — the
        // same call the prerendered EN page makes.
        ...(lang === "bg" ? [cell(judicialTierAdjective(c.tier, c.kind))] : []),
        cell(lang === "en" ? (c.placeEn ?? c.place) : c.place),
        // `judges` is the ВСС staffing figure the per-month rates divide by —
        // without it the table can only answer "per judge", never "in total".
        // Same court_load row, so it is a dash on exactly the same bodies.
        hasLoad ? fmtInt(c.judges ?? 0, lang) : "—",
        // A dash, not a 0, when the register names no current-bench magistrate —
        // matching the other two consumers of this figure, which both decline to
        // make the claim: the page gates its sentence on `magistrates > 0`
        // (dynamicRoutes.ts) and orgNodeLd drops numberOfEmployees entirely
        // (jsonLd.ts). Writing "0" here would have this table assert zero
        // magistrates for 9 bodies in a corpus whose own intro says a dash is not
        // a zero — the one place that asymmetry is read by a machine.
        c.sourcesBuilt && c.magistrates > 0 ? fmtInt(c.magistrates, lang) : "—",
        hasLoad ? judicialNum(c.filedPerMonth, lang) : "—",
        hasLoad ? judicialNum(c.resolvedPerMonth, lang) : "—",
        hasLoad ? String(c.year) : "—",
        `${SITE_URL}${langPrefix}/court/${c.bodyCode}`,
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  if (funds.length) {
    const bg = lang === "bg";
    lines.push(`## ${t.pensionsHeading}`);
    lines.push("");
    lines.push(t.pensionsIntro(SITE_URL));
    lines.push("");
    lines.push(t.pensionsTable);
    lines.push(sep(["-", "-", "-", "r", "r", "r", "-", "-"]));
    for (const f of funds) {
      const cells = [
        cell(kfnFundName(f.pillar, f.companyBg, f.companyEn, bg)),
        cell(bg ? f.pillarLabelBg : f.pillarLabelEn),
        cell(bg ? f.companyBg : f.companyEn),
        f.insured == null ? "—" : fmtInt(f.insured, lang),
        f.netAssetsEur == null ? "—" : fmtInt(f.netAssetsEur, lang),
        f.typeSharePct == null ? "—" : kfnSharePct(f.typeSharePct, lang),
        cell(f.latestPeriodLabel),
        `${SITE_URL}${langPrefix}/pension-fund/${f.slug}`,
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  // The budget module -----------------------------------------------------
  // A list rather than a crawl of the pages, because the one fact a model
  // needs here is NOT on any of them individually: which perimeter each figure
  // belongs to. Without it the obvious operation — adding /budget/functional's
  // €41.06bn to /budget/spending's €24.78bn — produces a number nobody
  // publishes, and the social-funds transfer gets counted twice.
  lines.push(`## ${t.budgetHeading}`);
  lines.push("");
  lines.push(t.budgetIntro(SITE_URL));
  lines.push("");
  lines.push(t.budgetTable);
  lines.push(sep(["-", "-", "-", "-", "-"]));
  for (const b of BUDGET_PAGES) {
    const [name, answers, basis, coverage] = lang === "bg" ? b.bg : b.en;
    lines.push(
      `| ${cell(name)} | ${cell(answers)} | ${cell(basis)} | ${cell(coverage)} | ${SITE_URL}${langPrefix}/${b.path} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
};

/** The fourteen destinations the /budget hub fronts, with the ONE thing that
 *  cannot be recovered from the page title: which perimeter each figure is on.
 *  Static — this section has no source that can be absent, so unlike judiciary
 *  and pensions it is deliberately NOT in REQUIRED_SECTIONS: that gate exists
 *  to catch a DEGRADED build, and a hard-coded list can only disappear by
 *  somebody deleting it on purpose. */
const BUDGET_PAGES: Array<{
  path: string;
  bg: [string, string, string, string];
  en: [string, string, string, string];
}> = [
  {
    path: "budget",
    bg: [
      "Бюджетът — начало",
      "Откъде идват и къде отиват парите на държавата",
      "държавен бюджет",
      "КФП 2021–2026",
    ],
    en: [
      "Budget — hub",
      "Where the state's money comes from and goes",
      "state budget",
      "КФП 2021–2026",
    ],
  },
  {
    path: "budget/revenue",
    bg: [
      "Откъде идват парите",
      "Приходи по източник — данъчни, неданъчни, помощи",
      "държавен бюджет",
      "2021–2026",
    ],
    en: [
      "Where the money comes from",
      "Revenue by source — tax, non-tax, grants",
      "state budget",
      "2021–2026",
    ],
  },
  {
    path: "budget/spending",
    bg: [
      "За какво отиват парите",
      "Разходи по вид; „Трансфери (нето)“ е 58% от раздела",
      "държавен бюджет",
      "2021–2026",
    ],
    en: [
      "Where the money goes",
      'Expenditure by type; "Transfers (net)" is 58% of the section',
      "state budget",
      "2021–2026",
    ],
  },
  {
    path: "budget/execution",
    bg: [
      "Изпълнение",
      "План срещу отчет; приходи − разходи − вноска в ЕС = салдо",
      "държавен бюджет",
      "2021–2026",
    ],
    en: [
      "Execution",
      "Plan against outturn; revenue − expenditure − EU contribution = balance",
      "state budget",
      "2021–2026",
    ],
  },
  {
    path: "budget/functional",
    bg: [
      "По функции (COFOG)",
      "За какво се харчи — здраве, образование, отбрана",
      "сектор S13 (Евростат)",
      "2010–2024",
    ],
    en: [
      "By function (COFOG)",
      "What it is spent on — health, education, defence",
      "sector S13 (Eurostat)",
      "2010–2024",
    ],
  },
  {
    path: "budget/ministries",
    bg: [
      "Разпоредители",
      "Всяко ведомство с бюджет и обществени поръчки",
      "държавен бюджет",
      "по година",
    ],
    en: [
      "Spending units",
      "Each body with its budget and its procurement",
      "state budget",
      "by year",
    ],
  },
  {
    path: "budget/explorer",
    bg: [
      "Разгледай бюджета",
      "Разбивка ниво по ниво, административно или функционално",
      "и двата, по избор",
      "по година",
    ],
    en: [
      "Explore the budget",
      "Level-by-level drill-down, admin or functional",
      "either, selectable",
      "by year",
    ],
  },
  {
    path: "budget/deviations",
    bg: [
      "План срещу отчет по разпоредители",
      "Таван по закон, изменение и отчетено",
      "държавен бюджет",
      "по година",
    ],
    en: [
      "Plan vs outturn by unit",
      "Statutory ceiling, amendment and outturn",
      "state budget",
      "by year",
    ],
  },
  {
    path: "budget/investments",
    bg: [
      "Инвестиционна програма",
      "ПЛАН, не похарчено — Приложение III, 3 065 обекта",
      "държавен бюджет",
      "2025",
    ],
    en: [
      "Investment programme",
      "A PLAN, not spending — Annex III, 3,065 projects",
      "state budget",
      "2025",
    ],
  },
  {
    path: "budget/personnel",
    bg: [
      "Администрация",
      "Щат и заети; НЯМА пари — докладът не публикува заплати",
      "щатни бройки + НСИ",
      "2017–2025",
    ],
    en: [
      "Administration",
      "Posts and staff; NO money — the report publishes no payroll",
      "establishment + NSI",
      "2017–2025",
    ],
  },
  {
    path: "budget/social-funds",
    bg: [
      "Социални фондове",
      "ДОО, Учителски пенсионен фонд и ФГВРС — не НЗОК; собствените вноски покриват 52,4% от ДОО",
      "социални фондове (НОИ)",
      "по година",
    ],
    en: [
      "Social funds",
      "State pension, Teachers' Pension and Guaranteed Employee Claims funds — NOT the health fund; own contributions cover 52.4% of the pension fund",
      "social funds (NSSI)",
      "by year",
    ],
  },
  {
    path: "budget/law",
    bg: [
      "Бюджетен процес",
      "Кои от 8-те ключови документа са налични ТУК",
      "покритие на сайта",
      "по година",
    ],
    en: [
      "Budget process",
      "Which of the 8 key documents are available HERE",
      "site coverage",
      "by year",
    ],
  },
  {
    path: "budget/municipal",
    bg: [
      "Общините",
      "Трансфери по чл. 53; София 564 €/жител, Трекляно 5 028 €",
      "общини",
      "2018–2026",
    ],
    en: [
      "Municipalities",
      "Article 53 transfers; Sofia €564/resident, Treklyano €5,028",
      "municipalities",
      "2018–2026",
    ],
  },
  {
    path: "budget/municipal/investments",
    bg: [
      "ИПОП",
      "2,98 млрд. договорени срещу 0,99 млрд. изплатени, 3 492 проекта",
      "общини",
      "264 от 265 общини",
    ],
    en: [
      "IPOP",
      "€2.98bn agreed against €0.99bn paid, 3,492 projects",
      "municipalities",
      "264 of 265 municipalities",
    ],
  },
  {
    path: "budget/municipal/capital",
    bg: [
      "Капиталови програми",
      "Какво строят общините и с чии пари; разбивка по източник има само от 2 от 24-те за 2025 г.",
      "общини",
      "9–24 от 265 по година",
    ],
    en: [
      "Capital programmes",
      "What municipalities build and with whose money; only 2 of the 24 covered in 2025 publish a funding split",
      "municipalities",
      "9–24 of 265 by year",
    ],
  },
];

// The headings whose disappearance means a DEGRADED build rather than a
// content change — one per section fed by a source that can be absent.
const REQUIRED_SECTIONS: Array<{ heading: string; fix: string }> = [
  {
    heading: "## " + COPY.bg.judiciaryHeading,
    fix: "start the local Postgres (`npm run db:pg:up`) and re-run `npm run llms`",
  },
  {
    heading: "## " + COPY.en.judiciaryHeading,
    fix: "start the local Postgres (`npm run db:pg:up`) and re-run `npm run llms`",
  },
  {
    heading: "## " + COPY.bg.councilHeading,
    fix: "start the local Postgres (`npm run db:pg:up`) and re-run `npm run llms`",
  },
  {
    heading: "## " + COPY.en.councilHeading,
    fix: "start the local Postgres (`npm run db:pg:up`) and re-run `npm run llms`",
  },
  {
    heading: "## " + COPY.bg.pensionsHeading,
    fix: "restore data/budget/kfn/funds.json and re-run `npm run llms`",
  },
  {
    heading: "## " + COPY.en.pensionsHeading,
    fix: "restore data/budget/kfn/funds.json and re-run `npm run llms`",
  },
];

/**
 * True when the new corpus would DROP a section the committed one has.
 *
 * These files are COMMITTED, and every source behind them degrades to [] rather
 * than throwing — right for `dist/`, wrong here: a build on a machine without
 * Docker would rewrite llms-full.txt ~290 lines shorter, exit 0, and the only
 * signal would be one warning nobody greps. Skip-and-warn instead of publishing
 * the worse file, the same rule CLAUDE.md states for hub_stats / sector_stats.
 */
const wouldRegress = (filename: string, content: string): string | null => {
  const file = path.join(PUBLIC, filename);
  if (!fs.existsSync(file)) return null;
  const previous = fs.readFileSync(file, "utf-8");
  for (const { heading, fix } of REQUIRED_SECTIONS) {
    if (previous.includes(heading) && !content.includes(heading)) {
      return `"${heading.slice(3)}" — ${fix}`;
    }
  }
  return null;
};

const writeOutput = (filename: string, content: string) => {
  const lost = wouldRegress(filename, content);
  if (lost) {
    console.warn(
      `${filename}: SKIPPED — regenerating it here would drop the section ${lost}. ` +
        `The committed file is left as it is; a partial corpus is worse than a stale one.`,
    );
    return;
  }
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

// Both are build-time reads that degrade to [] — Postgres unreachable for the
// courts, no committed archive for the funds — so a corpus built without them
// simply omits those sections rather than failing the build.
const courts = await readSeoCourts();
const councils = await readSeoCouncils();
const funds = readSeoPensionFunds(PROJECT_ROOT);

writeOutput("llms-full.txt", buildCorpus("bg", courts, councils, funds));
writeOutput("llms-full.en.txt", buildCorpus("en", courts, councils, funds));
