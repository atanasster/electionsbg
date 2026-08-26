// Bulgarian labels, fixed display orders and colors for the analysis scales.
// The leaning axis reads left→right (progressive→conservative), mirroring the
// ground.news spectrum; colors are fixed hex values chosen to read on both the
// light (cream) and dark (navy) theme cards.

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
    label: "Силно прогресивно",
    short: "Сл. прогресивно",
    color: "#1d4ed8",
  },
  progressive: { label: "Прогресивно", short: "Прогресивно", color: "#3b82f6" },
  neutral: { label: "Център", short: "Център", color: "#94a3b8" },
  conservative: {
    label: "Консервативно",
    short: "Консервативно",
    color: "#f97316",
  },
  strong_conservative: {
    label: "Силно консервативно",
    short: "Сл. консервативно",
    color: "#c2410c",
  },
  not_applicable: { label: "Без пристрастие", short: "—", color: "#71717a" },
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
  neutral: { label: "Неутрална", short: "Неутрална", color: "#94a3b8" },
  anti_russia: { label: "Антируска", short: "Антируска", color: "#0d9488" },
  strong_anti_russia: {
    label: "Силно антируска",
    short: "Сл. антируска",
    color: "#0f766e",
  },
  not_applicable: { label: "Без позиция", short: "—", color: "#71717a" },
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
  const cat = taxonomy?.find((c) => c.id === category);
  if (!cat) return null;
  const sub = subcategory
    ? cat.subcategories.find((s) => s.id === subcategory)
    : null;
  return sub ? `${cat.label.bg} · ${sub.label.bg}` : cat.label.bg;
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

/**
 * Bulgarian number agreement for „статия" / „статии" — THE one definition.
 *
 * ⚠️ The rule is on the LAST DIGIT, not on the value. Every numeral ending in
 * 1 takes the singular EXCEPT the teens: 1 статия, 21 статия, 101 статия, but
 * 11 статии. An `n === 1` test is right for exactly one number and wrong for
 * every other one that ends in 1 — and 21 is reachable on both screens that
 * use this, since the topic floor is 20 and outlets carry hundreds.
 *
 * It lives here rather than in either screen because it existed twice, with
 * the same gap in both copies, which is how a formatting rule comes to be
 * fixed on one page and left wrong on the other.
 */
export const bgArticleNoun = (n: number): string => {
  const abs = Math.abs(Math.trunc(n));
  return abs === 1 ? "статия" : "статии";
};

/** „21 статия" — the count and its noun, agreeing. */
export const bgArticles = (n: number): string => `${n} ${bgArticleNoun(n)}`;
