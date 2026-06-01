import fs from "fs";
import path from "path";
import { PartyInfo, RegionInfo } from "@/data/dataTypes";
import { DIASPORA_FAQ } from "@/data/diaspora/diasporaFaq";
import { SITE_URL } from "./routes";

// ── Site-wide section navigation ──────────────────────────────────────────
// A crawlable link block appended to the (hidden) #ssg-content body of EVERY
// prerendered page (see index.ts renderBodyBlock). Before this existed, the
// homepage body linked only to /elections and /articles, so Googlebot had no
// internal-link path to the broader data hubs (/budget, /procurement,
// /connections, …) — six months of GSC showed ~0 impressions for all of them
// despite each being fully prerendered. A sitemap is a discovery hint, not an
// authority signal; these links give every hub a real internal link from all
// ~84k pages, the home page included. See memory: project_seo_discovery_gap.
//
// INVARIANT: only list a path that has a real prerendered landing page (a static
// entry in routes.ts or a dynamic index in dynamicRoutes). Linking a path with
// no prerendered landing would route a no-JS crawler through the Firebase
// **→/index.html rewrite, serving the HOMEPAGE prerender (canonical=/) at that
// URL — a soft-duplicate. transparency/landuse/officials are intentionally
// absent until they get landing pages.
// `bgOnly` marks hubs whose dynamic landing emits no /en mirror — their EN-nav
// link must point at the BG (canonical) URL, not a non-existent /en/<path> that
// would fall through the SPA rewrite to the homepage.
const NAV_HUBS: { path: string; bg: string; en: string; bgOnly?: true }[] = [
  { path: "governance", bg: "Управление", en: "Governance" },
  { path: "parliament", bg: "Народно събрание", en: "National Assembly" },
  {
    path: "votes",
    bg: "Поименни гласувания",
    en: "Roll-call votes",
    bgOnly: true,
  },
  { path: "governments", bg: "Правителства", en: "Governments" },
  {
    path: "connections",
    bg: "Бизнес-връзки на депутати",
    en: "MP business connections",
  },
  { path: "procurement", bg: "Обществени поръчки", en: "Public procurement" },
  { path: "budget", bg: "Държавен бюджет", en: "State budget" },
  { path: "funds", bg: "Европейски средства", en: "EU funds" },
  { path: "indicators", bg: "Индикатори", en: "Indicators" },
  { path: "financing", bg: "Партийно финансиране", en: "Party financing" },
  {
    path: "polls",
    bg: "Социологически проучвания",
    en: "Opinion polls",
    bgOnly: true,
  },
  { path: "simulator", bg: "Симулатор за мандати", en: "Seat simulator" },
  { path: "parties", bg: "Партии", en: "Parties" },
  { path: "regions", bg: "Резултати по области", en: "Results by region" },
  {
    path: "local/chmi",
    bg: "Извънредни местни избори",
    en: "Extraordinary local elections",
  },
  {
    path: "sverka",
    bg: "Сверка на местните избори",
    en: "Local-elections reconciliation",
  },
  { path: "sofia", bg: "София", en: "Sofia" },
  { path: "about", bg: "За проекта", en: "About the project" },
];

// Builds the shared section-navigation block. Language-aware: the EN variant
// points at the /en/* prerendered mirrors. Appended once per page by the
// prerender renderer (index.ts), so it must NOT be added to per-page bodies.
export const buildSiteNav = (lang: "bg" | "en"): string => {
  const base = lang === "en" ? `${SITE_URL}/en` : SITE_URL;
  const heading = lang === "en" ? "Explore the data" : "Разгледайте данните";
  const homeLabel = lang === "en" ? "Home" : "Начало";
  const items = [
    `<li><a href="${base}/">${escapeHtml(homeLabel)}</a></li>`,
    ...NAV_HUBS.map((h) => {
      const label = escapeHtml(lang === "en" ? h.en : h.bg);
      // bgOnly hubs have no /en mirror — link EN nav to the BG URL.
      const hrefBase = lang === "en" && h.bgOnly ? SITE_URL : base;
      return `<li><a href="${hrefBase}/${h.path}">${label}</a></li>`;
    }),
  ].join("");
  return `<nav aria-label="${escapeHtml(
    heading,
  )}"><h2>${escapeHtml(heading)}</h2><ul>${items}</ul></nav>`;
};

const escapeHtml = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeAttr = escapeHtml;

const fmtInt = (n: number): string =>
  Math.round(n)
    .toLocaleString("bg-BG")
    .replace(/\u00A0/g, " ");

const fmtPct = (n: number, digits = 2): string =>
  `${n.toFixed(digits).replace(".", ",")}%`;

const fmtSignedPct = (n: number, digits = 2): string => {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits).replace(".", ",")} пп`;
};

// Render the BG date "27 октомври 2024" from a YYYY_MM_DD election folder name.
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

export const formatElectionDateBg = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  const year = m[1];
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return `${day} ${BG_MONTHS[month - 1]} ${year}`;
};

export const formatElectionDateEn = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  const year = m[1];
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return `${day} ${EN_MONTHS[month - 1]} ${year}`;
};

const fmtIntEn = (n: number): string => Math.round(n).toLocaleString("en-US");

const fmtPctEn = (n: number, digits = 2): string => `${n.toFixed(digits)}%`;

const fmtSignedPctEn = (n: number, digits = 2): string => {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} pp`;
};

// ------------------------------------------------------------------
// Tiny markdown → HTML converter for the AI-generated party/poll text.
// Supports only the subset that those payloads actually use:
//   ## headings, paragraphs, "- " bullet lists, **bold**.
// Tags are escaped so untrusted input cannot break out.
// ------------------------------------------------------------------
const inlineMd = (line: string): string => {
  // Bold first, then the surrounding text is escaped.
  // Strategy: split on **...**, escape each segment, re-wrap bold ones.
  const parts: string[] = [];
  let i = 0;
  const re = /\*\*([^*]+)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > i) parts.push(escapeHtml(line.slice(i, match.index)));
    parts.push(`<strong>${escapeHtml(match[1])}</strong>`);
    i = match.index + match[0].length;
  }
  if (i < line.length) parts.push(escapeHtml(line.slice(i)));
  return parts.join("");
};

