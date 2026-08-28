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

export const TONE_META: Record<Tone, { label: string; className: string }> = {
  favorable: { label: "позитивен", className: "text-positive" },
  unfavorable: { label: "негативен", className: "text-negative" },
  neutral: { label: "неутрален", className: "text-muted-foreground" },
  mixed: { label: "смесен", className: "text-foreground" },
};

// ---- taxonomy --------------------------------------------------------------------

export const topicLabel = (
  taxonomy: TaxonomyCategory[] | null,
  category: string,
  subcategory: string | null,
): string | null => {
  const parts = topicParts(taxonomy, category, subcategory);
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
): { label: string; href: string | null }[] => {
  const cat = taxonomy?.find((c) => c.id === category);
  if (!cat) return [];
  const out = [{ label: cat.label.bg, href: mainSiteHref(cat.route) }];
  const sub = subcategory
    ? cat.subcategories.find((s) => s.id === subcategory)
    : null;
  if (sub) out.push({ label: sub.label.bg, href: mainSiteHref(sub.route) });
  return out;
};

const MAIN_SITE = "https://electionsbg.com";

const mainSiteHref = (route: string | null | undefined): string | null => {
  // ⚠️ A ROUTE WITH A DYNAMIC SEGMENT IS NOT A DESTINATION. „/local/:cycle"
  // is a real route and `/local/:cycle` is a 404 — the taxonomy names the
  // route PATTERN, and only a concrete path can be linked.
  if (!route || !route.startsWith("/") || route.includes(":")) return null;
  return `${MAIN_SITE}${route === "/" ? "" : route}`;
};

// ---- dates -----------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("bg-BG", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("bg-BG", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const relFmt = new Intl.RelativeTimeFormat("bg-BG", { numeric: "auto" });

const validDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (iso: string | null | undefined): string => {
  const d = validDate(iso);
  return d ? dateFmt.format(d) : "—";
};

export const formatDateTime = (iso: string | null | undefined): string => {
  const d = validDate(iso);
  return d ? dateTimeFmt.format(d) : "—";
};

export const relativeTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return relFmt.format(Math.round(diffSec), "second");
  if (abs < 3600) return relFmt.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return relFmt.format(Math.round(diffSec / 3600), "hour");
  if (abs < 30 * 86400)
    return relFmt.format(Math.round(diffSec / 86400), "day");
  return formatDate(iso);
};

export const formatVisits = (visits: number | null): string => {
  if (visits == null) return "—";
  if (visits >= 1_000_000)
    return `${(visits / 1_000_000).toFixed(1).replace(/\.0$/, "")} млн`;
  if (visits >= 1_000) return `${Math.round(visits / 1_000)} хил.`;
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

const controlledLabel = (
  map: Record<string, string>,
  value: string | null,
  fallback: string,
) => (value ? (map[value] ?? fallback) : null);
export const outletTierLabel = (value: string | null): string | null =>
  controlledLabel(TIER_BG, value, "неуточнена група");
export const outletTypeLabel = (value: string | null): string | null =>
  controlledLabel(TYPE_BG, value, "неуточнен тип");
export const outletScopeLabel = (value: string | null): string | null =>
  controlledLabel(SCOPE_BG, value, "неуточнен обхват");

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
