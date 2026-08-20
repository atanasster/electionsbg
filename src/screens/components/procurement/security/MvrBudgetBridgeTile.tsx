// "Айсбергът — поръчките в мащаба на бюджета на МВР" — the signature tile. It
// places the visible ЗОП procurement inside the REAL МВР budget (from the
// per-ministry budget tree update-budget ingests) so the reader sees how tiny the
// competed slice is against a ~€2.1bn budget that is ~90% salaries. The thesis is
// the iceberg: what you see (open procurement) is the tip; the mass below is
// payroll + security-exempt buys that never reach the register.
//
// Honesty rules (from DefenseBudgetBridgeTile / NzokBudgetBridgeTile): the budget
// TOTAL is the authoritative ЗДБ figure from the node (`expenditure.amountEur`,
// the larger figure — plan Audit rev 1.2); the ~90% personnel split is NOT in the
// node (it's by policy, not economic type), so it is drawn as an explicitly
// LABELLED ESTIMATE (hatched), never a measured band. data-og="police-hero".
//
// ⚠ THE BUDGET YEAR FOLLOWS THE SCOPE, and it did not until 2026-08-19. `procEur`
// is scope-windowed while this tile always took `years[years.length - 1]`, so at
// `?pscope=y:2018` it divided 2018's €77.5M by the 2026 budget and rendered „~4%".
// Against 2018's own €662.8M the real share is 11.7% — understated 3.2×, and
// always in the same direction, so the error silently flattered this tile's own
// „iceberg" thesis. `budgetYear` is the LAST year of the active scope window,
// clamped into the series; `all` and an open-ended window still resolve to latest,
// which is what the caption says. Accepted limitation: over a MULTI-year scope the
// numerator is an annual average against one year's budget — much smaller than the
// error it replaces, and the year is named on the figure. The four sibling bridge
// tiles (defense / nzok / social / vss) still have the original shape.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { ministryEurSeries } from "@/data/budget/ministrySeries";
import { MVR_PERSONNEL } from "@/lib/securityPersonnel";
import { MVR_BUDGET_NODE } from "@/lib/securityReferenceData";

// The ~90% payroll share is a LABELLED ESTIMATE — the node carries no
// economic-type split, so this band is context (execution report), not a measured
// figure. It is read from `MVR_PERSONNEL`, whose header already declared it
// "Shared with the iceberg budget-bridge tile"; this file used to declare its own
// copy, so the same claim sat on one page from two constants that could drift.
const PERSONNEL_SHARE_EST = MVR_PERSONNEL.personnelShareEst;

