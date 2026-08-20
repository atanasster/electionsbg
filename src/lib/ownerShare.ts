/**
 * Display an ownership percentage.
 *
 * The number itself is derived server-side by `tr_owner_share` (SQL migration
 * 003) — the ONE definition of what fraction of a company a person owns. Read
 * that view's header before touching anything here; the short version is that
 * the stored `tr_person_roles.share` divides each owner by every cap table the
 * company has ever filed, so nothing may serve it.
 *
 * ⚠️ NULL MEANS "NO ANSWER" AND MUST RENDER AS "—". Do NOT reintroduce the
 * `role === "sole_owner" && share == null → "100%"` fallback that used to live
 * at three call sites. The server already returns 100 for a sole owner that is
 * the company's ONLY current owner row; a NULL on a `sole_owner` therefore
 * means the opposite — it shares its vintage with active partners, i.e. a
 * superseded ЕООД filing we cannot resolve. Answering 100% there is precisely
 * what published 777 companies whose shares summed to a mean of 200.8%.
 *
 * One decimal, because whole-number rounding stops the column adding up: the
 * whole point of the fix is that a reader can sum it. Three equal owners are
 * 33,3% each, which reads as 100; as "33%" three times it reads as 99 and
 * looks like the bug that was just removed.
 */
const fmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 2 });

export const formatOwnerShare = (
  share: string | number | null | undefined,
): string => {
  if (share === null || share === undefined) return "—";
  // Number(" ") is 0, not NaN — an all-whitespace cell would otherwise publish
  // "0%", i.e. "owns nothing", out of a blank. `0` itself is a real answer and
  // must survive: 0 is "owns nothing and we know it", NULL is "no answer".
  if (typeof share === "string" && share.trim() === "") return "—";
  const n = Number(share);
  return Number.isFinite(n) ? `${fmt.format(n)}%` : "—";
};

/**
 * The parenthetical amount shown beside a percentage.
 *
 * ⚠️ Prefer `share_eur` — the figure `share_pct` is actually computed from,
 * i.e. this person's WHOLE current-vintage holding. `share_amount` is one
 * RECORD's declared figure in whatever currency it was filed in, so on the 280
 * groups holding several records in one vintage the two disagree, and printing
 * the raw amount beside the percentage gives the reader a parenthetical that
 * contradicts the number it appears to explain.
 *
 * The fallback is deliberate rather than lazy: where there is no percentage
 * (a row outside the current cap table) there is no share_eur either, and the
 * declared amount is still a true fact about that filing — it just no longer
 * claims to reconcile with anything.
 */
export const formatOwnerAmount = (
  shareEur: string | number | null | undefined,
  shareAmount: string | number | null | undefined,
  shareCurrency: string | null | undefined,
): string | null => {
  if (shareEur !== null && shareEur !== undefined && shareEur !== "") {
    const n = Number(shareEur);
    if (Number.isFinite(n)) return `${money.format(n)} EUR`;
  }
  if (shareAmount === null || shareAmount === undefined || shareAmount === "")
    return null;
  const n = Number(shareAmount);
  if (!Number.isFinite(n)) return null;
  return `${money.format(n)}${shareCurrency ? ` ${shareCurrency}` : ""}`;
};
