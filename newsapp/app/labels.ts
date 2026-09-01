// Bulgarian labels, fixed display orders and colors for the analysis scales.
// The framing axis reads left→right (progressive→conservative). These labels
// describe the MATERIAL'S framing, never a permanent property of an outlet.

import type {
  AiVerdict,
  Leaning,
  QualityVerdict,
  RussiaStance,
  TaxonomyCategory,
  Tone,
} from "./data";
import type { NewsLanguage } from "./i18n";

export const LEANING_ORDER: Leaning[] = [
  "strong_progressive",
  "progressive",
  "neutral",
  "conservative",
  "strong_conservative",
];

export const RUSSIA_ORDER: RussiaStance[] = [
  "strong_pro_russia",
  "pro_russia",
  "neutral",
  "anti_russia",
  "strong_anti_russia",
];

export type ScaleMeta = { label: string; short: string; color: string };

export const LEANING_META: Record<Leaning, ScaleMeta> = {
  strong_progressive: {
    label: "Силно прогресивно рамкиране",
    short: "Сл. прогресивно",
    color: "#1d4ed8",
  },
  progressive: {
    label: "Прогресивно рамкиране",
    short: "Прогресивно",
    color: "#3b82f6",
  },
  neutral: {
    label: "Без ясно идеологическо рамкиране",
    short: "Без ясно рамкиране",
    color: "#94a3b8",
  },
  conservative: {
    label: "Консервативно рамкиране",
    short: "Консервативно",
    color: "#f97316",
  },
  strong_conservative: {
    label: "Силно консервативно рамкиране",
    short: "Сл. консервативно",
    color: "#c2410c",
  },
  not_applicable: {
    label: "Извън политическата ос",
    short: "Извън оста",
    color: "#71717a",
  },
};

export const LEANING_META_EN: Record<Leaning, ScaleMeta> = {
  strong_progressive: {
    label: "Strong progressive framing",
    short: "Strong progressive",
    color: "#1d4ed8",
  },
  progressive: {
    label: "Progressive framing",
    short: "Progressive",
    color: "#3b82f6",
  },
  neutral: {
    label: "No clear ideological framing",
    short: "No clear framing",
    color: "#94a3b8",
  },
  conservative: {
    label: "Conservative framing",
    short: "Conservative",
    color: "#f97316",
  },
  strong_conservative: {
    label: "Strong conservative framing",
    short: "Strong conservative",
    color: "#c2410c",
  },
  not_applicable: {
    label: "Outside the political axis",
    short: "Outside the axis",
    color: "#71717a",
  },
};

// Spectrum hues deliberately diverge from the leaning blues/oranges so the two
// axes are never confused: pro-Russia warms toward red, anti-Russia toward teal.
export const RUSSIA_META: Record<RussiaStance, ScaleMeta> = {
  strong_pro_russia: {
    label: "Силно проруска",
    short: "Сл. проруска",
    color: "#b91c1c",
  },
  pro_russia: { label: "Проруска", short: "Проруска", color: "#ef4444" },
  neutral: {
    label: "Без ясно изразена позиция към Русия",
    short: "Без ясна позиция",
    color: "#94a3b8",
  },
  anti_russia: { label: "Антируска", short: "Антируска", color: "#0d9488" },
  strong_anti_russia: {
    label: "Силно антируска",
    short: "Сл. антируска",
    color: "#0f766e",
  },
  not_applicable: {
    label: "Русия не е спомената",
    short: "Не е спомената",
    color: "#71717a",
  },
};

export const RUSSIA_META_EN: Record<RussiaStance, ScaleMeta> = {
  strong_pro_russia: {
    label: "Strongly pro-Russia",
    short: "Strongly pro-Russia",
    color: "#b91c1c",
  },
  pro_russia: {
    label: "Pro-Russia",
    short: "Pro-Russia",
    color: "#ef4444",
  },
  neutral: {
    label: "No clear position on Russia",
    short: "No clear position",
    color: "#94a3b8",
  },
  anti_russia: {
    label: "Anti-Russia",
    short: "Anti-Russia",
    color: "#0d9488",
  },
  strong_anti_russia: {
    label: "Strongly anti-Russia",
    short: "Strongly anti-Russia",
    color: "#0f766e",
  },
  not_applicable: {
    label: "Russia is not mentioned",
    short: "Not mentioned",
    color: "#71717a",
  },
};

export const AI_META: Record<
  AiVerdict,
  { label: string; short: string; className: string }
