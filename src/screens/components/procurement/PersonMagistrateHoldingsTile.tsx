// "Магистрат — данни от декларацията (ИВСС)" on the /person/:name page. If this
// person's name matches a magistrate in the latest-year ИВСС declaration roster
// (чл. 175а ЗСВ), show their court/position, informational financial figures, and any
// declared companies (linking to /company/:eik). Renders nothing when the match
// carries nothing displayable (no court, no financials, no company).
//
// Framing: magistrates are NOT elected officials, and this is a NAME match (a common
// name could collide), so it is a LEAD, not proof — stated in the caption.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Scale, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, BGN_PER_EUR } from "@/lib/currency";
import { usePersonMagistrateHoldings } from "@/data/judiciary/useMagistrateHoldings";

export const PersonMagistrateHoldingsTile: FC<{ name: string }> = ({
  name,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { holding, year } = usePersonMagistrateHoldings(name);
  if (!holding) return null;
  // The table now holds the FULL magistrate roster, so a matched record may carry
  // nothing displayable (no company, no non-zero financial, no recoverable court).
  // Don't render an all-but-empty card in that case.
  const f = holding.financials;
  const hasFinancials =
    !!f && (f.bankCashLv > 0 || f.securitiesLv > 0 || f.realEstateCount > 0);
  const hasContent =
    !!holding.court || hasFinancials || holding.companies.length > 0;
  if (!hasContent) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {bg
            ? "Магистрат — данни от декларацията (ИВСС)"
            : "Magistrate — declaration data (ИВСС)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {holding.court && (
          <div className="mb-2 text-xs text-muted-foreground">
            {[holding.position, holding.court].filter(Boolean).join(" · ")}
          </div>
        )}

        {(() => {
          if (!hasFinancials) return null;
          const eur = (lv: number) => formatEurCompact(lv / BGN_PER_EUR, lang);
          return (
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
              {f.bankCashLv > 0 && (
                <span>
                  {bg ? "Парични средства" : "Cash & deposits"}:{" "}
                  <span className="font-semibold tabular-nums">
                    {eur(f.bankCashLv)}
                  </span>
                </span>
              )}
              {f.securitiesLv > 0 && (
                <span>
                  {bg ? "Ценни книжа/дялове" : "Securities/shares"}:{" "}
                  <span className="font-semibold tabular-nums">
                    {eur(f.securitiesLv)}
                  </span>
                </span>
              )}
              {f.realEstateCount > 0 && (
                <span>
                  <span className="font-semibold tabular-nums">
                    {f.realEstateCount}
                  </span>{" "}
                  {bg ? "недвижими имота" : "properties"}
                </span>
              )}
            </div>
          );
        })()}

        <div className="flex flex-wrap gap-1.5">
          {holding.companies.map((c, i) => {
            const pct = c.stakePct != null ? ` · ${c.stakePct}%` : "";
            return c.eik ? (
              <Link
                key={`${c.name}-${i}`}
                to={`/company/${c.eik}`}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-foreground hover:bg-primary/20"
              >
                {c.name}
                {pct}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Link>
            ) : (
              <span
                key={`${c.name}-${i}`}
                className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {c.name}
                {pct}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `Данни от декларацията по чл. 175а ЗСВ за ${year ?? ""} г. Финансовите суми са ориентировъчни (извлечени автоматично от декларацията), а дружествата — разпознати по име. Следа, не доказателство; магистратите не са изборни лица.`
            : `From the person's art. 175a ЗСВ declaration for ${year ?? ""}. The financial amounts are approximate (auto-extracted from the declaration) and companies are name-matched. A lead, not proof; magistrates are not elected officials.`}
        </p>
      </CardContent>
    </Card>
  );
};