export const markdownToHtml = (md: string): string => {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let listOpen = false;
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${paraBuf.map(inlineMd).join(" ")}</p>`);
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(h[1].length + 1, 6); // ## → h3 so h1 stays the page heading
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    paraBuf.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
};

// ------------------------------------------------------------------
// Articles strip — homepage links into the long-form analysis pieces.
// Lives in /public/articles/index.json (checked into the repo, not GCS).
// ------------------------------------------------------------------

type ArticleIndexEntry = {
  slug: string;
  publishedAt: string;
  title: { bg: string; en: string };
  summary: { bg: string; en: string };
};

const HOME_ARTICLE_LIMIT = 6;

export const buildArticlesSection = (
  publicAssetsFolder: string,
  lang: "bg" | "en",
): string => {
  const file = path.join(publicAssetsFolder, "articles", "index.json");
  if (!fs.existsSync(file)) return "";
  let list: ArticleIndexEntry[];
  try {
    list = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return "";
  }
  if (!Array.isArray(list) || !list.length) return "";
  const sorted = [...list]
    .filter((a) => a?.slug && a?.title?.[lang])
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""))
    .slice(0, HOME_ARTICLE_LIMIT);
  if (!sorted.length) return "";
  const heading = lang === "en" ? "Recent analysis" : "Последни анализи";
  const prefix = lang === "en" ? "/en" : "";
  const parts: string[] = [];
  parts.push(`<h2>${heading}</h2>`);
  parts.push("<ul>");
  for (const a of sorted) {
    const title = escapeHtml(a.title[lang]);
    const summary = a.summary?.[lang]
      ? ` — ${escapeHtml(a.summary[lang])}`
      : "";
    parts.push(
      `<li><a href="${SITE_URL}${prefix}/articles/${a.slug}">${title}</a>${summary}</li>`,
    );
  }
  parts.push("</ul>");
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Home page body — national summary table.
// ------------------------------------------------------------------

type TopLocation = {
  ekatte: string;
  name: string;
  name_en?: string;
  sections: number;
  voters?: number;
  urlPath?: string;
};

type NationalSummary = {
  election: string;
  priorElection?: string;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
    priorPct?: number;
    deltaPct?: number;
  };
  topGainer?: { nickName: string; deltaPct: number };
  topLoser?: { nickName: string; deltaPct: number };
  paperMachine?: { paperPct: number; machinePct: number };
  anomalies?: { total: number };
  parties: Array<{
    partyNum: number;
    nickName: string;
    name?: string;
    totalVotes: number;
    pct: number;
    priorPct?: number;
    deltaPct?: number;
    seats?: number;
    passedThreshold?: boolean;
  }>;
  topDiaspora?: TopLocation[];
  topCities?: TopLocation[];
};

// Top diaspora + city lists are precomputed in national_summary.json by
// scripts/reports/nationalSummary.ts. The dashboard tile and the prerendered
// home body both read them from there — single source of truth, consistent
// sort and Sofia-aggregation behavior.

export const buildHomeBody = (publicFolder: string, latest: string): string => {
  const file = path.join(publicFolder, latest, "national_summary.json");
  if (!fs.existsSync(file)) return "";
  const s: NationalSummary = JSON.parse(fs.readFileSync(file, "utf-8"));
  const dateLabel = formatElectionDateBg(latest);
  const parts: string[] = [];
  parts.push(
    `<h1>Парламентарни избори в България — последен вот: ${escapeHtml(dateLabel)}</h1>`,
  );
  parts.push(
    `<p>Избирателна активност: <strong>${fmtPct(s.turnout.pct)}</strong> (${fmtInt(s.turnout.actual)} от ${fmtInt(s.turnout.registered)} регистрирани).</p>`,
  );
  if (s.topGainer && s.topLoser) {
    parts.push(
      `<p>Най-голям ръст: <a href="${SITE_URL}/party/${encodeURIComponent(s.topGainer.nickName)}">${escapeHtml(s.topGainer.nickName)}</a> (${fmtSignedPct(s.topGainer.deltaPct)}). Най-голям спад: <a href="${SITE_URL}/party/${encodeURIComponent(s.topLoser.nickName)}">${escapeHtml(s.topLoser.nickName)}</a> (${fmtSignedPct(s.topLoser.deltaPct)}).</p>`,
    );
  }
  if (s.paperMachine) {
    parts.push(
      `<p>Хартия / машинно: ${fmtPct(s.paperMachine.paperPct)} / ${fmtPct(s.paperMachine.machinePct)}.</p>`,
    );
  }
  parts.push(`<h2>Партии и резултати</h2>`);
  parts.push(
    `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th><th>Δ</th><th>Мандати</th></tr></thead><tbody>`,
  );
  for (const p of s.parties) {
    const linkable = p.passedThreshold !== false;
    const partyCell = linkable
      ? `<a href="${SITE_URL}/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a>`
      : escapeHtml(p.nickName);
    parts.push(
      `<tr><td>${partyCell}</td><td>${fmtInt(p.totalVotes)}</td><td>${fmtPct(p.pct)}</td><td>${p.deltaPct != null ? fmtSignedPct(p.deltaPct) : ""}</td><td>${p.seats ?? ""}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  if (s.anomalies) {
    parts.push(
      `<p>Засечени отклонения по секции: <strong>${fmtInt(s.anomalies.total)}</strong>. Виж <a href="${SITE_URL}/reports/section/problem_sections">проблемни секции</a>.</p>`,
    );
  }
  const renderLoc = (l: TopLocation) =>
    `<a href="${SITE_URL}${l.urlPath ?? `/sections/${l.ekatte}`}">${escapeHtml(l.name)}</a> (${fmtInt(l.voters ?? 0)} избиратели)`;
  if (s.topDiaspora && s.topDiaspora.length) {
    parts.push(`<h2>Гласуване в чужбина</h2>`);
    parts.push(`<p>${s.topDiaspora.map(renderLoc).join(" · ")}</p>`);
  }
  if (s.topCities && s.topCities.length) {
    parts.push(`<h2>Най-големи населени места</h2>`);
    parts.push(`<p>${s.topCities.map(renderLoc).join(" · ")}</p>`);
  }
  return parts.join("\n");
};

export const buildHomeBodyEn = (
  publicFolder: string,
  latest: string,
): string => {
  const file = path.join(publicFolder, latest, "national_summary.json");
  if (!fs.existsSync(file)) return "";
  const s: NationalSummary = JSON.parse(fs.readFileSync(file, "utf-8"));
  const dateLabel = formatElectionDateEn(latest);
  const parts: string[] = [];
  parts.push(
    `<h1>Bulgarian parliamentary elections — latest vote: ${escapeHtml(dateLabel)}</h1>`,
  );
  parts.push(
    `<p>Turnout: <strong>${fmtPctEn(s.turnout.pct)}</strong> (${fmtIntEn(s.turnout.actual)} of ${fmtIntEn(s.turnout.registered)} registered voters).</p>`,
  );
  if (s.topGainer && s.topLoser) {
    parts.push(
      `<p>Biggest gain: <a href="${SITE_URL}/en/party/${encodeURIComponent(s.topGainer.nickName)}">${escapeHtml(s.topGainer.nickName)}</a> (${fmtSignedPctEn(s.topGainer.deltaPct)}). Biggest loss: <a href="${SITE_URL}/en/party/${encodeURIComponent(s.topLoser.nickName)}">${escapeHtml(s.topLoser.nickName)}</a> (${fmtSignedPctEn(s.topLoser.deltaPct)}).</p>`,
    );
  }
  if (s.paperMachine) {
    parts.push(
      `<p>Paper / machine vote: ${fmtPctEn(s.paperMachine.paperPct)} / ${fmtPctEn(s.paperMachine.machinePct)}.</p>`,
    );
  }
  parts.push(`<h2>Parties and results</h2>`);
  parts.push(
    `<table><thead><tr><th>Party</th><th>Votes</th><th>%</th><th>Δ</th><th>Seats</th></tr></thead><tbody>`,
  );
  for (const p of s.parties) {
    const linkable = p.passedThreshold !== false;
    const partyCell = linkable
      ? `<a href="${SITE_URL}/en/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a>`
      : escapeHtml(p.nickName);
    parts.push(
      `<tr><td>${partyCell}</td><td>${fmtIntEn(p.totalVotes)}</td><td>${fmtPctEn(p.pct)}</td><td>${p.deltaPct != null ? fmtSignedPctEn(p.deltaPct) : ""}</td><td>${p.seats ?? ""}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  if (s.anomalies) {
    parts.push(
      `<p>Section-level anomalies detected: <strong>${fmtIntEn(s.anomalies.total)}</strong>. See <a href="${SITE_URL}/en/reports/section/problem_sections">problem sections</a>.</p>`,
    );
  }
  const renderLocEn = (l: TopLocation) =>
    `<a href="${SITE_URL}/en${l.urlPath ?? `/sections/${l.ekatte}`}">${escapeHtml(l.name_en ?? l.name)}</a> (${fmtIntEn(l.voters ?? 0)} voters)`;
  if (s.topDiaspora && s.topDiaspora.length) {
    parts.push(`<h2>Voting abroad</h2>`);
    parts.push(`<p>${s.topDiaspora.map(renderLocEn).join(" · ")}</p>`);
  }
  if (s.topCities && s.topCities.length) {
    parts.push(`<h2>Largest cities</h2>`);
    parts.push(`<p>${s.topCities.map(renderLocEn).join(" · ")}</p>`);
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Party page body — assessment narrative + headline numbers.
// ------------------------------------------------------------------

type PartyAssessment = {
  partyNum: number;
  nickName: string;
  bg?: string;
  en?: string;
};

export const buildPartyBody = (
  publicFolder: string,
  latest: string,
  party: PartyInfo,
  summary: NationalSummary | null,
): string => {
  const assessmentFile = path.join(
    publicFolder,
    latest,
    "parties",
    "assessment",
    `${party.number}.json`,
  );
  const label =
    party.name && party.name !== party.nickName
      ? `${party.name} (${party.nickName})`
      : party.nickName;
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(label)}</h1>`);

  const summaryRow = summary?.parties.find((p) => p.partyNum === party.number);
  if (summaryRow) {
    const seats =
      summaryRow.seats != null ? `, ${summaryRow.seats} мандата` : "";
    const delta =
      summaryRow.deltaPct != null
        ? ` (${fmtSignedPct(summaryRow.deltaPct)} спрямо предишния вот)`
        : "";
    parts.push(
      `<p><strong>${fmtInt(summaryRow.totalVotes)}</strong> гласа · <strong>${fmtPct(summaryRow.pct)}</strong>${seats}${delta} на парламентарния вот ${escapeHtml(formatElectionDateBg(latest))}.</p>`,
    );
  }

  if (fs.existsSync(assessmentFile)) {
    try {
      const a: PartyAssessment = JSON.parse(
        fs.readFileSync(assessmentFile, "utf-8"),
      );
      if (a.bg) parts.push(markdownToHtml(a.bg));
    } catch {
      // ignore malformed assessment
    }
  }

  parts.push(
    `<p>Виж резултатите на ${escapeHtml(party.nickName)} <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/regions">по области</a>, <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/municipalities">общини</a>, <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/settlements">населени места</a>, <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/preferences">преференции</a>, и <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/donors">дарители</a>.</p>`,
  );
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Polls landing page + per-agency body.
// ------------------------------------------------------------------

type PollAgency = {
  id: string;
  name_bg: string;
  name_en: string;
  abbr_bg?: string;
  website?: string | null;
};

type PollAnalysisAgency = {
  agencyId: string;
  summary?: { bg?: string; en?: string };
  lean?: { bg?: string; en?: string };
  warning?: { bg?: string; en?: string };
};

export const buildPollsBody = (publicFolder: string): string => {
  const agenciesFile = path.join(publicFolder, "polls", "agencies.json");
  const analysisFile = path.join(publicFolder, "polls", "analysis.json");
  if (!fs.existsSync(agenciesFile)) return "";
  const agencies: PollAgency[] = JSON.parse(
    fs.readFileSync(agenciesFile, "utf-8"),
  );
  let analysis: { agencyTakes?: PollAnalysisAgency[] } = {};
  if (fs.existsSync(analysisFile)) {
    analysis = JSON.parse(fs.readFileSync(analysisFile, "utf-8"));
  }
  const takesById = new Map<string, PollAnalysisAgency>(
    (analysis.agencyTakes ?? []).map((a) => [a.agencyId, a]),
  );
  const parts: string[] = [];
  parts.push(`<h1>Социологически проучвания преди парламентарни избори</h1>`);
  parts.push(
    `<p>Точност на агенциите по предишни вотове, профил на отклоненията и предупреждения. Източник на проучванията: българска Уикипедия и сайтовете на агенциите.</p>`,
  );
  parts.push(`<h2>Агенции</h2>`);
  parts.push(
    `<table><thead><tr><th>Агенция</th><th>Кратко резюме</th></tr></thead><tbody>`,
  );
  for (const a of agencies) {
    const take = takesById.get(a.id);
    const summary = take?.summary?.bg ?? "";
    const link = `<a href="${SITE_URL}/polls/${encodeURIComponent(a.id)}">${escapeHtml(a.name_bg)}</a>`;
    parts.push(
      `<tr><td>${link}</td><td>${escapeHtml(summary.split(/[.!?]/)[0] || "")}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  return parts.join("\n");
};

export const buildPollsAgencyBody = (
  publicFolder: string,
  agency: PollAgency,
): string => {
  const analysisFile = path.join(publicFolder, "polls", "analysis.json");
  if (!fs.existsSync(analysisFile)) return "";
  const analysis: { agencyTakes?: PollAnalysisAgency[] } = JSON.parse(
    fs.readFileSync(analysisFile, "utf-8"),
  );
  const take = (analysis.agencyTakes ?? []).find(
    (a) => a.agencyId === agency.id,
  );
  const parts: string[] = [];
  parts.push(
    `<h1>${escapeHtml(agency.name_bg)} — точност на проучванията</h1>`,
  );
  if (agency.website) {
    parts.push(
      `<p>Сайт: <a href="${escapeAttr(agency.website)}" rel="nofollow noopener">${escapeHtml(agency.website)}</a></p>`,
    );
  }
  if (!take) return parts.join("\n");
  if (take.summary?.bg) {
    parts.push(`<h2>Резюме</h2>`);
    parts.push(`<p>${escapeHtml(take.summary.bg)}</p>`);
  }
  if (take.lean?.bg) {
    parts.push(`<h2>Профил на отклоненията</h2>`);
    parts.push(`<p>${escapeHtml(take.lean.bg)}</p>`);
  }
  if (take.warning?.bg) {
    parts.push(`<h2>Предупреждение</h2>`);
    parts.push(`<p>${escapeHtml(take.warning.bg)}</p>`);
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Per-election landing page body (/elections/{date}).
// ------------------------------------------------------------------

export const buildElectionLandingBody = (
  publicFolder: string,
  electionDate: string,
): string => {
  const file = path.join(publicFolder, electionDate, "national_summary.json");
  const dateLabel = formatElectionDateBg(electionDate);
  if (!fs.existsSync(file)) {
    // No summary on disk yet — emit a minimal heading so crawlers still see
    // a page, not an empty body.
    return `<h1>Парламентарни избори ${escapeHtml(dateLabel)}</h1>`;
  }
  const s: NationalSummary = JSON.parse(fs.readFileSync(file, "utf-8"));
  const parts: string[] = [];
  parts.push(
    `<h1>Парламентарни избори ${escapeHtml(dateLabel)} в България</h1>`,
  );
  parts.push(
    `<p>Избирателна активност: <strong>${fmtPct(s.turnout.pct)}</strong> (${fmtInt(s.turnout.actual)} от ${fmtInt(s.turnout.registered)} регистрирани).</p>`,
  );
  if (s.topGainer && s.topLoser) {
    parts.push(
      `<p>Най-голям ръст: <a href="${SITE_URL}/party/${encodeURIComponent(s.topGainer.nickName)}">${escapeHtml(s.topGainer.nickName)}</a> (${fmtSignedPct(s.topGainer.deltaPct)}). Най-голям спад: <a href="${SITE_URL}/party/${encodeURIComponent(s.topLoser.nickName)}">${escapeHtml(s.topLoser.nickName)}</a> (${fmtSignedPct(s.topLoser.deltaPct)}).</p>`,
    );
  }
  if (s.paperMachine) {
    parts.push(
      `<p>Хартия / машинно: ${fmtPct(s.paperMachine.paperPct)} / ${fmtPct(s.paperMachine.machinePct)}.</p>`,
    );
  }
  parts.push(`<h2>Партии и резултати</h2>`);
  parts.push(
    `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th><th>Δ</th><th>Мандати</th></tr></thead><tbody>`,
  );
  for (const p of s.parties) {
    const linkable = p.passedThreshold !== false;
    const partyCell = linkable
      ? `<a href="${SITE_URL}/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a>`
      : escapeHtml(p.nickName);
    parts.push(
      `<tr><td>${partyCell}</td><td>${fmtInt(p.totalVotes)}</td><td>${fmtPct(p.pct)}</td><td>${p.deltaPct != null ? fmtSignedPct(p.deltaPct) : ""}</td><td>${p.seats ?? ""}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  if (s.anomalies) {
    parts.push(
      `<p>Засечени отклонения по секции: <strong>${fmtInt(s.anomalies.total)}</strong>.</p>`,
    );
  }
  return parts.join("\n");
};

export const buildElectionLandingBodyEn = (
  publicFolder: string,
  electionDate: string,
): string => {
  const file = path.join(publicFolder, electionDate, "national_summary.json");
  const dateLabel = formatElectionDateEn(electionDate);
  if (!fs.existsSync(file)) {
    return `<h1>Bulgarian parliamentary elections — ${escapeHtml(dateLabel)}</h1>`;
  }
  const s: NationalSummary = JSON.parse(fs.readFileSync(file, "utf-8"));
  const parts: string[] = [];
  parts.push(
    `<h1>Bulgarian parliamentary elections — ${escapeHtml(dateLabel)}</h1>`,
  );
  parts.push(
    `<p>Turnout: <strong>${fmtPctEn(s.turnout.pct)}</strong> (${fmtIntEn(s.turnout.actual)} of ${fmtIntEn(s.turnout.registered)} registered).</p>`,
  );
  if (s.topGainer && s.topLoser) {
    parts.push(
      `<p>Biggest gain: <a href="${SITE_URL}/en/party/${encodeURIComponent(s.topGainer.nickName)}">${escapeHtml(s.topGainer.nickName)}</a> (${fmtSignedPctEn(s.topGainer.deltaPct)}). Biggest loss: <a href="${SITE_URL}/en/party/${encodeURIComponent(s.topLoser.nickName)}">${escapeHtml(s.topLoser.nickName)}</a> (${fmtSignedPctEn(s.topLoser.deltaPct)}).</p>`,
    );
  }
  if (s.paperMachine) {
    parts.push(
      `<p>Paper / machine vote: ${fmtPctEn(s.paperMachine.paperPct)} / ${fmtPctEn(s.paperMachine.machinePct)}.</p>`,
    );
  }
  parts.push(`<h2>Parties and results</h2>`);
  parts.push(
    `<table><thead><tr><th>Party</th><th>Votes</th><th>%</th><th>Δ</th><th>Seats</th></tr></thead><tbody>`,
  );
  for (const p of s.parties) {
    const linkable = p.passedThreshold !== false;
    const partyCell = linkable
      ? `<a href="${SITE_URL}/en/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a>`
      : escapeHtml(p.nickName);
    parts.push(
      `<tr><td>${partyCell}</td><td>${fmtIntEn(p.totalVotes)}</td><td>${fmtPctEn(p.pct)}</td><td>${p.deltaPct != null ? fmtSignedPctEn(p.deltaPct) : ""}</td><td>${p.seats ?? ""}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  if (s.anomalies) {
    parts.push(
      `<p>Section-level anomalies detected: <strong>${fmtIntEn(s.anomalies.total)}</strong>.</p>`,
    );
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Section page body — protocol numbers + party table.
// ------------------------------------------------------------------

type SectionBodyInput = {
  section: string;
  settlement: string;
  oblastName?: string;
  address?: string;
  numMachines?: number;
  ekatte?: string;
  oblastCode?: string;
  protocol?: {
    numRegisteredVoters?: number;
    totalActualVoters?: number;
    numValidVotes?: number;
    numValidMachineVotes?: number;
    numInvalidBallotsFound?: number;
  };
  topVotes?: Array<{ partyNum: number; nickName: string; totalVotes: number }>;
  totalValidVotes?: number;
  settlementContext?: {
    settlementName: string;
    turnoutPct: number;
    winnerPartyNum: number;
    winnerNickName: string;
    winnerPct: number;
  };
  nationalPctByParty?: Map<number, number>;
  flaggedNeighborhood?: { name: string; city: string };
};

export const buildSectionBody = (input: SectionBodyInput): string => {
  const { section, settlement, oblastName, address, ekatte, oblastCode } =
    input;
  const placeLabel = oblastName
    ? `${settlement}, обл. ${oblastName}`
    : settlement;
  const parts: string[] = [];
  parts.push(`<h1>Избирателна секция №${escapeHtml(section)}</h1>`);
  parts.push(`<p>${escapeHtml(placeLabel)}.</p>`);
  if (address) {
    parts.push(`<p>Адрес: ${escapeHtml(address.replace(/\s+/g, " "))}</p>`);
  }
  const p = input.protocol;
  if (p) {
    const registered = p.numRegisteredVoters ?? 0;
    const actual = p.totalActualVoters ?? 0;
    const turnoutPct =
      registered > 0
        ? ((actual / registered) * 100).toFixed(2).replace(".", ",")
        : "";
    // Per the protocol layout in src/data/dataTypes.ts: numValidVotes is the
    // count of valid PAPER votes (line 9 of the СИК protocol) and
    // numValidMachineVotes is the count of valid MACHINE votes (line 14).
    const paper = p.numValidVotes ?? 0;
    const machine = p.numValidMachineVotes ?? 0;
    const valid = paper + machine;
    parts.push(`<h2>Протокол</h2>`);
    parts.push(
      `<ul><li>Регистрирани избиратели: ${fmtInt(registered)}</li><li>Гласували: ${fmtInt(actual)}${turnoutPct ? ` (${turnoutPct}%)` : ""}</li><li>Действителни гласове: ${fmtInt(valid)}</li><li>Хартия: ${fmtInt(paper)} · Машинно: ${fmtInt(machine)}</li>${
        p.numInvalidBallotsFound != null
          ? `<li>Недействителни бюлетини: ${fmtInt(p.numInvalidBallotsFound)}</li>`
          : ""
      }</ul>`,
    );
  }
  // Settlement-level turnout comparison: gives every section a unique sentence
  // about how it stacks up against its settlement average.
  if (input.settlementContext && input.protocol) {
    const reg = input.protocol.numRegisteredVoters ?? 0;
    const act = input.protocol.totalActualVoters ?? 0;
    if (reg > 0) {
      const sectionTurnout = (act / reg) * 100;
      const dPp = sectionTurnout - input.settlementContext.turnoutPct;
      const direction = dPp >= 0 ? "над" : "под";
      const abs = Math.abs(dPp).toFixed(2).replace(".", ",");
      parts.push(
        `<p>Активността е ${fmtPct(sectionTurnout)} — ${abs} пп ${direction} средната за ${escapeHtml(input.settlementContext.settlementName)} (${fmtPct(input.settlementContext.turnoutPct)}).</p>`,
      );
    }
  }
  const nat = input.nationalPctByParty;
  if (input.topVotes && input.topVotes.length > 0) {
    parts.push(`<h2>Топ партии в секцията</h2>`);
    const headDelta = nat ? `<th>vs нац.</th>` : "";
    parts.push(
      `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th>${headDelta}</tr></thead><tbody>`,
    );
    const total = input.totalValidVotes ?? 0;
    for (const v of input.topVotes) {
      const pct = total > 0 ? (v.totalVotes / total) * 100 : 0;
      const pctCell = total > 0 ? fmtPct(pct) : "";
      let deltaCell = "";
      if (nat) {
        const np = nat.get(v.partyNum);
        deltaCell = `<td>${np != null && total > 0 ? fmtSignedPct(pct - np) : ""}</td>`;
      }
      parts.push(
        `<tr><td><a href="${SITE_URL}/party/${encodeURIComponent(v.nickName)}">${escapeHtml(v.nickName)}</a></td><td>${fmtInt(v.totalVotes)}</td><td>${pctCell}</td>${deltaCell}</tr>`,
      );
    }
    parts.push(`</tbody></table>`);
    // Settlement-winner contrast — emit only when the section's leading party
    // differs from its settlement's leading party, so the line carries real
    // distinguishing signal.
    const sCtx = input.settlementContext;
    const top = input.topVotes[0];
    if (sCtx && top && top.partyNum !== sCtx.winnerPartyNum && total > 0) {
      const topPct = (top.totalVotes / total) * 100;
      parts.push(
        `<p>Водещата партия в секцията е <a href="${SITE_URL}/party/${encodeURIComponent(top.nickName)}">${escapeHtml(top.nickName)}</a> (${fmtPct(topPct)}); в ${escapeHtml(sCtx.settlementName)} първа е <a href="${SITE_URL}/party/${encodeURIComponent(sCtx.winnerNickName)}">${escapeHtml(sCtx.winnerNickName)}</a> (${fmtPct(sCtx.winnerPct)}).</p>`,
      );
    }
  }
  if (input.flaggedNeighborhood) {
    parts.push(
      `<p>Секцията попада в наблюдавания списък с потенциално проблемни секции — район <strong>${escapeHtml(input.flaggedNeighborhood.name)}</strong>, ${escapeHtml(input.flaggedNeighborhood.city)}. Виж <a href="${SITE_URL}/reports/section/problem_sections">проблемни секции</a>.</p>`,
    );
  }
  const navLinks: string[] = [];
  if (ekatte) {
    navLinks.push(
      `<a href="${SITE_URL}/settlement/${ekatte}">${escapeHtml(settlement)}</a>`,
    );
  }
  if (oblastCode && oblastName) {
    navLinks.push(
      `<a href="${SITE_URL}/municipality/${oblastCode}">обл. ${escapeHtml(oblastName)}</a>`,
    );
  }
  if (navLinks.length) {
    parts.push(`<p>Навигация: ${navLinks.join(" · ")}</p>`);
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Sections-list page body — /sections/{ekatte}.
// Two flavors: Bulgarian settlements (address list, top parties) and
// diaspora country pages (cities + FAQ-style voting facts).
// ------------------------------------------------------------------

type SectionListItem = {
  section: string;
  address?: string;
  cityLabel?: string; // for diaspora: city after stripping country prefix
};

type SectionsListInput = {
  ekatte: string;
  displayName: string; // "гр.Бургас" or "Италия"
  oblastName?: string;
  oblastCode?: string;
  isDiaspora: boolean;
  electionDateLabel: string;
  sections: SectionListItem[];
  aggregate?: {
    registered: number;
    actual: number;
    turnoutPct: number;
    topParties: Array<{ nickName: string; pct: number; totalVotes: number }>;
  };
};

export const buildSectionsListBody = (input: SectionsListInput): string => {
  const parts: string[] = [];
  const placeLabel =
    input.isDiaspora || !input.oblastName
      ? input.displayName
      : `${input.displayName}, обл. ${input.oblastName}`;
  const heading = input.isDiaspora
    ? `Избирателни секции в ${input.displayName} — Парламентарни избори в България`
    : `Избирателни секции в ${placeLabel}`;
  parts.push(`<h1>${escapeHtml(heading)}</h1>`);
  parts.push(
    `<p>Списък на избирателните секции и адресите им за парламентарния вот ${escapeHtml(input.electionDateLabel)} — общо ${fmtInt(input.sections.length)} ${input.sections.length === 1 ? "секция" : "секции"}${input.isDiaspora ? "" : `, ${escapeHtml(placeLabel)}`}.</p>`,
  );
  if (input.aggregate) {
    // Foreign sections register voters at the booth, so numRegisteredVoters
    // is unreliable (often 0) — show the turnout line only when the ratio
    // looks sane. Otherwise just emit the actual-voter count.
    const a = input.aggregate;
    const showTurnout =
      !input.isDiaspora &&
      a.registered > 0 &&
      a.turnoutPct > 0 &&
      a.turnoutPct <= 100;
    if (showTurnout) {
      parts.push(
        `<p>Регистрирани избиратели: <strong>${fmtInt(a.registered)}</strong> · Гласували: <strong>${fmtInt(a.actual)}</strong> (${fmtPct(a.turnoutPct)}).</p>`,
      );
    } else if (a.actual > 0) {
      parts.push(`<p>Гласували: <strong>${fmtInt(a.actual)}</strong>.</p>`);
    }
  }
  if (input.aggregate && input.aggregate.topParties.length) {
    parts.push(`<h2>Водещи партии</h2>`);
    parts.push(
      `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th></tr></thead><tbody>`,
    );
    for (const p of input.aggregate.topParties) {
      parts.push(
        `<tr><td><a href="${SITE_URL}/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a></td><td>${fmtInt(p.totalVotes)}</td><td>${fmtPct(p.pct)}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  if (input.isDiaspora) {
    // Aggregate sections per city for the diaspora summary.
    const byCity = new Map<string, number>();
    for (const s of input.sections) {
      const city = s.cityLabel?.trim() || "—";
      byCity.set(city, (byCity.get(city) ?? 0) + 1);
    }
    if (byCity.size > 0) {
      parts.push(`<h2>Градове със секции</h2>`);
      parts.push(
        `<table><thead><tr><th>Град</th><th>Секции</th></tr></thead><tbody>`,
      );
      const sortedCities = [...byCity.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "bg"),
      );
      for (const [city, count] of sortedCities) {
        parts.push(
          `<tr><td>${escapeHtml(city)}</td><td>${fmtInt(count)}</td></tr>`,
        );
      }
      parts.push(`</tbody></table>`);
    }
  }

  if (input.sections.length) {
    parts.push(`<h2>Адреси на секциите</h2>`);
    parts.push(
      `<table><thead><tr><th>Секция</th><th>Адрес</th></tr></thead><tbody>`,
    );
    // Cap to 200 to keep Sofia-subdivision pages from blowing up; the
    // dynamic SPA still shows the full list.
    const capped = input.sections.slice(0, 200);
    for (const s of capped) {
      const addr = s.address ? s.address.replace(/\s+/g, " ") : "";
      const city = input.isDiaspora && s.cityLabel ? `${s.cityLabel} — ` : "";
      parts.push(
        `<tr><td><a href="${SITE_URL}/section/${s.section}">№${escapeHtml(s.section)}</a></td><td>${escapeHtml(city + addr)}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
    if (input.sections.length > capped.length) {
      parts.push(
        `<p>Показани са първите ${fmtInt(capped.length)} от ${fmtInt(input.sections.length)} секции.</p>`,
      );
    }
  }

  if (input.isDiaspora) {
    parts.push(`<h2>Често задавани въпроси</h2>`);
    parts.push(
      `<p><strong>Кой може да гласува в чужбина?</strong> Български граждани с навършени 18 години към изборния ден, без значение от постоянния им адрес, могат да гласуват в избирателните секции в чужбина.</p>`,
    );
    parts.push(
      `<p><strong>Какви документи са необходими?</strong> Валидна българска лична карта или паспорт. Не се изисква предварителна регистрация в деня на изборите за вече разкритите секции.</p>`,
    );
    parts.push(
      `<p><strong>Кога работят секциите?</strong> Секциите в чужбина обикновено отварят в 7:00 и затварят в 20:00 по местно време; ако в 20:00 пред секцията има чакащи избиратели, те имат право да гласуват.</p>`,
    );
    parts.push(
      `<p><strong>Как се откриват нови секции?</strong> Български граждани могат да подадат заявления за разкриване на секция в населено място в чужбина чрез <a href="https://www.mfa.bg/" rel="nofollow noopener">МВнР</a> в срокове, обявени от ЦИК преди всеки вот.</p>`,
    );
  }

  if (input.oblastCode && input.oblastName && !input.isDiaspora) {
    parts.push(
      `<p>Виж и: <a href="${SITE_URL}/settlement/${input.ekatte}">${escapeHtml(input.displayName)}</a> · <a href="${SITE_URL}/municipality/${input.oblastCode}">обл. ${escapeHtml(input.oblastName)}</a>.</p>`,
    );
  }

  return parts.join("\n");
};

// ------------------------------------------------------------------
// Settlement page body — ekatte-level summary.
// ------------------------------------------------------------------

type SettlementBodyInput = {
  ekatte: string;
  settlement: string;
  oblastName?: string;
  oblastCode?: string;
};

export const buildSettlementBody = (input: SettlementBodyInput): string => {
  const { ekatte, settlement, oblastName, oblastCode } = input;
  const placeLabel = oblastName
    ? `${settlement}, обл. ${oblastName}`
    : settlement;
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(placeLabel)}</h1>`);
  parts.push(
    `<p>Резултати на парламентарните избори в България в ${escapeHtml(placeLabel)} — гласуване по партии, преференции, машинно и хартиено гласуване, отклонения по секции.</p>`,
  );
  // Note: buildGovernancePlaceBody (below) targets the same EKATTE from a
  // different angle — see comments there for the framing split between the
  // /settlement (election-by-section) and /governance (place-governance) pages.
  const navLinks: string[] = [
    `<a href="${SITE_URL}/sections/${ekatte}">Секции в ${escapeHtml(settlement)}</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/parties">Партии</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/preferences">Преференции</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/recount">Повторно преброяване</a>`,
  ];
  if (oblastCode && oblastName) {
    navLinks.unshift(
      `<a href="${SITE_URL}/municipality/${oblastCode}">обл. ${escapeHtml(oblastName)}</a>`,
    );
  }
  parts.push(`<p>${navLinks.join(" · ")}</p>`);
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Governance — place node of the Governance view.
//
// The Governance view is a place ladder: country (/governance) → region
// (/governance/region/{oblast}) → município/settlement (/governance/{id}).
// These three builders emit the indexable HTML for the region and place
// nodes. The framing is "everything about how this place is governed"
// (representation, mayor & council, money, services) rather than the
// election-by-section framing of /settlement and /municipality — two doors
// into the same data, so crawlers see distinct titles and can rank each on
// its own intent.
// ------------------------------------------------------------------

// Settlement-grain place node — /governance/{ekatte}.
export const buildGovernancePlaceBody = (
  input: SettlementBodyInput,
): string => {
  const { ekatte, settlement, oblastName, oblastCode } = input;
  const placeLabel = oblastName
    ? `${settlement}, обл. ${oblastName}`
    : settlement;
  const parts: string[] = [];
  parts.push(`<h1>Управление — ${escapeHtml(placeLabel)}</h1>`);
  parts.push(
    `<p>Обобщено табло за управлението на ${escapeHtml(placeLabel)}: народни представители за многомандатния избирателен район, кмет и общински съвет, общинско финансиране (Чл. 53), капиталови програми, проекти финансирани от еврофондовете, обществени поръчки, преброяване 2021 и регистрирано население по ГРАО.</p>`,
  );
  const navLinks: string[] = [
    `<a href="${SITE_URL}/governance">Управление (страна)</a>`,
  ];
  if (oblastCode && oblastName) {
    navLinks.push(
      `<a href="${SITE_URL}/governance/region/${oblastCode}">Управление — обл. ${escapeHtml(oblastName)}</a>`,
    );
  }
  navLinks.push(
    `<a href="${SITE_URL}/sections/${ekatte}">Секции и резултати в ${escapeHtml(settlement)}</a>`,
    `<a href="${SITE_URL}/settlement/${ekatte}">Резултати по партии</a>`,
  );
  parts.push(`<p>${navLinks.join(" · ")}</p>`);
  return parts.join("\n");
};

// Município-grain place node — /governance/{obshtina}.
export type GovernanceMuniInput = {
  name: string;
  oblastCode?: string;
  oblastName?: string;
};

export const buildGovernanceMuniBody = (input: GovernanceMuniInput): string => {
  const { name, oblastCode, oblastName } = input;
  const parts: string[] = [];
  parts.push(`<h1>Управление — община ${escapeHtml(name)}</h1>`);
  parts.push(
    `<p>Обобщено табло за управлението на община ${escapeHtml(name)}: народни представители и техните декларации, кмет и общински съвет, общинско финансиране (Чл. 53 от ЗДБ), капиталова програма, проекти по еврофондовете, обществени поръчки, местни данъци, преброяване 2021, прозрачност (LISI) и качество на средата — престъпност, въздух и училища.</p>`,
  );
  const navLinks: string[] = [
    `<a href="${SITE_URL}/governance">Управление (страна)</a>`,
  ];
  if (oblastCode && oblastName) {
    navLinks.push(
      `<a href="${SITE_URL}/governance/region/${oblastCode}">Управление — обл. ${escapeHtml(oblastName)}</a>`,
      `<a href="${SITE_URL}/municipality/${oblastCode}">Резултати в обл. ${escapeHtml(oblastName)}</a>`,
    );
  }
  parts.push(`<p>${navLinks.join(" · ")}</p>`);
  return parts.join("\n");
};

// Region (oblast) node — /governance/region/{oblast}. Lists the oblast's
// municipalities, each linking to its place node, so crawlers get a real
// internal path country → region → município → settlement.
export type GovernanceRegionMuni = {
  obshtina: string;
  name: string;
  name_en?: string;
};

// Region (oblast) node body. The EN variant only /en-prefixes links whose
// target actually has an EN mirror — i.e. the country node (/en/governance).
// The oblast election-results page and the município/settlement place pages
// are BG-only, so EN links to them point at their BG canonical URLs (linking
// /en/… there would fall through the SPA rewrite to the homepage).
export const buildGovernanceRegionBody = (
  region: RegionInfo,
  munis: GovernanceRegionMuni[],
  lang: "bg" | "en" = "bg",
): string => {
  const en = lang === "en";
  const displayName = en
    ? region.long_name_en || region.name_en || region.name
    : region.long_name || region.name;
  const parts: string[] = [];
  if (en) {
    parts.push(`<h1>Governance — ${escapeHtml(displayName)} province</h1>`);
    parts.push(
      `<p>A regional cut of governance for ${escapeHtml(displayName)} province: the area's MPs and their asset declarations, the per-municipality transfer envelope (Article 53 of the State Budget Law), regional indicators (registered unemployment, matura scores), the 2021 census and land-use composition. A province has no elected council — local self-government is shown at the municipality level below.</p>`,
    );
    parts.push(
      `<p><a href="${SITE_URL}/en/governance">Governance (country)</a> · <a href="${SITE_URL}/municipality/${region.oblast}">Election results in ${escapeHtml(displayName)}</a></p>`,
    );
  } else {
    parts.push(`<h1>Управление — област ${escapeHtml(displayName)}</h1>`);
    parts.push(
      `<p>Регионален разрез на управлението за област ${escapeHtml(displayName)}: народни представители от областта и техните имуществени декларации, разпределение на средства по места (Чл. 53 от ЗДБ), регионални индикатори (регистрирана безработица, матури), преброяване 2021 и поземлено покритие. Областта няма избран съвет — местното самоуправление се вижда на ниво община по-долу.</p>`,
    );
    parts.push(
      `<p><a href="${SITE_URL}/governance">Управление (страна)</a> · <a href="${SITE_URL}/municipality/${region.oblast}">Резултати в обл. ${escapeHtml(displayName)}</a></p>`,
    );
  }
  if (munis.length) {
    const muniLabel = (m: GovernanceRegionMuni) =>
      en ? m.name_en || m.name : m.name;
    parts.push(
      en
        ? `<h2>Municipalities in ${escapeHtml(displayName)} province</h2>`
        : `<h2>Общини в област ${escapeHtml(displayName)}</h2>`,
    );
    const sorted = [...munis].sort((a, b) =>
      muniLabel(a).localeCompare(muniLabel(b), en ? "en" : "bg"),
    );
    parts.push(
      `<ul>${sorted
        .map(
          (m) =>
            `<li><a href="${SITE_URL}/governance/${m.obshtina}">${
              en
                ? `${escapeHtml(muniLabel(m))} municipality`
                : `община ${escapeHtml(muniLabel(m))}`
            }</a></li>`,
        )
        .join("")}</ul>`,
    );
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Oblast page body — region overview.
// ------------------------------------------------------------------

export const buildOblastBody = (region: RegionInfo): string => {
  const displayName = region.long_name || region.name;
  const parts: string[] = [];
  parts.push(`<h1>Резултати в област ${escapeHtml(displayName)}</h1>`);
  parts.push(
    `<p>Подробни резултати от парламентарните избори в България в област ${escapeHtml(displayName)} — гласуване по партии, преференции, машинно и хартиено гласуване, повторно преброяване и отклонения по секции.</p>`,
  );
  const code = region.oblast;
  parts.push(
    `<p><a href="${SITE_URL}/municipality/${code}/parties">Партии</a> · <a href="${SITE_URL}/municipality/${code}/preferences">Преференции</a> · <a href="${SITE_URL}/municipality/${code}/municipalities">Общини</a> · <a href="${SITE_URL}/municipality/${code}/recount">Повторно преброяване</a></p>`,
  );
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Diaspora ("voting abroad") landing body — /municipality/32.
// МИР 32 is the abroad electoral district; the generic oblast prerender
// excludes it (no municipalities/census/local-government make sense), so
// it had NO crawlable HTML at all. This body targets the verified-demand
// "секции за гласуване в чужбина" / "избирателни секции в <държава>"
// cluster: a country list linking each /sections/<code> page, plus the
// shared voting-abroad FAQ (also emitted as FAQPage JSON-LD).
// ------------------------------------------------------------------

export type DiasporaCountry = {
  code: string; // 2-letter country code → /sections/<code>
  name: string;
  name_en?: string;
  sections: number;
  voters?: number;
  winnerNickName?: string;
};

export const buildDiasporaBody = (
  lang: "bg" | "en",
  countries: DiasporaCountry[],
  electionDateLabel: string,
): string => {
  const en = lang === "en";
  const base = en ? `${SITE_URL}/en` : SITE_URL;
  const parts: string[] = [];
  parts.push(
    en
      ? `<h1>Voting abroad — Bulgarian polling sections by country</h1>`
      : `<h1>Гласуване в чужбина — избирателни секции по държави</h1>`,
  );
  parts.push(
    en
      ? `<p>Where Bulgarian citizens abroad voted in the ${escapeHtml(electionDateLabel)} parliamentary election — polling sections, addresses, turnout and party results by country. Pick a country to see every section and its address.</p>`
      : `<p>Къде гласуваха българските граждани в чужбина на парламентарния вот ${escapeHtml(electionDateLabel)} — избирателни секции, адреси, активност и резултати по партии за всяка държава. Изберете държава, за да видите всички секции и адресите им.</p>`,
  );
  if (countries.length) {
    parts.push(
      en
        ? `<h2>Countries with polling sections</h2>`
        : `<h2>Държави със секции</h2>`,
    );
    parts.push(
      en
        ? `<table><thead><tr><th>Country</th><th>Sections</th><th>Voters</th><th>Leading party</th></tr></thead><tbody>`
        : `<table><thead><tr><th>Държава</th><th>Секции</th><th>Гласували</th><th>Водеща партия</th></tr></thead><tbody>`,
    );
    for (const c of countries) {
      const label = escapeHtml(en && c.name_en ? c.name_en : c.name);
      const voters = c.voters ? fmtInt(c.voters) : "";
      const winner = c.winnerNickName ? escapeHtml(c.winnerNickName) : "";
      parts.push(
        `<tr><td><a href="${base}/sections/${escapeHtml(c.code)}">${label}</a></td><td>${fmtInt(c.sections)}</td><td>${voters}</td><td>${winner}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }
  parts.push(
    en
      ? `<h2>Frequently asked questions</h2>`
      : `<h2>Често задавани въпроси</h2>`,
  );
  for (const item of DIASPORA_FAQ[lang]) {
    parts.push(
      `<p><strong>${escapeHtml(item.q)}</strong> ${escapeHtml(item.a)}</p>`,
    );
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Procurement-by-settlement body — /procurement/settlement/{ekatte}.
// Bulgaria adopted the euro on 2026-01-01, so amounts display as "{n} €"
// (BG) / "€{n}" (EN). One door per settlement into the AOP corpus, keyed by
// the buyer's HQ address.
// ------------------------------------------------------------------

export type ProcurementSettlementInput = {
  name: string;
  province?: string;
  contractCount: number;
  totalEur: number;
  awarderCount: number;
};

export const buildProcurementSettlementBody = (
  lang: "bg" | "en",
  input: ProcurementSettlementInput,
): string => {
  const en = lang === "en";
  const base = en ? `${SITE_URL}/en` : SITE_URL;
  const { name, province, contractCount, totalEur, awarderCount } = input;
  const eur = en ? `€${fmtIntEn(totalEur)}` : `${fmtInt(totalEur)} €`;
  const place = province && province !== name ? `${name}, ${province}` : name;
  const parts: string[] = [];
  parts.push(
    en
      ? `<h1>Public procurement — ${escapeHtml(place)}</h1>`
      : `<h1>Обществени поръчки — ${escapeHtml(place)}</h1>`,
  );
  parts.push(
    en
      ? `<p>${fmtIntEn(contractCount)} public-procurement contracts worth ${eur}, awarded by ${fmtIntEn(awarderCount)} contracting authorities based in ${escapeHtml(place)} — municipalities, schools, hospitals, universities, regional offices and utilities. Sourced from the АОП register (data.egov.bg).</p>`
      : `<p>${fmtInt(contractCount)} обществени поръчки на стойност ${eur}, възложени от ${fmtInt(awarderCount)} възложители със седалище в ${escapeHtml(place)} — общини, училища, болници, университети, регионални структури и комунални дружества. По данни от регистъра на АОП (data.egov.bg).</p>`,
  );
  parts.push(
    en
      ? `<p><a href="${base}/procurement/by-settlement">All settlements</a> · <a href="${base}/procurement">Procurement dashboard</a></p>`
      : `<p><a href="${base}/procurement/by-settlement">Всички населени места</a> · <a href="${base}/procurement">Табло за обществените поръчки</a></p>`,
  );
  return parts.join("\n");
};

// ------------------------------------------------------------------
// EU-funds theme body — /funds/focus/{slug}. A curated lens on the ИСУН
// corpus; the body uses the theme's editorial label + summary.
// ------------------------------------------------------------------

export type FundsThemeInput = {
  labelBg: string;
  labelEn: string;
  summaryBg?: string;
  summaryEn?: string;
};

export const buildFundsThemeBody = (
  lang: "bg" | "en",
  input: FundsThemeInput,
): string => {
  const en = lang === "en";
  const base = en ? `${SITE_URL}/en` : SITE_URL;
  const label = en ? input.labelEn : input.labelBg;
  const summary = en ? input.summaryEn : input.summaryBg;
  const parts: string[] = [];
  parts.push(
    en
      ? `<h1>EU funds — ${escapeHtml(label)}</h1>`
      : `<h1>Европейски средства — ${escapeHtml(label)}</h1>`,
  );
  if (summary) parts.push(`<p>${escapeHtml(summary)}</p>`);
  parts.push(
    en
      ? `<p>Contracts, beneficiaries, programmes and the municipalities where the money landed for this theme — drawn from the ИСУН 2020 EU-funds register. <a href="${base}/funds">Back to EU funds</a>.</p>`
      : `<p>Поръчки, бенефициенти, програми и общините, в които са достигнали средствата по тази тема — по данни от регистъра на ИСУН 2020. <a href="${base}/funds">Към европейските средства</a>.</p>`,
  );
  return parts.join("\n");
};
