// "Where do my taxes go" personalized receipt — Civio-style. The user
// enters their annual gross income; we compute their headline 10% flat
// personal income tax and split it across COFOG functional categories
// using the latest gov_10a_exp shares.
//
// Honest framing matters here:
//   - We model PERSONAL INCOME TAX only (the 10% flat rate). VAT, social
//     security contributions, and corporate tax are NOT included in the
//     user's number — they would dwarf personal income tax and make the
//     receipt huge but largely abstract.
//   - The COFOG allocation reflects total gov spending mix, not how each
//     individual ден is earmarked. It's a fair "if your contribution were
//     spent like the budget overall" model.
//   - We surface the latest-year COFOG ratios; the data file refreshes
//     annually via update-macro.
//
// This is a tool — not a tile that derives from the area context — but it
// belongs on the My-Area page because the page is the "civic dashboard"
// landing surface. Mounted as an expandable section so it doesn't
// dominate the page by default.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { dataUrl } from "@/data/dataUrl";

const PERSONAL_INCOME_TAX_RATE = 0.1; // BG flat 10%

type CofogSeriesPoint = { year: number; valueEur: number };
type CofogFile = {
  latestYear: number;
  cofogTopLevel: string[];
  series: Record<string, CofogSeriesPoint[]>;
};

// COFOG codes → display labels. Lazy-loaded inside the function so locale
// switches re-render with the right copy.
const cofogLabel = (
  code: string,
  lang: "bg" | "en",
): { label: string; color: string } => {
  const m: Record<string, { bg: string; en: string; color: string }> = {
    GF01: {
      bg: "Общи държавни услуги",
      en: "General public services",
      color: "#8E8E93",
    },
    GF02: { bg: "Отбрана", en: "Defence", color: "#7B5E57" },
    GF03: {
      bg: "Обществен ред и сигурност",
      en: "Public order and safety",
      color: "#5A5A5A",
    },
    GF04: {
      bg: "Икономическа политика",
      en: "Economic affairs",
      color: "#5E8AC7",
    },
    GF05: {
      bg: "Околна среда",
      en: "Environmental protection",
      color: "#56A86F",
    },
    GF06: {
      bg: "Жилищно стр-во и комун.",
      en: "Housing and community",
      color: "#A6792F",
    },
    GF07: { bg: "Здравеопазване", en: "Health", color: "#D74A56" },
    GF08: {
      bg: "Култура, спорт, религия",
      en: "Recreation, culture, religion",
      color: "#C97AAA",
    },
    GF09: { bg: "Образование", en: "Education", color: "#3D8DBA" },
    GF10: {
      bg: "Социална защита",
      en: "Social protection",
      color: "#E08F2C",
    },
  };
  const entry = m[code];
  if (!entry) return { label: code, color: "#888" };
  return { label: entry[lang], color: entry.color };
};

const formatBgn = (n: number, lang: "bg" | "en"): string => {
  const fmt = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  });
  const num = fmt.format(Math.round(n));
  return lang === "bg" ? `${num} лв.` : `BGN ${num}`;
};

const fetchCofog = async (): Promise<CofogFile> => {
  const r = await fetch(dataUrl("/cofog.json"));
  if (!r.ok) throw new Error("cofog fetch failed");
  return r.json();
};

export const MyAreaTaxReceiptTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const [expanded, setExpanded] = useState(false);
  const [income, setIncome] = useState<string>("");
  const { data: cofog } = useQuery({
    queryKey: ["cofog"],
    queryFn: fetchCofog,
    staleTime: Infinity,
    // Only fetch once the user expands the section — the receipt is gated
    // behind a click anyway, so the COFOG payload (~30 KB gzipped) stays
    // off the critical path for everyone who doesn't open it.
    enabled: expanded,
  });

  // Compute allocation. TOTAL is the denominator; each GF0n category gives
  // its share. Filter to non-zero categories and sort by share descending.
  const allocation = useMemo(() => {
    if (!cofog) return null;
    const latest = cofog.latestYear;
    const totalSeries = cofog.series["TOTAL"];
    const total = totalSeries?.find((p) => p.year === latest)?.valueEur ?? 0;
    if (total === 0) return null;
    const rows: Array<{ code: string; share: number }> = [];
    for (const code of cofog.cofogTopLevel) {
      if (code === "TOTAL") continue;
      const s = cofog.series[code];
      const v = s?.find((p) => p.year === latest)?.valueEur ?? 0;
      if (v <= 0) continue;
      rows.push({ code, share: v / total });
    }
    rows.sort((a, b) => b.share - a.share);
    return { year: latest, rows };
  }, [cofog]);

  const parsedIncome = (() => {
    const n = Number(income.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const tax = parsedIncome * PERSONAL_INCOME_TAX_RATE;

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center gap-2 text-left"
      >
        <Calculator className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_tax_receipt_title")}
        </h2>
        {expanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {expanded ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("my_area_tax_receipt_explainer")}
          </p>
          <div className="flex items-center gap-2">
            <label
              htmlFor="myarea-tax-income"
              className="text-sm whitespace-nowrap"
            >
              {t("my_area_tax_receipt_income_label")}
            </label>
            <input
              id="myarea-tax-income"
              type="number"
              inputMode="numeric"
              min={0}
              step={500}
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="24000"
              className="flex-1 border rounded px-2 py-1 text-sm bg-background"
            />
            <span className="text-xs text-muted-foreground">
              {lang === "bg" ? "лв./год" : "BGN/yr"}
            </span>
          </div>
          {parsedIncome > 0 ? (
            <>
              <div className="text-sm">
                {t("my_area_tax_receipt_income_label")}:{" "}
                <span className="font-semibold">
                  {formatBgn(parsedIncome, lang)}
                </span>{" "}
                · {lang === "bg" ? "данък общ доход (10%)" : "income tax (10%)"}
                : <span className="font-semibold">{formatBgn(tax, lang)}</span>
              </div>
              {allocation ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    {lang === "bg"
                      ? `Разпределение според бюджет ${allocation.year}:`
                      : `Allocated per ${allocation.year} budget mix:`}
                  </p>
                  {allocation.rows.map((r) => {
                    const { label, color } = cofogLabel(r.code, lang);
                    const amount = tax * r.share;
                    return (
                      <div
                        key={r.code}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                          aria-hidden
                        />
                        <span className="flex-1 truncate" title={label}>
                          {label}
                        </span>
                        <span className="tabular-nums shrink-0 font-medium">
                          {formatBgn(amount, lang)}
                        </span>
                        <span className="tabular-nums text-muted-foreground shrink-0 text-[10px] w-10 text-right">
                          {(r.share * 100).toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {t("my_area_tax_receipt_loading")}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2 italic">
                {t("my_area_tax_receipt_disclaimer")}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("my_area_tax_receipt_prompt")}
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
};