export const MvrBudgetBridgeTile: FC<{
  /** Visible ЗОП procurement across the group in the active scope. When `perYear`
   *  it's the annual figure (avg over the scope / a single year); otherwise it's
   *  the total for a partial period, so the copy drops "на година". */
  procEur: number | null;
  perYear: boolean;
  /** Calendar year to anchor the budget on — the last year of the active scope
   *  window, so the share's numerator and denominator describe the same period.
   *  ⚠ A year the series does NOT carry (the МВР node starts at 2018 while the
   *  ?pscope picker offers every year from SCOPE_FIRST_YEAR = 2011) is not a
   *  fallback case: no share is published at all. See `comparable` below.
   *  ⚠ Pass a SCOPE bound, never a contract-span one. `model.maxYear` moves with
   *  the pack's universe filter, so passing it would let a content dropdown
   *  re-anchor the denominator. */
  budgetYear?: number | null;
}> = ({ procEur, perYear, budgetYear }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(MVR_BUDGET_NODE);
  const years = ministryEurSeries(data?.years);
  if (!years.length) return null;

  const newest = years[years.length - 1];
  const matched =
    budgetYear != null
      ? (years.find((y) => y.fiscalYear === budgetYear) ?? null)
      : null;
  const anchor = matched ?? newest;
  // ⚠ A year the node does not carry has NO budget to be a share OF, and falling
  // back to the newest one and dividing anyway is the very defect `budgetYear`
  // exists to fix — measured on y:2017, €85.1M ÷ the 2026 €2,115.2M renders „~4%"
  // against a denominator at least 3.19× too large, with the „×3,2 от 2018" pill
  // returning to corroborate it because the fallback makes anchor === newest.
  // Publish the budget and the trend, which are true statements about 2026; drop
  // the cross-year ratio. Cf. RegionalPassThroughHero, "renders nothing rather
  // than a share of an absent budget".
  const comparable = budgetYear == null || matched != null;
  // The anchor year may still be RUNNING (y:2026 through today), in which case a
  // part-year numerator sits over a full-year appropriation and the share reads
  // low for a calendar reason. Deliberately NOT `latestCompleteFiscalYear`: that
  // helper PICKS which year may be divided into, and here the year is dictated by
  // the scope — the reader asked for it. So the state is detected and captioned
  // rather than silently re-anchored.
  const anchorRunning = anchor.fiscalYear >= new Date().getFullYear();
  const first = years[0];
  const budget = anchor.eur;
  // Growth is a property of the whole series, so it is only shown when the anchor
  // IS the newest year — „€662,8 млн., бюджет 2018 г., ×3,2 от 2018" is nonsense.
  const growth =
    anchor.fiscalYear === newest.fiscalYear && first.eur > 0
      ? newest.eur / first.eur
      : null;
  const maxBudget = Math.max(...years.map((y) => y.eur), 1);

  const proc = procEur ?? 0;
  const procShare = budget > 0 ? proc / budget : 0;
  // Composition widths must always sum to 100%. procShare can exceed 10% (even
  // >100%) in period-total mode over a multi-year window, so clamp the proc slice
  // to [2,100] and let the (estimated) personnel band absorb the remainder — the
  // bar never overflows and no width goes negative. And never MANUFACTURE a slice:
  // at an unknown or zero share the floor would paint 2% the legend prices at „—".
  const procPct =
    comparable && procShare > 0
      ? Math.min(100, Math.max(2, procShare * 100))
      : 0;
  const personnelPct = Math.min(PERSONNEL_SHARE_EST * 100, 100 - procPct);
  const otherPct = Math.max(0, 100 - personnelPct - procPct);
  // The legend must price the band it DRAWS. `personnelPct` is clamped by
  // `100 - procPct`, so on a wide window it can sit well under the estimate — up to
  // 11.8pp measured — and a hardcoded „~90%" would then label a bar nobody drew.
  const personnelLabelPct = Math.round(personnelPct);
  const overBudget = comparable && procShare > 1;
  const shareLabel =
    !comparable || procShare <= 0 || budget <= 0
      ? "—"
      : procShare < 0.005
        ? bg
          ? "под 0,5%"
          : "under 0.5%"
        : `~${(procShare * 100).toLocaleString(lang, { maximumFractionDigits: 0 })}%`;

  return (
    <Card id="police-bridge">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Поръчките в мащаба на бюджета на МВР"
            : "Procurement at the scale of the МВР budget"}
        </CardTitle>
      </CardHeader>
      <CardContent data-og="police-hero" className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(budget, lang)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `общ бюджет на МВР, ${anchor.fiscalYear} г.`
              : `total МВР budget, ${anchor.fiscalYear}`}
          </span>
          {growth != null && growth >= 1.5 && (
            <span className="text-xs font-medium text-muted-foreground">
              ×{growth.toLocaleString(lang, { maximumFractionDigits: 1 })}{" "}
              {bg ? `от ${first.fiscalYear}` : `since ${first.fiscalYear}`}
            </span>
          )}
        </div>

        {/* The iceberg composition of ONE year — salaries (est., hatched) ·
            upkeep · the thin bright procurement "tip". Labels live in the legend
            below; in-bar text clips at these segment widths. */}
        <div className="space-y-2">
          <div
            className="flex h-6 overflow-hidden rounded-md border"
            role="img"
            aria-label={
              bg
                ? `Състав на бюджета: заплати ~${personnelLabelPct}%, издръжка, видими поръчки ${shareLabel}`
                : `Budget composition: salaries ~${personnelLabelPct}%, upkeep, visible procurement ${shareLabel}`
            }
          >
            <div
              className="bg-[repeating-linear-gradient(45deg,hsl(var(--muted)),hsl(var(--muted))_7px,hsl(var(--muted-foreground)/0.18)_7px,hsl(var(--muted-foreground)/0.18)_14px)]"
              style={{ width: `${personnelPct}%` }}
            />
            <div className="bg-muted" style={{ width: `${otherPct}%` }} />
            <div className="bg-primary" style={{ width: `${procPct}%` }} />
          </div>
          {/* Legend — readable at any width, unlike in-bar text. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border bg-[repeating-linear-gradient(45deg,hsl(var(--muted)),hsl(var(--muted))_2px,hsl(var(--muted-foreground)/0.25)_2px,hsl(var(--muted-foreground)/0.25)_4px)]" />
              {bg
                ? `Заплати ~${personnelLabelPct}% (оценка)`
                : `Salaries ~${personnelLabelPct}% (est.)`}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border bg-muted" />
              {bg ? "Издръжка и капитал" : "Upkeep & capital"}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary" />
              {bg ? "Видими поръчки" : "Visible procurement"} —{" "}
              <span className="tabular-nums">
                {formatEurCompact(proc, lang)} ({shareLabel})
              </span>
            </span>
          </div>
        </div>

        {/* Budget growth trend — the jump on the 2025 wage indexation. */}
        <div className="flex items-end gap-1" style={{ height: 44 }}>
          {years.map((y) => (
            <div
              key={y.fiscalYear}
              className="flex-1"
              title={`${y.fiscalYear}: ${formatEurCompact(y.eur, lang)}`}
            >
              <div
                className={`w-full rounded-t ${
                  y.fiscalYear === anchor.fiscalYear
                    ? "bg-primary"
                    : "bg-primary/35"
                }`}
                style={{
                  height: `${Math.max(3, (y.eur / maxBudget) * 44)}px`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{first.fiscalYear}</span>
          <span>{newest.fiscalYear}</span>
        </div>

        <p className="text-sm leading-snug">
          {!comparable ? (
            // No share at all: the reader picked a year the budget series does not
            // reach. Naming the gap beats dividing by a different year's budget.
            bg ? (
              <>
                Няма приет бюджет на МВР за {budgetYear} г. в нашите данни
                (серията започва от {first.fiscalYear}), затова делът за тази
                година не се показва. Договорената стойност за периода е{" "}
                <span className="font-semibold tabular-nums">
                  {formatEurCompact(proc, lang)}
                </span>
                ; горе е бюджетът за {anchor.fiscalYear} г.
              </>
            ) : (
              <>
                We hold no enacted МВР budget for {budgetYear} (the series
                starts in {first.fiscalYear}), so no share is shown for that
                year. Contracted value in the period is{" "}
                <span className="font-semibold tabular-nums">
                  {formatEurCompact(proc, lang)}
                </span>
                ; the figure above is the {anchor.fiscalYear} budget.
              </>
            )
          ) : overBudget ? (
            // Self-refuting on a tile whose thesis is that the slice is thin — say
            // the basis looks wrong instead, as RegionalPassThroughHero does.
            bg ? (
              <>
                Видимите поръчки ({formatEurCompact(proc, lang)}) надхвърлят
                целия годишен бюджет на МВР за {anchor.fiscalYear} г. —{" "}
                <span className="font-semibold">{shareLabel}</span>. Това е знак
                за несъпоставима база (обхватът покрива повече от една година),
                а не находка — проверете базата.
              </>
            ) : (
              <>
                Visible procurement ({formatEurCompact(proc, lang)}) exceeds the
                whole {anchor.fiscalYear} МВР budget —{" "}
                <span className="font-semibold">{shareLabel}</span>. That
                signals a mismatched basis (the scope spans more than one year),
                not a finding — check the basis.
              </>
            )
          ) : bg ? (
            <>
              Видимите обществени поръчки на МВР{perYear ? " " : " за периода "}
              (
              <span className="font-semibold tabular-nums">
                {formatEurCompact(proc, lang)}
              </span>
              {perYear ? " на година) " : ") "}са{" "}
              <span className="font-semibold">{shareLabel}</span> от{" "}
              {perYear ? "този" : "годишния"} бюджет — върхът на айсберга.
              Останалото са заплати (~{personnelLabelPct}%), издръжка и
              капиталови разходи.
              {anchorRunning && (
                <>
                  {" "}
                  {anchor.fiscalYear} г. още тече, така че поръчките са до днес,
                  а бюджетът е за цялата година.
                </>
              )}
            </>
          ) : (
            <>
              МВР's visible public procurement
              {perYear ? " (" : " for the period ("}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(proc, lang)}
              </span>
              {perYear ? "/year) " : ") "}is{" "}
              <span className="font-semibold">{shareLabel}</span> of{" "}
              {perYear ? "this" : "the annual"} budget — the tip of the iceberg.
              The rest is salaries (~{personnelLabelPct}%), upkeep and capital.
              {anchorRunning && (
                <>
                  {" "}
                  {anchor.fiscalYear} is still running, so the procurement is
                  year-to-date while the budget is for the whole year.
                </>
              )}
            </>
          )}
        </p>

        {/* What sits OUTSIDE the register — the security exemptions. */}
        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          {bg
            ? "Извън регистъра на поръчките: класифицираните доставки за сигурност (ЗОП, Част четвърта — отбрана и сигурност; чл. 149; чл. 13 във вр. с чл. 346 ДФЕС) — наблюдение, СРС и част от граничната техника не подлежат на открита процедура."
            : "Outside the procurement register: classified security buys (ЗОП Part Four — defence & security; чл. 149; чл. 13 / Art. 346 TFEU) — surveillance, special intelligence means and some border tech run outside open procedure."}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Бюджет: Закон за държавния бюджет (админ. единица „Министерство на вътрешните работи“). Делът заплати ~90% е оценка (отчет за изпълнението), не е в бюджетния разрез по политики. Поръчки: АОП/ЦАИС ЕОП."
            : "Budget: State Budget Law (МВР admin unit). The ~90% salary share is an estimate (execution report), not in the node's by-policy split. Procurement: АОП/ЦАИС ЕОП."}
        </p>
      </CardContent>
    </Card>
  );
};
