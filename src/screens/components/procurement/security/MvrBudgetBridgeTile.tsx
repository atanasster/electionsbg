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

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { MVR_BUDGET_NODE } from "@/lib/securityReferenceData";

// МВР is ~85–90% payroll (2025 salaries ≈ 3.82bn лв of ~4.14bn лв total; capital
// ~55M лв). Shown as a LABELLED ESTIMATE — the node carries no economic-type split,
// so this band is context (execution report), not a measured figure.
const PERSONNEL_SHARE_EST = 0.9;

export const MvrBudgetBridgeTile: FC<{
  /** Visible ЗОП procurement across the group in the active scope. When `perYear`
   *  it's the annual figure (avg over the scope / a single year); otherwise it's
   *  the total for a partial period, so the copy drops "на година". */
  procEur: number | null;
  perYear: boolean;
}> = ({ procEur, perYear }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(MVR_BUDGET_NODE);
  const years = (data?.years ?? [])
    .filter(
      (y): y is typeof y & { expenditure: NonNullable<typeof y.expenditure> } =>
        y.expenditure != null,
    )
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  if (!years.length) return null;

  const latest = years[years.length - 1];
  const first = years[0];
  const budget = latest.expenditure.amountEur;
  const growth =
    first.expenditure.amountEur > 0
      ? budget / first.expenditure.amountEur
      : null;
  const maxBudget = Math.max(...years.map((y) => y.expenditure.amountEur), 1);

  const proc = procEur ?? 0;
  const procShare = budget > 0 ? proc / budget : 0;
  // Composition widths must always sum to 100%. procShare can exceed 10% (even
  // >100%) in period-total mode over a multi-year window, so clamp the proc slice
  // to [2,100] and let the (estimated) personnel band absorb the remainder — the
  // bar never overflows and no width goes negative.
  const procPct = Math.min(100, Math.max(2, procShare * 100));
  const personnelPct = Math.min(PERSONNEL_SHARE_EST * 100, 100 - procPct);
  const otherPct = Math.max(0, 100 - personnelPct - procPct);
  const shareLabel =
    procShare <= 0 || budget <= 0
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
              ? `общ бюджет на МВР, ${latest.fiscalYear} г.`
              : `total МВР budget, ${latest.fiscalYear}`}
          </span>
          {growth != null && growth >= 1.5 && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
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
                ? `Състав на бюджета: заплати ~90%, издръжка, видими поръчки ${shareLabel}`
                : `Budget composition: salaries ~90%, upkeep, visible procurement ${shareLabel}`
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
              {bg ? "Заплати ~90% (оценка)" : "Salaries ~90% (est.)"}
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
              title={`${y.fiscalYear}: ${formatEurCompact(y.expenditure.amountEur, lang)}`}
            >
              <div
                className={`w-full rounded-t ${
                  y.fiscalYear === latest.fiscalYear
                    ? "bg-primary"
                    : "bg-primary/35"
                }`}
                style={{
                  height: `${Math.max(3, (y.expenditure.amountEur / maxBudget) * 44)}px`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{first.fiscalYear}</span>
          <span>{latest.fiscalYear}</span>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Видимите обществени поръчки на МВР{perYear ? " " : " за периода "}
              (
              <span className="font-semibold tabular-nums">
                {formatEurCompact(proc, lang)}
              </span>
              {perYear ? " на година) " : ") "}са{" "}
              <span className="font-semibold">{shareLabel}</span> от{" "}
              {perYear ? "този" : "годишния"} бюджет — върхът на айсберга.
              Останалото са заплати (~90%), издръжка и капиталови разходи.
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
              The rest is salaries (~90%), upkeep and capital.
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
