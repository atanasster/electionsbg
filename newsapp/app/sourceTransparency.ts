import type { OutletOwner } from "./data";
import type { NewsLanguage } from "./i18n";

/**
 * Corpus-wide funding-transparency coverage, not a claim about any outlet.
 *
 * A per-outlet `checked_no_disclosure` state would require a documented lookup
 * and source. Until that work exists, every profile must say `not_collected`
 * and point to the dated methodology boundary below.
 */
export const FUNDING_TRANSPARENCY_COVERAGE = {
  status: "not_collected",
  documentedAt: "2026-09-01",
  methodologyPath: "/methodology#outlet-transparency",
} as const;

export const safeHttpUrl = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};

export const outletHomepage = (domain: string): string | null =>
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    domain,
  )
    ? `https://${domain}/`
    : null;

const validIsoDate = (value: string | null): boolean =>
  Boolean(
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)),
  );

export const publishableOwner = (
  owner: OutletOwner | null,
): OutletOwner | null =>
  owner?.name.trim() && safeHttpUrl(owner.source) && validIsoDate(owner.checked)
    ? owner
    : null;

const RETIREMENT_REASON_BG: Record<string, string> = {
  portal_not_newsroom: "порталът не е самостоятелна редакция",
  blocked_captcha: "достъпът е блокиран от CAPTCHA",
  no_article_text: "страниците не предоставят четим текст на материалите",
  broken_sitemaps: "източниците за автоматично откриване не работят надеждно",
  bot_refused: "изданието отказва автоматизиран достъп",
  duplicate_outlet: "дублира друг източник в каталога",
};

const RETIREMENT_REASON_EN: Record<string, string> = {
  portal_not_newsroom: "the portal is not an independent newsroom",
  blocked_captcha: "access is blocked by a CAPTCHA",
  no_article_text: "the pages do not provide readable article text",
  broken_sitemaps: "automatic discovery sources do not work reliably",
  bot_refused: "the outlet refuses automated access",
  duplicate_outlet: "it duplicates another source in the directory",
};

export const retirementReasonBg = (reason: string | null): string =>
  reason
    ? (RETIREMENT_REASON_BG[reason] ?? "причината не е описана")
    : "причината не е записана";

export const retirementReason = (
  reason: string | null,
  language: NewsLanguage = "bg",
): string => {
  if (language === "bg") return retirementReasonBg(reason);
  return reason
    ? (RETIREMENT_REASON_EN[reason] ?? "the reason is not described")
    : "the reason was not recorded";
};
