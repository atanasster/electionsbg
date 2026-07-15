// Shared "insight chips" builder for the sector packs. Every pack (roads, НОИ,
// НЗОК, ВСС, Култура, Води) rendered the same three auto-headline chips off its
// AwarderModel with a near-verbatim useMemo — this is the one place that logic
// lives now. It also fixes the quirk every copy shared: the top-category chip
// picked `categories.find(...)`, i.e. the first non-sink category in the
// classifier's DECLARED order, not the largest by €. Here it's the max by €.

import { formatEurCompact } from "@/lib/currency";
import type { AwarderModel, AwarderCategoryAgg } from "@/lib/awarderModel";

export interface PackInsight {
  text: string;
  warn?: boolean;
  /** Chip type, so a pack can turn the chip into a drill-down link. */
  kind?: "peak" | "category" | "direct";
  /** For kind:"peak" — the peak year (→ that year's contracts). */
  year?: number;
  /** For kind:"category" — the category id (→ CPV-filtered contracts). */
  categoryId?: string;
}

/** Build the peak-year / top-category / direct-award chips for a sector pack.
 *  `categoryLabel` maps a category id to its localized label; `sink` (default
 *  "other") is excluded from the top-category pick. Capped at 5. */
export const buildPackInsights = <Cat extends string>(
  model: AwarderModel<Cat> | null,
  categoryLabel: (id: Cat, lang: string) => string,
  lang: string,
  sink: Cat = "other" as Cat,
): PackInsight[] => {
  if (!model) return [];
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const out: PackInsight[] = [];

  // Peak year — only meaningful when the scope spans >1 year. For a single-year
  // (or partial-parliament) scope the "peak" is just the selected period, which
  // reads as noise, so it's suppressed.
  const yearsWithSpend = model.years.filter((y) => y.totalEur > 0);
  if (yearsWithSpend.length > 1) {
    const topYear = [...yearsWithSpend].sort(
      (a, b) => b.totalEur - a.totalEur || a.year - b.year,
    )[0];
    out.push({
      kind: "peak",
      year: topYear.year,
      text: `${topYear.year}: ${eur(topYear.totalEur)} — ${bg ? "пик" : "peak year"}`,
    });
  }

  // Largest classified function BY €, not by the classifier's declared order.
  const topCat = model.categories
    .filter((c) => c.totalEur > 0 && c.id !== sink)
    .reduce<AwarderCategoryAgg<Cat> | null>(
      (best, c) => (!best || c.totalEur > best.totalEur ? c : best),
      null,
    );
  if (topCat)
    out.push({
      kind: "category",
      categoryId: topCat.id,
      text: `${categoryLabel(topCat.id, lang)}: ${eur(topCat.totalEur)}`,
    });

  if (model.directShare > 0.05)
    out.push({
      kind: "direct",
      warn: model.directShare > 0.1,
      text: `${Math.round(model.directShare * 100)}% ${bg ? "без обявление" : "direct award"}`,
    });

  return out.slice(0, 5);
};
