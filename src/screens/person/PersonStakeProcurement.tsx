// Declared company stakes that hold public contracts (audit T3.8).
//
// The one conflict-of-interest surface in the person profile — and the one with the
// narrowest evidentiary base, because the declaration form records a company NAME and no
// EIK. Every row rendered here passed all three of 096's gates: the name resolves to exactly
// one TRADING company in the Търговски регистър, the registry independently places this
// person at that EIK, and the person's folded name is not shared by another active person
// (so that registry match identifies one individual, not one of seven namesakes). Ambiguous,
// unconfirmed and namesake-risky stakes never reach the client, so there is nothing here to
// caveat as "possible match" — the caveat is that these are DECLARED holdings matched to
// public contract records.
//
// FRAMING (same discipline as docs/methodology/accumulation-gap.md): owning a company that
// wins public contracts is lawful, and the declaration is the system working as designed.
// So: no risk score, no ranking, no colour-coding, no adjective. Two figures, described.
//
// The time alignment is the editorial point. `whileDeclaredEur` counts only contracts dated
// within the span the person declared holding the stake; `totalEur` is the company's
// lifetime. A company sold long before a contract shows a lifetime figure and a zero
// aligned figure, and the row says so rather than implying an overlap that never happened.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Briefcase } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { usePersonStakeProcurement } from "./usePersonStakeProcurement";

export const PersonStakeProcurement: FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const rows = usePersonStakeProcurement(slug);

  // Self-hides: most people have no confirmed stake in a contract-winning company.
  if (!rows || rows.length === 0) return null;

  return (
    <DashboardSection
      id="person-stakes"
      title={t("pp_stake_proc_title")}
      icon={Briefcase}
      subtitle={t("pp_stake_proc_hint")}
    >
      <Card>
        <CardContent className="space-y-3 pt-6">
          {rows.map((r) => (
            <div
              key={r.eik}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                {/* The REGISTRY's name leads, because the EIK is inferred: the reader must
                    be able to see what the declared string actually resolved to. */}
                <Link
                  to={`/company/${r.eik}`}
                  className="font-medium text-primary hover:underline"
                >
                  {r.companyName ?? r.declaredName}
                </Link>
                {/* The declarant's own spelling, when it differs — the cheapest way for a
                    reader to sanity-check the match themselves. */}
                {r.companyName &&
                  r.declaredName &&
                  r.declaredName !== r.companyName && (
                    <div className="text-[11px] text-muted-foreground">
                      {t("pp_stake_proc_declared_as")} {r.declaredName}
                    </div>
                  )}
                <div className="text-xs text-muted-foreground">
                  {/* The declared period, so the reader can place the holding in time.
                      The aligned figure covers this span contiguously (096), so the range
                      shown and the money counted describe the same years. */}
                  {r.firstYear != null && (
                    <>
                      {t("pp_stake_proc_declared")}{" "}
                      {r.firstYear === r.lastYear
                        ? r.firstYear
                        : `${r.firstYear}–${r.lastYear}`}
                    </>
                  )}
                  {/* Only render a share we can actually label. declaration_stake.share_size
                      is free text and holds percentages ("50 %"), share counts ("405"),
                      fractions ("1/2") and capital amounts ("5000") indistinguishably — a
                      bare "5000" next to a percentage reads as nonsense. */}
                  {r.shareSize && /^\s*\d+([.,]\d+)?\s*%\s*$/.test(r.shareSize)
                    ? ` · ${r.shareSize.replace(/\s+/g, "")}`
                    : ""}
                  {` · ${t("pp_stake_proc_contracts", { count: r.contractCount })}`}
                </div>
              </div>
              <div className="flex shrink-0 gap-6 text-right tabular-nums">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatEurCompact(r.whileDeclaredEur, locale)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {/* The count alongside the money: "€0 across 4 contracts" is visibly
                        odd in a way a bare €0 is not. */}
                    {t("pp_stake_proc_while_declared")} ({r.whileDeclaredCount})
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">
                    {formatEurCompact(r.totalEur, locale)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t("pp_stake_proc_total")}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {t("pp_stake_proc_caveat")}
          </p>
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
