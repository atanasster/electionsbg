// Drill-down panel for the budget-flow Sankey's LEFT-side revenue wedges.
// Mirrors `BudgetFlowPersonnelDrilldown` (right-side Персонал drill-down) but
// dispatches to one of four sub-views by the clicked wedge:
//
//   – VAT (Данък върху добавената стойност) → declared net by КИД-2008 sector
//     from НАП Table 3 (2024 only; net-refund sectors highlighted).
//   – Excise (Акцизи) → product split from Митница (fuels deep + tobacco +
//     alcohol; 2025 deep, older years top-level only).
//   – Customs (Мита и митнически такси) → top-5 country of origin from
//     Митница (2022-2025).
//   – PIT (Данъци в/у доходите на физически лица) → income-type split from
//     НАП Tables 8/10 + narrative; 2024 only.
//
// Year fallback: if the selected fiscal year has no breakdown JSON, falls
// back to the most recent year that does (same logic as the personnel
// drill-down).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowDownRight,
  ChevronDown,
  Coins,
  TrendingUp,
  X,
} from "lucide-react";
import { formatEur } from "@/lib/currency";
import {
  useCustomsBreakdown,
  usePitBreakdown,
  useVatBreakdown,
} from "@/data/budget/useBudget";
import type { KfpSnapshot } from "@/data/budget/types";

