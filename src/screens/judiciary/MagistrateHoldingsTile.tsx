// Магистрати с декларирани дружества — the first surface that joins the judiciary to
// the company graph. Lists magistrates whose ИВСС declaration (чл. 175а ЗСВ) names a
// commercial company; a resolved company links to its /company/:eik page.
//
// Framing (baked in, matches the declarations tiles): magistrates are NOT elected
// officials. We reproduce only what the ИВСС publishes — that a company name appears
// in a filed declaration — name-matched to the Commerce Registry. A LEAD, not proof:
// an unresolved or ambiguous name is shown as text, never invented into a link.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMagistrateOverview } from "@/data/judiciary/useMagistrateHoldings";

const TOP = 8;

export const MagistrateHoldingsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  // Server returns the top-N already ranked by declared-company count. The tile shows
  // 8; "виж всички" is a LINK to the standalone browse table (no in-tile scroll list).
  const { data } = useMagistrateOverview(TOP);
  if (!data || !data.magistrates.length) return null;
  const shown = data.magistrates;
  const total = data.stats.withHoldings;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {bg
            ? "Магистрати с декларирани дружества"
            : "Magistrates with declared companies"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {bg
            ? `${data.stats.withHoldings} магистрати са посочили търговско дружество в декларацията си по чл. 175а ЗСВ за ${data.year} г. (от ${data.stats.magistratesScanned} проверени). Дружествата са разпознати по име в Търговския регистър — връзката е следа, не доказателство.`
            : `${data.stats.withHoldings} magistrates named a commercial company in their ${data.year} declaration under art. 175a ЗСВ (of ${data.stats.magistratesScanned} scanned). Companies are name-matched to the Commerce Registry — a lead, not proof.`}
        </p>

        <div className="divide-y rounded-lg border">
          {shown.map((m) => (
            <div key={m.name} className="p-2.5">
              <Link
                to={`/person/${encodeURIComponent(m.name)}`}
                className="text-sm font-medium hover:text-primary hover:underline"
              >
                {m.name}
              </Link>
              {(m.position || m.court) && (
                <div className="text-xs text-muted-foreground">
                  {[m.position, m.court].filter(Boolean).join(" · ")}
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.companies.map((c, i) => {
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
                      title={
                        c.eikAmbiguous
                          ? bg
                            ? "Името съвпада с няколко фирми — не може да се определи еднозначно"
                            : "Name matches several companies — cannot be pinned down"
                          : bg
                            ? "Името не е намерено еднозначно в Търговския регистър"
                            : "Name not uniquely found in the Commerce Registry"
                      }
                    >
                      {c.name}
                      {pct}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {total > TOP && (
          <Link
            to="/judiciary/magistrates"
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            {bg ? `Виж всички (${total})` : `See all (${total})`} →
          </Link>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? "Източник: Регистър на декларациите по чл. 175а ЗСВ на ИВСС. Разпознаването по име в Търговския регистър може да сгреши при съвпадащи имена — затова еднозначно неразпознатите дружества се показват само като текст."
            : "Source: the ИВСС register of art. 175a ЗСВ declarations. Name-matching to the Commerce Registry can err on shared names, so companies not uniquely matched are shown as text only."}
        </p>
      </CardContent>
    </Card>
  );
};
