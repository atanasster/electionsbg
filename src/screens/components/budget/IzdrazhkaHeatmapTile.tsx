// "Издръжка по ведомства" heatmap — the per-spending-unit operating-cost
// (издръжка) series reconstructed from each year's State Budget Law, laid out
// as a year × institution grid. Two things make it a fair-picture view of the
// "Бюджет 2026: Перо по перо" critique:
//   1. Each column header credits the finance minister who authored that year's
//      budget (and who revised it), resolved by date from finance_ministers.json
//      + budget_laws.json — so a one-year jump is read against who owned it.
//   2. Each cell is shaded by its year-over-year change: the worst spending
//      increase is the most red, the biggest cut the most green.
// Hovering a cell shows the shared Tooltip with the full breakdown (minister,
// amount, YoY change in % and € millions).
import { FC, ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useTooltip } from "@/ux/useTooltip";
import { FinanceMinister } from "@/data/governments/useFinanceMinisters";
import { BudgetLaw } from "@/data/governments/useBudgetLaws";
import { useIzdrazhkaByInstitution } from "@/data/budget/useIzdrazhkaByInstitution";

// The 2026 budget is a draft (adopted === null); credit the minister in office
// when it was tabled rather than leaving the column unattributed.
const DRAFT_DATE = "2026-06-24";
const TOP_N = 15;
const CAP = 80; // |YoY %| at which the cell reaches full colour saturation

const fmAtDate = (
  fms: FinanceMinister[],
  iso: string,
): FinanceMinister | null => {
  const ts = Date.parse(iso);
  for (const fm of fms) {
    const s = Date.parse(fm.startDate);
    const e = fm.endDate ? Date.parse(fm.endDate) : Number.MAX_SAFE_INTEGER;
    if (ts >= s && ts < e) return fm;
  }
  return null;
};

const fmName = (fm: FinanceMinister, lang: "bg" | "en"): string =>
  lang === "bg" ? fm.bg : fm.en;

const surname = (fm: FinanceMinister, lang: "bg" | "en"): string =>
  fmName(fm, lang).split(" ").pop() ?? fmName(fm, lang);

const cellBg = (yoy: number | undefined): string => {
  if (yoy === undefined || Number.isNaN(yoy)) return "transparent";
  const intensity = Math.min(1, Math.abs(yoy) / CAP);
  const pct = Math.round(10 + intensity * 62);
  const base = yoy >= 0 ? "#dc2626" : "#16a34a";
  return `color-mix(in srgb, ${base} ${pct}%, hsl(var(--background)))`;
};

type Credit = {
  creator: FinanceMinister | null;
  revisers: FinanceMinister[];
  draft: boolean;
};

