// "Поръчките на НЗОК отблизо" — the ЗОП lens. НЗОК's public procurement is not a
// health budget: it is an IT-and-security operating budget dominated by one
// in-house integrator. This tile names that honestly — the IT share of ЗОП
// spend, the dominant supplier with its statutory-integrator context (so its
// no-competition awards read as a legal mandate, not a red flag), and the
// security/services tail. Pure from the NzokModel.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ScanSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { NZOK_SUPPLIER_CONTEXT, cleanSupplierName } from "@/lib/nzokBenchmarks";
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
  const topSupplier = model.suppliers[0] ?? null;
  const topShare = topSupplier ? topSupplier.totalEur / total : 0;
  const ctx = topSupplier ? NZOK_SUPPLIER_CONTEXT[topSupplier.eik] : undefined;

  const pctInt = (v: number) =>
    (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ScanSearch className="h-4 w-4" />
          {bg ? "Поръчките на НЗОК отблизо" : "НЗОК's procurement up close"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <p className="text-muted-foreground">
          {bg
            ? "Извън плащанията към болници, аптеки и лекари, обществените поръчки на НЗОК са предимно за информационни системи и охрана — а не за здравеопазване."
            : "Beyond payments to hospitals, pharmacies and doctors, НЗОК's public procurement is mostly information systems and security — not healthcare."}
        </p>

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

        {topSupplier && (
          <div className="rounded-md border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <Link
                to={`/company/${topSupplier.eik}`}
                className="font-medium hover:text-primary hover:underline"
              >
                {cleanSupplierName(topSupplier.name)}
              </Link>
              <span className="tabular-nums text-muted-foreground">
                {eur(topSupplier.totalEur)}
                <span className="ml-1 text-muted-foreground/70">
                  {pctInt(topShare)}%
                </span>
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {bg
                ? `водещ изпълнител · ${topSupplier.contractCount} договора`
                : `top supplier · ${topSupplier.contractCount} contracts`}
            </p>
            {ctx && (
              <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                {bg ? ctx.bg : ctx.en}
              </p>
            )}
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
