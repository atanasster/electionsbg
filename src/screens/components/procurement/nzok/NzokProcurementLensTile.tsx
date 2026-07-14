// "Поръчките на НЗОК отблизо" — the ЗОП lens. НЗОК's public procurement is not a
// health budget: it is an operating budget (energy, IT, services/security)
// dominated by a few suppliers. This tile names that honestly — the intro cites
// the categories the current scope actually spends on, then the top suppliers,
// each with its statutory-integrator context where it applies (so an
// integrator's no-competition awards read as a legal mandate, not a red flag).
// Pure from the NzokModel.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ScanSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  NZOK_SUPPLIER_CONTEXT,
  categoryLabel,
  cleanSupplierName,
} from "@/lib/nzokBenchmarks";
import type { NzokModel } from "@/lib/nzokAttributes";

export const NzokProcurementLensTile: FC<{ model: NzokModel }> = ({
  model,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const total = model.totalEur;
  if (total <= 0) return null;

  const itCat = model.categories.find((c) => c.id === "it");
  const itShare = itCat ? itCat.totalEur / total : 0;
  const topSuppliers = model.suppliers.slice(0, 5);

  const pctInt = (v: number) =>
    (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 });

  // Name the categories НЗОК's procurement actually goes to in the current
  // scope, rather than asserting a fixed composition (it shifts by scope/year).
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const topCats = model.categories
    .filter((c) => c.id !== "other" && c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, 2)
    .map((c) => lower(categoryLabel(c.id, lang)));
  const catList = topCats.join(", ");
  const intro = bg
    ? catList
      ? `Извън плащанията към болници, аптеки и лекари, обществените поръчки на НЗОК са предимно за ${catList} — а не за здравеопазване.`
      : "Извън плащанията към болници, аптеки и лекари, обществените поръчки на НЗОК са за оперативни разходи, а не за здравеопазване."
    : catList
      ? `Beyond payments to hospitals, pharmacies and doctors, НЗОК's public procurement is mostly ${catList} — not healthcare.`
      : "Beyond payments to hospitals, pharmacies and doctors, НЗОК's public procurement covers operating costs, not healthcare.";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ScanSearch className="h-4 w-4" />
          {bg ? "Поръчките на НЗОК отблизо" : "НЗОК's procurement up close"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <p className="text-muted-foreground">{intro}</p>

        {itCat && itShare > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold tabular-nums">
                {eur(itCat.totalEur)}
              </span>
              <span className="text-muted-foreground">
                {bg
                  ? `(${pctInt(itShare)}% от поръчките) за ИТ и системи`
                  : `(${pctInt(itShare)}% of procurement) on IT & systems`}
              </span>
            </div>
          </div>
        )}

        {topSuppliers.length > 0 && (
          <div className="rounded-md border">
            <p className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {bg ? "Водещи изпълнители" : "Top suppliers"}
            </p>
            <ul className="divide-y">
              {topSuppliers.map((s, i) => {
                const ctx = NZOK_SUPPLIER_CONTEXT[s.eik];
                return (
                  <li key={s.eik} className="p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <Link
                        to={`/company/${s.eik}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        <span className="mr-1.5 text-muted-foreground/70 tabular-nums">
                          {i + 1}.
                        </span>
                        {cleanSupplierName(s.name)}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">
                        {eur(s.totalEur)}
                        <span className="ml-1 text-muted-foreground/70">
                          {pctInt(s.totalEur / total)}%
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {bg
                        ? `${s.contractCount} договора`
                        : `${s.contractCount} contract${s.contractCount === 1 ? "" : "s"}`}
                    </p>
                    {ctx && (
                      <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                        {bg ? ctx.bg : ctx.en}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Делове от договорената стойност на обществените поръчки (регистър АОП/ЦАИС ЕОП), не от бюджета на НЗОК."
            : "Shares of contracted public-procurement value (АОП/ЦАИС ЕОП register), not of the НЗОК budget."}
        </p>
      </CardContent>
    </Card>
  );
};
