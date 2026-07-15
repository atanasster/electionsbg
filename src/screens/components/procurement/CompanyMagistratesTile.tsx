// "Магистрати, декларирали това дружество" — the company-page counterpart to the
// /judiciary holdings tile. Shows any magistrate whose ИВСС declaration (чл. 175а
// ЗСВ) names THIS company (by EIK). Empty for almost every company, so it renders
// nothing unless there is a match.
//
// Framing (matches the judiciary tiles): magistrates are NOT elected officials. This
// reproduces only what the ИВСС publishes — a company name in a filed declaration,
// name-matched to the registry — a LEAD, not proof.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useCompanyMagistrates } from "@/data/judiciary/useMagistrateHoldings";

export const CompanyMagistratesTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { magistrates, year } = useCompanyMagistrates(eik);
  if (!magistrates.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {bg
            ? "Магистрати, декларирали това дружество"
            : "Magistrates who declared this company"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="divide-y rounded-lg border">
          {magistrates.map((m, i) => (
            <div
              key={`${m.name}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 p-2.5"
            >
              <div>
                <span className="text-sm font-medium">{m.name}</span>
                {(m.position || m.court) && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {[m.position, m.court].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {m.company}
                {m.stakePct != null ? ` · ${m.stakePct}%` : ""}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `Дружеството е посочено в декларация по чл. 175а ЗСВ за ${year ?? ""} г. Магистратите не са изборни лица; показва се само каквото публикува ИВСС, разпознато по име в Търговския регистър — следа, не доказателство.`
            : `This company is named in an art. 175a ЗСВ declaration for ${year ?? ""}. Magistrates are not elected officials; only what the ИВСС publishes is shown, name-matched to the Commerce Registry — a lead, not proof.`}
        </p>
      </CardContent>
    </Card>
  );
};