export type RevenueDrillCategory = "vat" | "excise" | "customs" | "pit";

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000)
    return `${sign}€${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

// Defensive label fallback — when EN is selected but a row's labelEn is
// empty (some НСИ codes ship without translation), fall through to BG.
const labelFor = (
  l: { labelBg: string; labelEn: string },
  lang: "bg" | "en",
): string => (lang === "en" && l.labelEn ? l.labelEn : l.labelBg);

// --- KFP-wedge lookups (used by every sub-view for the coverage banner) ---

const KFP_LABEL_BG: Record<RevenueDrillCategory, RegExp> = {
  vat: /^Данък върху добавената стойност$/i,
  excise: /^Акцизи$/i,
  customs: /^Мита/i,
  pit: /доходите.*физически/i,
};

const sankeyWedgeEur = (
  snapshot: KfpSnapshot,
  category: RevenueDrillCategory,
): number | null => {
  const rev = snapshot.sections.find((s) => s.series === "revenue");
  const re = KFP_LABEL_BG[category];
  const row = rev?.lines.find((l) => re.test(l.labelBg));
  return row?.executed?.amountEur ?? row?.planned?.amountEur ?? null;
};

// --- The shared panel shell ---

interface CategoryMeta {
  titleBg: string;
  titleEn: string;
  icon: typeof Coins;
}

const CATEGORY_META: Record<RevenueDrillCategory, CategoryMeta> = {
  vat: { titleBg: "ДДС → по сектори", titleEn: "VAT → by sector", icon: Coins },
  excise: {
    titleBg: "Акциз → по продуктови групи",
    titleEn: "Excise → by product group",
    icon: Coins,
  },
  customs: {
    titleBg: "Мита → по страна на произход",
    titleEn: "Customs duties → by country of origin",
    icon: Coins,
  },
  pit: {
    titleBg: "ДДФЛ → по вид доход",
    titleEn: "Personal income tax → by income type",
    icon: Coins,
  },
};

export const BudgetFlowRevenueDrilldown: FC<{
  fiscalYear: number;
  snapshot: KfpSnapshot;
  category: RevenueDrillCategory;
  onClose: () => void;
}> = ({ fiscalYear, snapshot, category, onClose }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language.startsWith("bg") ? "bg" : "en";
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const wedgeEur = sankeyWedgeEur(snapshot, category);

  return (
    <div className="rounded-md border bg-muted/30 p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4" />
          {lang === "bg" ? meta.titleBg : meta.titleEn}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
          aria-label={lang === "bg" ? "Затвори" : "Close"}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {category === "vat" && (
        <VatDrilldownBody
          fiscalYear={fiscalYear}
          lang={lang}
          wedgeEur={wedgeEur}
        />
      )}
      {category === "excise" && (
        <ExciseDrilldownBody
          fiscalYear={fiscalYear}
          lang={lang}
          wedgeEur={wedgeEur}
        />
      )}
      {category === "customs" && (
        <CustomsDrilldownBody
          fiscalYear={fiscalYear}
          lang={lang}
          wedgeEur={wedgeEur}
        />
      )}
      {category === "pit" && (
        <PitDrilldownBody
          fiscalYear={fiscalYear}
          lang={lang}
          wedgeEur={wedgeEur}
        />
      )}
    </div>
  );
};

// ============================================================================
// VAT sub-view
// ============================================================================

const VatDrilldownBody: FC<{
  fiscalYear: number;
  lang: "bg" | "en";
  wedgeEur: number | null;
}> = ({ fiscalYear, lang, wedgeEur }) => {
  const { data } = useVatBreakdown(fiscalYear);
  // Only 2024 VAT is ingested today. When the selected year's file 404s
  // (data === null), fetch the canonical fallback — but only if the selected
  // year wasn't ALREADY the fallback (avoid a duplicate query for the same
  // year). Disabled while the primary is still loading (data === undefined).
  const fallbackYear = 2024;
  const { data: fallback } = useVatBreakdown(
    data === null && fiscalYear !== fallbackYear ? fallbackYear : undefined,
  );
  const file = data ?? fallback ?? null;

  const sorted = useMemo(
    () =>
      file
        ? [...file.sectors].sort(
            (a, b) => (b.declaredNet ?? 0) - (a.declaredNet ?? 0),
          )
        : [],
    [file],
  );

  if (!file) return null;
  const total = file.declaredNetEur ?? 0;
  const coverage = wedgeEur != null && wedgeEur > 0 ? total / wedgeEur : null;
  const refunders = sorted.filter((s) => (s.declaredNet ?? 0) < 0);
  const top = sorted[0];

  return (
    <>
      {/* Insight callout */}
      <div className="mb-2 text-xs">
        <span className="font-medium">
          {lang === "bg" ? "Кратко: " : "TL;DR: "}
        </span>
        {top && (
          <span>
            {lang === "bg" ? (
              <>
                Сектор <strong>{top.labelBg}</strong> формира{" "}
                <strong>{((top.share ?? 0) * 100).toFixed(0)}%</strong> от
                декларирания нетен ДДС.
              </>
            ) : (
              <>
                Sector <strong>{top.labelEn}</strong> generates{" "}
                <strong>{((top.share ?? 0) * 100).toFixed(0)}%</strong> of
                declared net VAT.
              </>
            )}
          </span>
        )}
        {refunders.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400 ml-1">
            <ArrowDownRight className="inline h-3 w-3 -mt-0.5" />{" "}
            {lang === "bg"
              ? `${refunders.length} сектор(а) са нетни получатели на възстановен ДДС`
              : `${refunders.length} sector(s) are net VAT refund recipients`}
            {refunders.length <= 2 && (
              <>
                {" — "}
                {refunders.map((r) => labelFor(r, lang)).join(", ")}
              </>
            )}
            .
          </span>
        )}
      </div>
      {coverage != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {lang === "bg"
            ? `Покритие: ${compactEur(total)} от ${compactEur(wedgeEur!)} (${(coverage * 100).toFixed(1)}%) от линията „ДДС" в КФП. Източник — НАП декларации (нето), Таблица № 3. Разликата спрямо паричните постъпления е тайминг + ДДС при внос (Митница, отделен ред).`
            : `Coverage: ${compactEur(total)} of ${compactEur(wedgeEur!)} (${(coverage * 100).toFixed(1)}%) of the KFP VAT line. Source = NRA declared net (Table 3). The gap vs. cash is timing + import VAT (Митница, separate row).`}
        </div>
      )}
      <div className="space-y-1">
        {sorted.map((s) => {
          const sharePct = (s.share ?? 0) * 100;
          const isNegative = (s.declaredNet ?? 0) < 0;
          return (
            <div
              key={s.id}
              className="grid grid-cols-[24px_1fr_auto_auto] items-baseline gap-3 px-2 py-1 text-xs"
            >
              <span className="font-mono text-muted-foreground">{s.id}</span>
              <span className="truncate">{labelFor(s, lang)}</span>
              <span
                className={`tabular-nums font-medium ${isNegative ? "text-amber-600 dark:text-amber-400" : ""}`}
              >
                {compactEur(s.declaredNetEur ?? 0)}
              </span>
              <span className="tabular-nums text-muted-foreground w-14 text-right">
                {sharePct >= 0.1 || sharePct <= -0.1
                  ? `${sharePct > 0 ? "" : ""}${sharePct.toFixed(1)}%`
                  : ""}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {lang === "bg"
          ? `Източник: НАП „Годишен отчет за дейността" ${file.fiscalYear} г., Таблица № 3 — деклариран нетен ДДС (за внасяне минус за възстановяване). Отрицателните сектори са нетни получатели на възстановен ДДС (типично износители, селско стопанство).`
          : `Source: NRA Annual Activity Report ${file.fiscalYear}, Table 3 — declared net VAT (to-pay minus to-refund). Negative sectors are net refund recipients (typically exporters, agriculture).`}
      </p>
    </>
  );
};

// ============================================================================
// Excise sub-view
// ============================================================================

const ExciseDrilldownBody: FC<{
  fiscalYear: number;
  lang: "bg" | "en";
  wedgeEur: number | null;
}> = ({ fiscalYear, lang, wedgeEur }) => {
  const { data } = useCustomsBreakdown(fiscalYear);
  // Fall back to 2025 (latest year with deep product split) only when the
  // selected year's file 404s AND it isn't already 2025 — same logic as VAT.
  const { data: fb2025 } = useCustomsBreakdown(
    data === null && fiscalYear !== 2025 ? 2025 : undefined,
  );
  const file = data ?? fb2025 ?? null;

  // Two-level tree: excise_total → (fuels, tobacco, alcohol) →
  //                  (diesel, petrol, lpg, natural_gas, kerosene) under fuels.
  const tree = useMemo(() => {
    if (!file) return [];
    const lines = file.lines;
    const byId = new Map(lines.map((l) => [l.id, l]));
    const exciseTotal = byId.get("excise_total");
    if (!exciseTotal) return [];
    const children = lines.filter((l) => l.parent === "excise_total");
    return children
      .filter((c) => (c.amountEur ?? 0) > 0)
      .sort((a, b) => (b.amountEur ?? 0) - (a.amountEur ?? 0))
      .map((c) => ({
        line: c,
        sub: lines
          .filter((l) => l.parent === c.id && (l.amountEur ?? 0) > 0)
          .sort((a, b) => (b.amountEur ?? 0) - (a.amountEur ?? 0)),
      }));
  }, [file]);

  if (!file || tree.length === 0) return null;
  const exciseTotal =
    file.lines.find((l) => l.id === "excise_total")?.amountEur ?? null;
  const fuels = tree.find((g) => g.line.id === "excise_fuels");
  const tobacco = tree.find((g) => g.line.id === "excise_tobacco");

  return (
    <>
      <div className="mb-2 text-xs">
        <span className="font-medium">
          {lang === "bg" ? "Кратко: " : "TL;DR: "}
        </span>
        {tobacco && exciseTotal && (
          <span>
            {lang === "bg"
              ? `Тютюневи изделия формират ${(((tobacco.line.amountEur ?? 0) / exciseTotal) * 100).toFixed(0)}% от акциза`
              : `Tobacco generates ${(((tobacco.line.amountEur ?? 0) / exciseTotal) * 100).toFixed(0)}% of all excise`}
          </span>
        )}
        {fuels && exciseTotal && (
          <span>
            {lang === "bg" ? "; горивата" : "; fuels"}{" "}
            {(((fuels.line.amountEur ?? 0) / exciseTotal) * 100).toFixed(0)}%
            {fuels.sub.length > 0 && (
              <> {lang === "bg" ? "(основно газьол)" : "(mostly diesel)"}</>
            )}
            .
          </span>
        )}
      </div>
      {exciseTotal != null && wedgeEur != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {lang === "bg"
            ? `Покритие: ${compactEur(exciseTotal)} от ${compactEur(wedgeEur)} (${((exciseTotal / wedgeEur) * 100).toFixed(1)}%) от линията „Акцизи" в КФП.`
            : `Coverage: ${compactEur(exciseTotal)} of ${compactEur(wedgeEur)} (${((exciseTotal / wedgeEur) * 100).toFixed(1)}%) of the KFP excise line.`}
        </div>
      )}
      <div className="space-y-1">
        {tree.map((g) => (
          <div key={g.line.id}>
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 px-2 py-1 text-xs bg-muted/40 rounded">
              <span className="font-medium">{labelFor(g.line, lang)}</span>
              <span className="tabular-nums font-medium">
                {compactEur(g.line.amountEur ?? 0)}
              </span>
              <span className="tabular-nums text-muted-foreground w-14 text-right">
                {exciseTotal
                  ? `${(((g.line.amountEur ?? 0) / exciseTotal) * 100).toFixed(1)}%`
                  : ""}
              </span>
            </div>
            {g.sub.length > 0 && (
              <div className="ml-3 mt-0.5 space-y-0.5">
                {g.sub.map((s) => (
                  <div
                    key={s.id}
                    className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    <span className="truncate">↳ {labelFor(s, lang)}</span>
                    <span className="tabular-nums">
                      {compactEur(s.amountEur ?? 0)}
                    </span>
                    <span className="tabular-nums w-14 text-right">
                      {g.line.amountEur
                        ? `${(((s.amountEur ?? 0) / g.line.amountEur) * 100).toFixed(0)}%`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {lang === "bg"
          ? `Източник: Агенция „Митници" — „Митническа хроника" ${file.fiscalYear} г. Продуктова разбивка на горивата е налична само за 2025 г.`
          : `Source: Bulgarian Customs Agency — "Митническа хроника" ${file.fiscalYear}. Fuel sub-product detail available for 2025 only.`}
      </p>
    </>
  );
};

// ============================================================================
// Customs sub-view (with 4-year share trend)
// ============================================================================

const CUSTOMS_YEARS = [2022, 2023, 2024, 2025];

const CustomsDrilldownBody: FC<{
  fiscalYear: number;
  lang: "bg" | "en";
  wedgeEur: number | null;
}> = ({ fiscalYear, lang, wedgeEur }) => {
  const { data } = useCustomsBreakdown(fiscalYear);
  // Fall back to 2025 only when the selected year's file 404s AND it isn't
  // already 2025 — same logic as VAT/excise/PIT.
  const { data: fb2025 } = useCustomsBreakdown(
    data === null && fiscalYear !== 2025 ? 2025 : undefined,
  );
  const file = data ?? fb2025 ?? null;
  // Pre-fetch all 4 years for the trend; only one used for the list.
  const fp2022 = useCustomsBreakdown(2022);
  const fp2023 = useCustomsBreakdown(2023);
  const fp2024 = useCustomsBreakdown(2024);
  const fp2025 = useCustomsBreakdown(2025);
  const yearFiles = useMemo<Record<number, typeof file>>(
    () => ({
      2022: fp2022.data ?? null,
      2023: fp2023.data ?? null,
      2024: fp2024.data ?? null,
      2025: fp2025.data ?? null,
    }),
    [fp2022.data, fp2023.data, fp2024.data, fp2025.data],
  );

  const customsTotalEur =
    file?.lines.find((l) => l.id === "customs_duties_total")?.amountEur ?? null;
  const top = file?.customsByCountry[0] ?? null;
  const trendByCountry = useMemo(() => {
    const names = new Set<string>();
    for (const y of CUSTOMS_YEARS) {
      for (const c of yearFiles[y]?.customsByCountry ?? []) names.add(c.name);
    }
    return [...names].map((name) => ({
      name,
      shares: CUSTOMS_YEARS.map(
        (y) =>
          (yearFiles[y]?.customsByCountry ?? []).find((c) => c.name === name)
            ?.sharePct ?? null,
      ),
    }));
  }, [yearFiles]);

  if (!file) return null;

  return (
    <>
      <div className="mb-2 text-xs">
        <span className="font-medium">
          {lang === "bg" ? "Кратко: " : "TL;DR: "}
        </span>
        {top && (
          <span>
            {lang === "bg"
              ? `Внос от ${top.name} формира ${top.sharePct.toFixed(0)}% от събраните мита`
              : `Imports from ${top.name} account for ${top.sharePct.toFixed(0)}% of customs duties`}
          </span>
        )}
        {(() => {
          // Look up China share change 2022 → latest
          const china2022 = yearFiles[2022]?.customsByCountry.find((c) =>
            /Китай|China/.test(c.name),
          )?.sharePct;
          const chinaLatest = yearFiles[2025]?.customsByCountry.find((c) =>
            /Китай|China/.test(c.name),
          )?.sharePct;
          if (china2022 == null || chinaLatest == null) return null;
          const delta = chinaLatest - china2022;
          if (Math.abs(delta) < 2) return null;
          return (
            <span className="text-blue-600 dark:text-blue-400">
              <TrendingUp className="inline h-3 w-3 -mt-0.5 ml-1" />{" "}
              {lang === "bg"
                ? `Делът на Китай нараства от ${china2022.toFixed(0)}% (2022) на ${chinaLatest.toFixed(0)}% (2025)`
                : `China's share rose from ${china2022.toFixed(0)}% (2022) to ${chinaLatest.toFixed(0)}% (2025)`}
              .
            </span>
          );
        })()}
      </div>
      {customsTotalEur != null && wedgeEur != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {lang === "bg"
            ? `Покритие: 100% — сверява се точно с линията „Мита" в КФП (${compactEur(customsTotalEur)}).`
            : `Coverage: 100% — reconciles exactly to the KFP customs line (${compactEur(customsTotalEur)}).`}
        </div>
      )}
      {/* Top-5 list */}
      <div className="space-y-1 mb-3">
        {file.customsByCountry.map((c) => (
          <div
            key={c.name}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 px-2 py-1 text-xs"
          >
            <span className="truncate">{c.name}</span>
            <span className="tabular-nums font-medium">
              {compactEur(c.amountEur)}
            </span>
            <span className="tabular-nums text-muted-foreground w-14 text-right">
              {c.sharePct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      {/* 4-year trend */}
      <div className="mt-3 pt-2 border-t border-border/50">
        <div className="text-[11px] font-medium text-muted-foreground mb-1">
          {lang === "bg"
            ? "Дял от митата по години (%)"
            : "Share of customs duties by year (%)"}
        </div>
        <div className="grid grid-cols-[1fr_repeat(4,auto)] items-baseline gap-x-3 gap-y-0.5 text-[11px]">
          <span />
          {CUSTOMS_YEARS.map((y) => (
            <span
              key={y}
              className="tabular-nums text-muted-foreground w-10 text-right"
            >
              {y}
            </span>
          ))}
          {trendByCountry.map((c) => (
            <div key={c.name} className="contents">
              <span className="truncate">{c.name}</span>
              {c.shares.map((s, i) => (
                <span
                  key={i}
                  className="tabular-nums w-10 text-right text-muted-foreground"
                >
                  {s != null ? `${s.toFixed(0)}%` : "—"}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {lang === "bg"
          ? `Източник: Агенция „Митници" — „Митническа хроника" ${file.fiscalYear} г. Само топ-5 страни на произход; сумарно ~75% от митата (останалите се разпределят между още ~30 държави).`
          : `Source: Bulgarian Customs Agency — "Митническа хроника" ${file.fiscalYear}. Top-5 countries only; together ~75% of customs duties (the remainder is spread across ~30 other countries).`}
      </p>
    </>
  );
};

// ============================================================================
// PIT sub-view (with by-sector toggle)
// ============================================================================

const PitDrilldownBody: FC<{
  fiscalYear: number;
  lang: "bg" | "en";
  wedgeEur: number | null;
}> = ({ fiscalYear, lang, wedgeEur }) => {
  const { data } = usePitBreakdown(fiscalYear);
  // Fall back to 2024 (only ingested year) when selected year 404s.
  const { data: fb2024 } = usePitBreakdown(
    data === null && fiscalYear !== 2024 ? 2024 : undefined,
  );
  const file = data ?? fb2024 ?? null;
  const [view, setView] = useState<"income" | "sector">("income");
  // Hooks must be called unconditionally — sortedSectors falls through to
  // an empty array when `file` is null, before the early-return guard.
  const sectorList = useMemo(
    () =>
      file
        ? [...file.bySector.sectors].sort(
            (a, b) => (b.amountEur ?? 0) - (a.amountEur ?? 0),
          )
        : [],
    [file],
  );

  if (!file) return null;
  const topLines = file.lines.filter((l) => l.parent === null);
  const incomeTotalEur = file.totalEur ?? 0;
  const employment = topLines.find((l) => l.id === "pit_employment_net");
  const final = topLines.find((l) => l.id === "pit_final_tax");

  return (
    <>
      {/* Insight callout */}
      <div className="mb-2 text-xs">
        <span className="font-medium">
          {lang === "bg" ? "Кратко: " : "TL;DR: "}
        </span>
        {employment && incomeTotalEur > 0 && (
          <span>
            {lang === "bg"
              ? `Трудови правоотношения формират ${(((employment.amountEur ?? 0) / incomeTotalEur) * 100).toFixed(0)}% от ДДФЛ`
              : `Employment income generates ${(((employment.amountEur ?? 0) / incomeTotalEur) * 100).toFixed(0)}% of PIT`}
          </span>
        )}
        {final && incomeTotalEur > 0 && (
          <span>
            {lang === "bg"
              ? "; окончателен данък + дивиденти"
              : "; final tax + dividends"}{" "}
            {(((final.amountEur ?? 0) / incomeTotalEur) * 100).toFixed(0)}%.
          </span>
        )}
      </div>
      {wedgeEur != null && incomeTotalEur > 0 && (
        <div className="mb-2 text-xs text-muted-foreground">
          <AlertTriangle className="inline h-3 w-3 -mt-0.5 mr-1 text-amber-600 dark:text-amber-400" />
          {lang === "bg"
            ? `Покритие: ${compactEur(incomeTotalEur)} от ${compactEur(wedgeEur)} (${((incomeTotalEur / wedgeEur) * 100).toFixed(0)}%) от линията „ДДФЛ" в КФП. Разликата (~${compactEur(wedgeEur - incomeTotalEur)}) е патентен данък (общини) + други видове доход извън НАП.`
            : `Coverage: ${compactEur(incomeTotalEur)} of ${compactEur(wedgeEur)} (${((incomeTotalEur / wedgeEur) * 100).toFixed(0)}%) of the KFP PIT line. Gap (~${compactEur(wedgeEur - incomeTotalEur)}) = patent tax (municipal) + other income types collected outside NRA.`}
        </div>
      )}
      {/* View toggle */}
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setView("income")}
          className={`text-xs rounded px-2 py-0.5 border ${view === "income" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
        >
          {lang === "bg" ? "По вид доход" : "By income type"}
        </button>
        <button
          type="button"
          onClick={() => setView("sector")}
          className={`text-xs rounded px-2 py-0.5 border ${view === "sector" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
        >
          {lang === "bg" ? "По сектор (януари-ноември)" : "By sector (Jan-Nov)"}
        </button>
      </div>
      {view === "income" ? (
        <div className="space-y-1">
          {topLines.map((l) => (
            <div key={l.id}>
              <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 px-2 py-1 text-xs bg-muted/40 rounded">
                <span className="font-medium">{labelFor(l, lang)}</span>
                <span className="tabular-nums font-medium">
                  {compactEur(l.amountEur ?? 0)}
                </span>
                <span className="tabular-nums text-muted-foreground w-14 text-right">
                  {incomeTotalEur
                    ? `${(((l.amountEur ?? 0) / incomeTotalEur) * 100).toFixed(0)}%`
                    : ""}
                </span>
              </div>
              {/* Children (payment-type breakdown) */}
              <div className="ml-3 mt-0.5 space-y-0.5">
                {file.lines
                  .filter((c) => c.parent === l.id)
                  .map((c) => (
                    <div
                      key={c.id}
                      className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      <span className="truncate">↳ {labelFor(c, lang)}</span>
                      <span className="tabular-nums">
                        {compactEur(c.amountEur ?? 0)}
                      </span>
                      <span className="tabular-nums w-14 text-right">
                        {l.amount && c.amount
                          ? `${((c.amount / l.amount) * 100).toFixed(0)}%`
                          : ""}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mb-1 text-[11px] text-muted-foreground">
            {lang === "bg"
              ? "Дължими ДДФЛ вноски от работодатели по сектори, януари-ноември."
              : "Employer-reported PIT due contributions by sector, Jan-Nov."}
          </div>
          <div className="space-y-0.5">
            {sectorList.slice(0, 12).map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[24px_1fr_auto_auto] items-baseline gap-3 px-2 py-0.5 text-xs"
              >
                <span className="font-mono text-muted-foreground">{s.id}</span>
                <span className="truncate">{labelFor(s, lang)}</span>
                <span className="tabular-nums font-medium">
                  {compactEur(s.amountEur ?? 0)}
                </span>
                <span className="tabular-nums text-muted-foreground w-12 text-right">
                  {s.share != null ? `${(s.share * 100).toFixed(1)}%` : ""}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {lang === "bg"
          ? `Източник: НАП „Годишен отчет за дейността" ${file.fiscalYear} г., Таблици № 8/10 (вид доход) и № 9 (сектор). Покритието на КФП е частично — патентен данък и общински приходи не минават през НАП.`
          : `Source: NRA Annual Activity Report ${file.fiscalYear}, Tables 8/10 (income type) and 9 (sector). KFP coverage is partial — patent tax + municipal collections don't flow through NRA.`}
      </p>
    </>
  );
};

// ============================================================================
// Trigger button — dropdown menu near the Sankey legend
// ============================================================================

export const BudgetFlowRevenueTrigger: FC<{
  open: RevenueDrillCategory | null;
  onSelect: (category: RevenueDrillCategory | null) => void;
}> = ({ open, onSelect }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language.startsWith("bg") ? "bg" : "en";
  const [menuOpen, setMenuOpen] = useState(false);
  const options: { key: RevenueDrillCategory; label: string }[] = [
    {
      key: "vat",
      label: lang === "bg" ? "ДДС по сектори" : "VAT by sector",
    },
    {
      key: "excise",
      label: lang === "bg" ? "Акциз по продукти" : "Excise by product",
    },
    {
      key: "customs",
      label: lang === "bg" ? "Мита по страни" : "Customs by country",
    },
    {
      key: "pit",
      label:
        lang === "bg" ? "ДДФЛ по доход / сектор" : "PIT by income / sector",
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-muted/50"
      >
        <Coins className="h-3 w-3" />
        {lang === "bg" ? "Откъде идват приходите" : "Where revenue comes from"}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>
      {menuOpen && (
        <div
          className="absolute left-0 top-full mt-1 z-10 min-w-[200px] rounded-md border bg-popover p-1 shadow-md"
          onMouseLeave={() => setMenuOpen(false)}
        >
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onSelect(open === o.key ? null : o.key);
                setMenuOpen(false);
              }}
              className={`block w-full text-left rounded px-2 py-1 text-xs hover:bg-muted ${
                open === o.key ? "bg-muted font-medium" : ""
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