export const IzdrazhkaHeatmapTile: FC<{
  financeMinisters: FinanceMinister[];
  budgetLaws: BudgetLaw[];
}> = ({ financeMinisters, budgetLaws }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data } = useIzdrazhkaByInstitution();
  const [showAll, setShowAll] = useState(false);
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip({
    maxWidth: 300,
    maxHeight: 240,
  });

  if (!data || !data.institutions.length) return null;
  const { years, draftYear } = data;
  const bg = lang === "bg";
  const locale = bg ? "bg-BG" : "en-US";

  const credit = (year: number): Credit => {
    const law = budgetLaws.find((l) => l.year === year);
    const adopted = law?.adopted ?? (year === draftYear ? DRAFT_DATE : null);
    const creator = adopted ? fmAtDate(financeMinisters, adopted) : null;
    const revisers = (law?.revisions ?? [])
      .map((r) => fmAtDate(financeMinisters, r))
      .filter((m): m is FinanceMinister => !!m);
    return { creator, revisers, draft: !law?.adopted && year === draftYear };
  };
  const creditByYear: Record<number, Credit> = Object.fromEntries(
    years.map((y) => [y, credit(y)]),
  );

  const millions = (v: number) =>
    (v / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });

  // Previous available year's value (institutions can skip years on a
  // reorganisation), so the tooltip's absolute Δ matches the YoY %.
  const prevYearValue = (
    inst: (typeof data.institutions)[number],
    y: number,
  ): { year: number; value: number } | null => {
    for (let p = y - 1; p >= years[0]; p--) {
      const v = inst.values[String(p)];
      if (v !== undefined) return { year: p, value: v };
    }
    return null;
  };

  const tipContent = (
    inst: (typeof data.institutions)[number],
    y: number,
    v: number,
    yoy: number | undefined,
  ): ReactNode => {
    const c = creditByYear[y];
    const prev = prevYearValue(inst, y);
    const deltaM = prev ? (v - prev.value) / 1000 : null;
    const up = (yoy ?? 0) >= 0;
    const accent = up ? "#dc2626" : "#16a34a";
    return (
      <div className="space-y-1">
        <div className="font-medium text-foreground">
          {inst.bg} · {y}
          {c.draft ? ` (${bg ? "проект" : "draft"})` : ""}
        </div>
        {c.creator ? (
          <div className="text-muted-foreground">
            {c.draft
              ? bg
                ? "Проект: "
                : "Draft: "
              : bg
                ? "Бюджет: "
                : "Budget: "}
            {fmName(c.creator, lang)}
            {c.revisers.length
              ? `, ${bg ? "ревизия" : "revised"}: ${c.revisers
                  .map((r) => fmName(r, lang))
                  .join(", ")}`
              : ""}
          </div>
        ) : null}
        <div className="text-foreground">
          {bg ? "Издръжка" : "Operating cost"}:{" "}
          <span className="font-medium">{millions(v)} млн €</span>{" "}
          <span className="text-muted-foreground">
            ({v.toLocaleString(locale)} {bg ? "хил. €" : "€k"})
          </span>
        </div>
        {yoy !== undefined && prev ? (
          <div style={{ color: accent }}>
            {up ? "▲" : "▼"} {up ? "+" : ""}
            {yoy}% {bg ? "спрямо" : "vs"} {prev.year}
            {deltaM !== null
              ? ` (${deltaM >= 0 ? "+" : "−"}${millions(Math.abs(deltaM) * 1000)} млн €)`
              : ""}
          </div>
        ) : (
          <div className="text-muted-foreground">
            {bg ? "няма предходна година" : "no prior year"}
          </div>
        )}
      </div>
    );
  };

  const delta26 = (i: (typeof data.institutions)[number]) =>
    (i.values[String(draftYear)] ?? 0) - (i.values[String(draftYear - 1)] ?? 0);
  const rows = [...data.institutions].sort((a, b) => delta26(b) - delta26(a));
  const shown = showAll ? rows : rows.slice(0, TOP_N);

  const th =
    "px-2 py-1 text-center align-bottom font-normal border-b border-border/40";
  const td =
    "px-2 py-1 text-right tabular-nums whitespace-nowrap border-b border-border/20";

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>
          {bg
            ? "Издръжка по ведомства — кой бюджет, кой министър"
            : "Operating costs by institution — which budget, which minister"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Издръжка (текущи разходи без персонал, субсидии, лихви и трансфери за домакинства), в млн €, по приет бюджет. Цветът показва промяната спрямо предходната година — най-силно червено = най-голям ръст, най-силно зелено = най-голям спад. Заглавията кредитират финансовия министър, изготвил бюджета."
            : "Operating costs (current spending minus personnel, subsidies, interest and household transfers), €M, as adopted. Cell colour shows the year-over-year change — deepest red = biggest increase, deepest green = biggest cut. Headers credit the finance minister who authored each budget."}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={`${th} text-left`}>
                  {bg ? "Ведомство" : "Institution"}
                </th>
                {years.map((y) => {
                  const c = creditByYear[y];
                  return (
                    <th key={y} className={th} style={{ minWidth: 64 }}>
                      <div className="text-sm font-medium text-foreground">
                        {y}
                        {c.draft ? (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                            {bg ? "проект" : "draft"}
                          </span>
                        ) : null}
                      </div>
                      {c.creator ? (
                        <div className="mt-0.5 leading-tight text-muted-foreground">
                          {fmName(c.creator, lang)}
                        </div>
                      ) : null}
                      {c.revisers.length ? (
                        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground/80">
                          {bg ? "рев. " : "rev. "}
                          {c.revisers.map((r) => surname(r, lang)).join(", ")}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((inst) => (
                <tr key={inst.bg}>
                  <td className="border-b border-border/20 px-2 py-1 text-left font-medium text-foreground whitespace-nowrap">
                    {inst.bg}
                  </td>
                  {years.map((y) => {
                    const v = inst.values[String(y)];
                    const yoy = inst.yoy[String(y)];
                    if (v === undefined)
                      return (
                        <td
                          key={y}
                          className={`${td} text-muted-foreground/40`}
                        >
                          –
                        </td>
                      );
                    const label =
                      `${inst.bg} ${y}: ${millions(v)} млн €` +
                      (yoy !== undefined
                        ? `, ${yoy >= 0 ? "+" : ""}${yoy}%`
                        : "");
                    return (
                      <td
                        key={y}
                        className={`${td} cursor-pointer`}
                        style={{ backgroundColor: cellBg(yoy) }}
                        aria-label={label}
                        onMouseEnter={(e) =>
                          onMouseEnter(
                            { pageX: e.pageX, pageY: e.pageY },
                            tipContent(inst, y, v, yoy),
                          )
                        }
                        onMouseMove={(e) =>
                          onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                        }
                        onMouseLeave={onMouseLeave}
                      >
                        {millions(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{bg ? "спад" : "cut"}</span>
            <span
              className="inline-block h-3 w-32 rounded"
              style={{
                background:
                  "linear-gradient(to right, #16a34a, hsl(var(--background)), #dc2626)",
              }}
              aria-hidden="true"
            />
            <span>{bg ? "ръст" : "increase"}</span>
          </div>
          {rows.length > TOP_N ? (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="rounded-md border border-border/60 px-3 py-1 text-xs hover:bg-muted"
            >
              {showAll
                ? bg
                  ? "Покажи първите 15"
                  : "Show top 15"
                : bg
                  ? `Покажи всички ${rows.length}`
                  : `Show all ${rows.length}`}
            </button>
          ) : null}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {bg
            ? "Издръжката е остатъчно перо, пресметнато от ЗДБРБ за всяка година (методът на Асен Василев, „Бюджет 2026: Перо по перо“). Ревизиите на бюджета не съдържат разбивка по ведомства, затова стойностите са по приет бюджет. 2026 е проектозакон. Източник: ЗДБРБ 2018–2026 (Държавен вестник)."
            : "Operating cost is a residual reconstructed from each year's State Budget Law (Asen Vasilev's method). Mid-year revisions carry no per-institution breakdown, so figures are as adopted. 2026 is a draft. Source: State Budget Laws 2018–2026 (State Gazette)."}
        </p>
        {tooltip}
      </CardContent>
    </Card>
  );
};