> = {
  likely_human: {
    label: "Човешки текст",
    short: "Човек",
    className: "text-positive border-positive/40",
  },
  unclear: {
    label: "Неясен произход",
    short: "Неясно",
    className: "text-muted-foreground border-border",
  },
  likely_ai: {
    label: "Вероятно ИИ-генерирано",
    short: "ИИ?",
    className: "text-destructive border-destructive/40",
  },
};

export const AI_META_EN: typeof AI_META = {
  likely_human: {
    label: "Human-written text",
    short: "Human",
    className: "text-positive border-positive/40",
  },
  unclear: {
    label: "Unclear origin",
    short: "Unclear",
    className: "text-muted-foreground border-border",
  },
  likely_ai: {
    label: "Likely AI-generated",
    short: "AI?",
    className: "text-destructive border-destructive/40",
  },
};

export const QUALITY_META: Record<
  QualityVerdict,
  { label: string; short: string }
> = {
  ok: { label: "Добро качество", short: "OK" },
  paywall_shell: { label: "Само заглавие (пейуол)", short: "Пейуол" },
  client_render_shell: { label: "Съдържанието се зарежда със JS", short: "JS" },
  too_short: { label: "Твърде кратко", short: "Кратко" },
  not_bulgarian: { label: "Не е на български", short: "Чужд език" },
  non_article: { label: "Не е статия", short: "Не е статия" },
};

export const QUALITY_META_EN: typeof QUALITY_META = {
  ok: { label: "Good quality", short: "OK" },
  paywall_shell: { label: "Headline only (paywall)", short: "Paywall" },
  client_render_shell: {
    label: "Content loads with JavaScript",
    short: "JS",
  },
  too_short: { label: "Too short", short: "Short" },
  not_bulgarian: { label: "Not in Bulgarian", short: "Other language" },
  non_article: { label: "Not an article", short: "Not an article" },
};

export const TONE_META: Record<Tone, { label: string; className: string }> = {
  favorable: { label: "позитивен", className: "text-positive" },
  unfavorable: { label: "негативен", className: "text-negative" },
  neutral: { label: "неутрален", className: "text-muted-foreground" },
  mixed: { label: "смесен", className: "text-foreground" },
};

export const TONE_META_EN: typeof TONE_META = {
  favorable: { label: "favorable", className: "text-positive" },
  unfavorable: { label: "unfavorable", className: "text-negative" },
  neutral: { label: "neutral", className: "text-muted-foreground" },
  mixed: { label: "mixed", className: "text-foreground" },
};

export const leaningMeta = (value: Leaning, language: NewsLanguage) =>
  language === "en" ? LEANING_META_EN[value] : LEANING_META[value];
export const russiaMeta = (value: RussiaStance, language: NewsLanguage) =>
  language === "en" ? RUSSIA_META_EN[value] : RUSSIA_META[value];
export const aiMeta = (value: AiVerdict, language: NewsLanguage) =>
  language === "en" ? AI_META_EN[value] : AI_META[value];
export const qualityMeta = (value: QualityVerdict, language: NewsLanguage) =>
  language === "en" ? QUALITY_META_EN[value] : QUALITY_META[value];
export const toneMeta = (value: Tone, language: NewsLanguage) =>
  language === "en" ? TONE_META_EN[value] : TONE_META[value];

// ---- taxonomy --------------------------------------------------------------------

export const topicLabel = (
  taxonomy: TaxonomyCategory[] | null,
  category: string,
  subcategory: string | null,
  language: NewsLanguage = "bg",
): string | null => {
  const parts = topicParts(taxonomy, category, subcategory, language);
  return parts.length ? parts.map((p) => p.label).join(" · ") : null;
};

/** One entry per half of a topic — the category, then the subcategory when
 *  the article carries one — each with the main-site page it names, or null.
 *
 *  ⚠️ THE TWO HALVES ARE SEPARATE DESTINATIONS, which is why this exists
 *  beside `topicLabel`. „Лица и длъжностни лица · Декларации и конфликти на
 *  интереси" is the persons browser and the declarations register — two
 *  pages — so a single link over the joined string sends a reader who
 *  clicked the second half to the first.
 *
 *  ⚠️ ABSOLUTE hrefs, because the news app is a different origin: a relative
 *  one resolves against news.electionsbg.com, where none of these exist.
 *  Mirrors the `entity_links` rule in data.ts. */
