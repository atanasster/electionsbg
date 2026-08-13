// The national municipal-commitments card on /governance/overview, mounted
// beside `GovernanceDebtTile` — and the pairing IS the point.
//
// State debt is watched monthly: every issue has a press release, a yield, a
// term, and the tile next door reports the latest two. Municipal commitments
// are ~€4.2bn contracted for later budget years across 265 municipalities, and
// nothing watches them at all — the consolidated cash deficit books a municipal
// payment when it is MADE, so until then they are invisible in every national
// figure.
//
// Two rules follow, and both are about the neighbour:
//
//   1. **They are NEVER summed with the state debt, and never stacked.** They
//      are different liabilities of different governments on different
//      accounting bases. The card states each separately and says so.
//   2. **The contrast is „watched vs unwatched", not „small vs large".** The
//      copy compares the ATTENTION, not the amounts, because comparing the
//      amounts is exactly the arithmetic rule 1 forbids.
//
// Reads `data/macro.json`'s three national series, which the T14 generator
// already emits — so this card costs one no-op on a payload the page has
// loaded anyway, rather than a second request.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { useMacro, type MacroPoint } from "@/data/macro/useMacro";
import { StatCard } from "@/screens/dashboard/StatCard";

/** The generator emits two fields per point that `MacroPoint` does not know
 *  about, and both are load-bearing here: a total behind fewer than the full
 *  roster is an undercount, and saying so is the difference between a figure
 *  and a claim. */
type StockPoint = MacroPoint & {
  municipalityCount?: number;
  partial?: boolean;
};

/** The newest quarter BOTH series cover, with each series' value at it.
 *
 *  Taking each series' own newest independently is the trap, and it was live:
 *  commitments stop at 2025-Q2 (МФ froze the column) while arrears run to
 *  2025-Q3, so the card captioned „as at 2025-Q2" and then divided the Q2
 *  commitments by the Q3 arrears. Arithmetically fine, false as a sentence —
 *  and these are STOCKS, so a ratio across two dates is not a ratio of
 *  anything. `buildSeries` already emits ascending order, so no re-sort. */
const latestShared = (
  a: StockPoint[] | undefined,
  b: StockPoint[] | undefined,
): { period: string; a: StockPoint; b: StockPoint | null } | null => {
  if (!a?.length) return null;
  const periodOf = (p: MacroPoint) =>
    p.period ?? (p.quarter ? `${p.year}-Q${p.quarter}` : `${p.year}`);
  const bByPeriod = new Map((b ?? []).map((p) => [periodOf(p), p]));
  for (let i = a.length - 1; i >= 0; i--) {
    const period = periodOf(a[i]);
    const other = bByPeriod.get(period);
    // The comparison is optional — the headline still stands on its own when
    // the sibling series does not reach this quarter.
    if (other || i === 0) return { period, a: a[i], b: other ?? null };
  }
  return null;
};

/** The headline is always billions — it is the whole point of the card. */
const eurBn = (v: number, locale: string): string =>
  `€${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })}`;

/** The comparison figure switches unit at a billion. Arrears are €75m, and
 *  „€0,08 млрд." is a number a reader has to decode before they can see it is
 *  46× smaller — which is the one thing that sentence exists to convey.
 *
 *  The unit WORD comes from i18n, like the headline's: a
 *  `locale.startsWith("bg")` branch would be a second, silent translation table
 *  that no locale gate can see. */
const eurAuto = (
  v: number,
  locale: string,
  t: (k: string) => string,
): string =>
  v >= 1000
    ? `€${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} ${t("gov_municipal_commitments_unit")}`
    : `€${v.toLocaleString(locale, { maximumFractionDigits: 0 })} ${t("gov_municipal_commitments_unit_m")}`;

export const GovernanceMunicipalCommitmentsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data } = useMacro();

  const pair = latestShared(
    data?.series.municipalCommitments,
    data?.series.municipalArrears,
  );
  // Self-suppress rather than render an empty card: on a checkout whose
  // macro.json predates the T14 series there is nothing here to say.
  if (!pair) return null;

  const { period, a: commitments, b: arrears } = pair;
  const locale = i18n.language;
  // A ratio only when it points the way the sentence claims. Guarded rather
  // than assumed: „Infinity пъти по-малко" and „0 пъти по-малко" are both
  // reachable from a copy that hardcodes one direction.
  const times =
    arrears && arrears.value > 0 && commitments.value > arrears.value
      ? Math.round(commitments.value / arrears.value)
      : null;

  return (
    <StatCard
      label={
        <span className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("gov_municipal_commitments_title")}
        </span>
      }
      seeMoreTo="/governance/municipal-finance"
    >
      <div className="text-2xl font-semibold tabular-nums">
        {eurBn(commitments.value, locale)}{" "}
        <span className="text-sm font-normal text-muted-foreground">
          {t("gov_municipal_commitments_unit")}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {t("gov_municipal_commitments_period", { period })}
        {/* The roster behind the figure, when it is short of the full 265. A
            total with fewer municipalities behind it is an undercount, and the
            point already carries the count — leaving it off publishes the
            smaller number with nothing saying it is smaller. */}
        {commitments.partial && commitments.municipalityCount != null && (
          <>
            {" · "}
            {t("gov_municipal_commitments_partial", {
              count: commitments.municipalityCount,
            })}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {/* Rule 2: the comparison is with the ATTENTION the state's own debt
            gets, never with its amount. */}
        {t("gov_municipal_commitments_contrast")}
      </p>
      {arrears && times != null && (
        <p className="text-xs text-muted-foreground mt-1">
          {t("gov_municipal_commitments_vs_arrears", {
            arrears: eurAuto(arrears.value, locale, t),
            times,
          })}
        </p>
      )}
    </StatCard>
  );
};
