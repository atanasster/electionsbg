// Citizen tax-bill calculator. Salary slider → monthly tax bill (10% PIT +
// 13.78% employee SSC) → routed into the same COFOG composition the
// functional-classification tile shows. Answers "what did MY taxes buy".
//
// Inspired by NZ Treasury's Income Explorer and the old Where Does My Money
// Go "Daily Bread" view — the only consistently citation-magnet tile in the
// competitive set. Numbers are illustrative, not a tax-policy calculator:
// SSC is technically earmarked (pension + health + unemployment), but applying
// general-government composition to the total bill is the framing the public
// reaches for first.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import {
  COFOG_FUNCTIONS,
  useCofog,
  type CofogCode,
} from "@/data/macro/useCofog";

// Bulgarian PIT is a 10% flat rate on the post-SSC base. Employee SSC share
// for the default case (no second-pillar opt-out, average insurable income)
// nets out to ~13.78% of gross: pension 8.78% + health 3.20% + unemployment
// 0.40% + sickness/maternity 1.40%. The actual cap on insurable income
// (~€2,110/mo in 2026 terms) is ignored for simplicity; the slider tops out
// near the cap so the bias on absolute numbers is small.
const SSC_EMPLOYEE_RATE = 0.1378;
const PIT_RATE = 0.1;

// Slider range. Defaults to ~average gross monthly wage in Bulgaria (€1,100
// in 2024 NSI terms). The bottom end is the legal minimum wage; the top is
// roughly the cap on the insurable-income base.
const MIN_GROSS = 500;
const MAX_GROSS = 3000;
const STEP_GROSS = 50;
const DEFAULT_GROSS = 1100;

const compactEur = (v: number): string => {
  if (v >= 100) return `€${Math.round(v).toLocaleString()}`;
  return `€${v.toFixed(2)}`;
};

const COFOG_FALLBACK_EN: Record<Exclude<CofogCode, "TOTAL">, string> = {
  GF01: "General public services",
  GF02: "Defence",
  GF03: "Public order and safety",
  GF04: "Economic affairs",
  GF05: "Environmental protection",
  GF06: "Housing and community amenities",
  GF07: "Health",
  GF08: "Recreation, culture and religion",
  GF09: "Education",
  GF10: "Social protection",
};

interface Slice {
  code: Exclude<CofogCode, "TOTAL">;
  share: number;
  eur: number;
}

export const BudgetTaxBillTile: FC = () => {
  const { t } = useTranslation();
  const { data: cofog } = useCofog();
  const [gross, setGross] = useState(DEFAULT_GROSS);

  // Monthly tax burden — SSC first, then 10% PIT on the residual.
  const ssc = gross * SSC_EMPLOYEE_RATE;
  const taxable = gross - ssc;
  const pit = taxable * PIT_RATE;
  const totalTax = ssc + pit;
  const net = gross - totalTax;

  const { slices, year } = useMemo(() => {
    if (!cofog) return { slices: [] as Slice[], year: null as number | null };
    const yr = cofog.latestYear;
    const tot = cofog.series.TOTAL.find((p) => p.year === yr)?.valueEur ?? 0;
    if (tot <= 0) return { slices: [], year: yr };
    const rows: Slice[] = [];
    for (const code of COFOG_FUNCTIONS) {
      const v = cofog.series[code].find((p) => p.year === yr)?.valueEur ?? 0;
      if (v <= 0) continue;
      const share = v / tot;
      rows.push({ code, share, eur: totalTax * share });
    }
    rows.sort((a, b) => b.eur - a.eur);
    return { slices: rows, year: yr };
  }, [cofog, totalTax]);

  if (slices.length === 0) return null;

  const maxShare = slices[0]?.share ?? 0;

  return (
    <Card className="my-4" data-og="budget-tax-bill">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          {t("budget_tax_bill_title") || "What did your taxes buy?"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("budget_tax_bill_subtitle") ||
            "Pick a monthly gross salary. We apply Bulgaria's 10% income tax + 13.78% employee social-security contribution, then route the result through general-government spending shares."}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          <label className="flex items-baseline justify-between gap-3">
            <span className="text-sm">
              {t("budget_tax_bill_gross_label") || "Monthly gross salary"}
            </span>
            <span className="text-base font-semibold tabular-nums">
              {formatEur(gross)}
            </span>
          </label>
          <input
            type="range"
            min={MIN_GROSS}
            max={MAX_GROSS}
            step={STEP_GROSS}
            value={gross}
            onChange={(e) => setGross(Number(e.target.value))}
            className="w-full accent-indigo-500"
            aria-label={
              t("budget_tax_bill_gross_label") || "Monthly gross salary"
            }
          />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{formatEur(MIN_GROSS)}</span>
            <span>{formatEur(MAX_GROSS)}</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="text-muted-foreground">
              {t("budget_tax_bill_ssc") || "Social security (13.78%)"}
            </div>
            <div className="font-semibold tabular-nums">{formatEur(ssc)}</div>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="text-muted-foreground">
              {t("budget_tax_bill_pit") || "Income tax (10%)"}
            </div>
            <div className="font-semibold tabular-nums">{formatEur(pit)}</div>
          </div>
          <div className="rounded-md bg-indigo-500/10 px-2 py-1.5 ring-1 ring-indigo-500/20">
            <div className="text-muted-foreground">
              {t("budget_tax_bill_total") || "Total tax bill"}
            </div>
            <div className="font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
              {formatEur(totalTax)}
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          {(
            t("budget_tax_bill_routed_heading") ||
            "Where your €{{amount}}/month went, fiscal year {{year}}:"
          )
            .replace("{{amount}}", Math.round(totalTax).toString())
            .replace("{{year}}", year ? String(year) : "")}
        </div>

        <ul className="mt-1 space-y-1">
          {slices.map((s) => {
            const label = t(`cofog_${s.code}`) || COFOG_FALLBACK_EN[s.code];
            const widthPct = maxShare > 0 ? (s.share / maxShare) * 100 : 0;
            return (
              <li key={s.code} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {compactEur(s.eur)}
                  </span>
                </div>
                <div className="mt-0.5 h-1 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full rounded bg-indigo-500/60"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] text-muted-foreground/80 mt-3">
          {t("budget_tax_bill_caption") ||
            "Illustrative: applies current general-government spending shares to your monthly tax bill. Real social-security contributions are earmarked (pension + health + unemployment), not freely allocable to every function."}{" "}
          {(
            t("budget_tax_bill_net", { eur: "{{eur}}" }) ||
            "Net take-home after tax: {{eur}}/mo."
          ).replace("{{eur}}", formatEur(net))}
        </p>
      </CardContent>
    </Card>
  );
};