export const topicParts = (
  taxonomy: TaxonomyCategory[] | null,
  category: string,
  subcategory: string | null,
  language: NewsLanguage = "bg",
): { label: string; href: string | null }[] => {
  const cat = taxonomy?.find((c) => c.id === category);
  if (!cat) return [];
  const out = [
    {
      label: cat.label[language],
      href: mainSiteHref(cat.route, language),
    },
  ];
  const sub = subcategory
    ? cat.subcategories.find((s) => s.id === subcategory)
    : null;
  if (sub)
    out.push({
      label: sub.label[language],
      href: mainSiteHref(sub.route, language),
    });
  return out;
};

const MAIN_SITE = "https://electionsbg.com";

const mainSiteHref = (
  route: string | null | undefined,
  language: NewsLanguage,
): string | null => {
  // ⚠️ A ROUTE WITH A DYNAMIC SEGMENT IS NOT A DESTINATION. „/local/:cycle"
  // is a real route and `/local/:cycle` is a 404 — the taxonomy names the
  // route PATTERN, and only a concrete path can be linked.
  if (!route || !route.startsWith("/") || route.includes(":")) return null;
  const localized =
    language === "en" ? `/en${route === "/" ? "" : route}` : route;
  return `${MAIN_SITE}${localized === "/" ? "" : localized}`;
};

// ---- dates -----------------------------------------------------------------------

const dateFormatters = {
  bg: new Intl.DateTimeFormat("bg-BG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
  en: new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
};
const dateTimeFormatters = {
  bg: new Intl.DateTimeFormat("bg-BG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  en: new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
};
const relativeFormatters = {
  bg: new Intl.RelativeTimeFormat("bg-BG", { numeric: "auto" }),
  en: new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" }),
};

const validDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (
  iso: string | null | undefined,
  language: NewsLanguage = "bg",
): string => {
  const d = validDate(iso);
  return d ? dateFormatters[language].format(d) : "—";
};

export const formatDateTime = (
  iso: string | null | undefined,
  language: NewsLanguage = "bg",
): string => {
  const d = validDate(iso);
  return d ? dateTimeFormatters[language].format(d) : "—";
};

export const relativeTime = (
  iso: string | null | undefined,
  language: NewsLanguage = "bg",
): string => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const formatter = relativeFormatters[language];
  if (abs < 60) return formatter.format(Math.round(diffSec), "second");
  if (abs < 3600) return formatter.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(diffSec / 3600), "hour");
  if (abs < 30 * 86400)
    return formatter.format(Math.round(diffSec / 86400), "day");
  return formatDate(iso, language);
};

export const formatVisits = (
  visits: number | null,
  language: NewsLanguage = "bg",
): string => {
  if (visits == null) return "—";
  if (visits >= 1_000_000)
    return `${(visits / 1_000_000).toFixed(1).replace(/\.0$/, "")} ${language === "en" ? "m" : "млн"}`;
  if (visits >= 1_000)
    return `${Math.round(visits / 1_000)} ${language === "en" ? "k" : "хил."}`;
  return String(visits);
};

const TIER_BG: Record<string, string> = {
  mass: "масова медия",
  editorial: "редакционна медия",
  long_tail: "малка/нишова медия",
};
const TYPE_BG: Record<string, string> = {
  aggregator: "агрегатор",
  "TV news": "телевизионни новини",
  agency: "агенция",
  "analysis/culture": "анализи и култура",
  business: "бизнес медия",
  "business TV": "бизнес телевизия",
  "business monthly": "месечно бизнес издание",
  "business/markets": "бизнес и пазари",
  commentary: "коментарна медия",
  daily: "всекидневник",
  "human rights/social": "права на човека и социални теми",
  "independent commentary": "независими коментари",
  "independent news": "независими новини",
  investigative: "разследваща медия",
  "investigative/data": "разследвания и данни",
  "municipal governance": "общинско управление",
  news: "новинарска медия",
  "news/lifestyle": "новини и начин на живот",
  newspaper: "вестник",
  "portal+news": "портал и новини",
  "public TV news": "обществена телевизия",
  "public radio news": "обществено радио",
  "public-service intl": "международна обществена медия",
  "radio news": "радио новини",
  regional: "регионална медия",
  "regional newspaper": "регионален вестник",
  "state news agency": "държавна информационна агенция",
  "tabloid news": "таблоидни новини",
  "tabloid newspaper": "таблоиден вестник",
  "weekly newspaper": "седмичен вестник",
  "weekly/business": "седмично бизнес издание",
};
const SCOPE_BG: Record<string, string> = {
  national: "национален обхват",
  Blagoevgrad: "Благоевград",
  Burgas: "Бургас",
  Haskovo: "Хасково",
  Plovdiv: "Пловдив",
  Varna: "Варна",
};
const TIER_EN: Record<string, string> = {
  mass: "mass media",
  editorial: "editorial outlet",
  long_tail: "small/niche outlet",
};
const TYPE_EN: Record<string, string> = {
  aggregator: "aggregator",
  "TV news": "TV news",
  agency: "news agency",
  "analysis/culture": "analysis and culture",
  business: "business media",
  "business TV": "business TV",
  "business monthly": "monthly business publication",
  "business/markets": "business and markets",
  commentary: "commentary outlet",
  daily: "daily newspaper",
  "human rights/social": "human rights and social issues",
  "independent commentary": "independent commentary",
  "independent news": "independent news",
  investigative: "investigative outlet",
  "investigative/data": "investigations and data",
  "municipal governance": "municipal governance",
  news: "news outlet",
  "news/lifestyle": "news and lifestyle",
  newspaper: "newspaper",
  "portal+news": "portal and news",
  "public TV news": "public TV news",
  "public radio news": "public radio news",
  "public-service intl": "international public-service media",
  "radio news": "radio news",
  regional: "regional outlet",
  "regional newspaper": "regional newspaper",
  "state news agency": "state news agency",
  "tabloid news": "tabloid news",
  "tabloid newspaper": "tabloid newspaper",
  "weekly newspaper": "weekly newspaper",
  "weekly/business": "weekly business publication",
};
const SCOPE_EN: Record<string, string> = {
  national: "national coverage",
  Blagoevgrad: "Blagoevgrad",
  Burgas: "Burgas",
  Haskovo: "Haskovo",
  Plovdiv: "Plovdiv",
  Varna: "Varna",
};

const controlledLabel = (
  map: Record<string, string>,
  value: string | null,
  fallback: string,
) => (value ? (map[value] ?? fallback) : null);
export const outletTierLabel = (
  value: string | null,
  language: NewsLanguage = "bg",
): string | null =>
  controlledLabel(
    language === "en" ? TIER_EN : TIER_BG,
    value,
    language === "en" ? "unspecified group" : "неуточнена група",
  );
export const outletTypeLabel = (
  value: string | null,
  language: NewsLanguage = "bg",
): string | null =>
  controlledLabel(
    language === "en" ? TYPE_EN : TYPE_BG,
    value,
    language === "en" ? "unspecified type" : "неуточнен тип",
  );
export const outletScopeLabel = (
  value: string | null,
  language: NewsLanguage = "bg",
): string | null =>
  controlledLabel(
    language === "en" ? SCOPE_EN : SCOPE_BG,
    value,
    language === "en" ? "unspecified coverage" : "неуточнен обхват",
  );

/**
 * Bulgarian number agreement for „статия" / „статии" — THE one definition.
 *
 * These count labels use the singular only for the exact count 1; all other
 * counts use the plural. It lives here so every screen follows the same rule.
 */
export const bgArticleNoun = (n: number): string =>
  Math.abs(n) === 1 ? "статия" : "статии";

/** „1 статия", „21 статии" — the count and its noun, agreeing. */
export const bgArticles = (n: number): string => `${n} ${bgArticleNoun(n)}`;
export const bgStories = (n: number): string =>
  `${n} ${Math.abs(n) === 1 ? "история" : "истории"}`;
export const bgMedia = (n: number): string =>
  `${n} ${Math.abs(n) === 1 ? "медия" : "медии"}`;
export const bgAnalyzedArticles = (n: number): string =>
  `${n} ${Math.abs(n) === 1 ? "анализирана статия" : "анализирани статии"}`;
export const bgCollectedArticles = (n: number): string =>
  `${n} ${Math.abs(n) === 1 ? "събрана статия" : "събрани статии"}`;

export const articles = (n: number, language: NewsLanguage): string =>
  language === "en"
    ? `${n} ${Math.abs(n) === 1 ? "article" : "articles"}`
    : bgArticles(n);
export const stories = (n: number, language: NewsLanguage): string =>
  language === "en"
    ? `${n} ${Math.abs(n) === 1 ? "story" : "stories"}`
    : bgStories(n);
export const media = (n: number, language: NewsLanguage): string =>
  language === "en"
    ? `${n} ${Math.abs(n) === 1 ? "outlet" : "outlets"}`
    : bgMedia(n);
export const analyzedArticles = (n: number, language: NewsLanguage): string =>
  language === "en"
    ? `${n} analysed ${Math.abs(n) === 1 ? "article" : "articles"}`
    : bgAnalyzedArticles(n);
export const collectedArticles = (n: number, language: NewsLanguage): string =>
  language === "en"
    ? `${n} collected ${Math.abs(n) === 1 ? "article" : "articles"}`
    : bgCollectedArticles(n);
