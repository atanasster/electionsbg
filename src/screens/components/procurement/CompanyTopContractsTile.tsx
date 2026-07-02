// Top contracts preview for the company dashboard. Reads the pre-computed
// topContracts slice already embedded inside the rollup — so the preview costs
// no extra fetch on top of the rollup the page already loads.
//
// Works for both sides: on a contractor page `partyEik/partyName` is the AWARDER;
// on an awarder page (awarder_procurement) it's the CONTRACTOR. The contract
// TITLE is the primary, clickable element (→ the contract detail page); the
// party + date sit under it. Link targets are injectable so the DB page routes
// to /db/* while the JSON page keeps /awarder + /company.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Receipt, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useContractor } from "@/data/procurement/useContractor";
import type { ProcurementContractorRollup } from "@/data/dataTypes";
import { resolveContractSource } from "../candidates/procurement/sourceUrl";
import { ContractAmount } from "./ContractAmount";

const TOP_ROWS = 10;

export const CompanyTopContractsTile: FC<{
  eik: string;
  rollup?: ProcurementContractorRollup | null;
  /** Link builder for the counterparty (awarder or contractor). */
  partyHref?: (eik: string) => string;
  /** Override the "see all" target (defaults to the JSON contracts page).
   *  Pass null to hide the link (e.g. the person page has no per-person list). */
  seeAllHref?: string | null;
}> = ({ eik, rollup, partyHref, seeAllHref }) => {
  const { t } = useTranslation();
  const { data: fetched, isLoading } = useContractor(rollup ? undefined : eik);
  const data = rollup ?? fetched;
  const hrefParty = partyHref ?? ((e: string) => `/awarder/${e}`);
  const hrefSeeAll =
    seeAllHref === null ? null : (seeAllHref ?? `/company/${eik}/contracts`);

  const top = data?.topContracts?.slice(0, TOP_ROWS) ?? [];

  if (isLoading) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[440px]" />
        </CardContent>
      </Card>
    );
  }
  if (!data || top.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Receipt className="h-4 w-4" />
          {t("company_top_contracts") || "Top contracts"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_top_contracts_subtitle") || "Largest by signed amount."}
          </span>
          {hrefSeeAll && (
            <Link
              to={hrefSeeAll}
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
            >
              {t("procurement_tile_see_all") || "See all"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border rounded-md border bg-card">
          {top.map((c) => {
            const src = resolveContractSource(c);
            return (
              <li key={c.key} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  {/* Title-primary when the rollup carries a subject (DB rollups);
                      party-primary fallback for legacy JSON rollups without it. */}
                  {c.title ? (
                    <>
                      <Link
                        to={`/procurement/contract/${c.key}`}
                        className="text-sm font-medium text-foreground hover:text-primary hover:underline line-clamp-2"
                        title={c.title}
                      >
                        {c.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <Link
                          to={hrefParty(c.partyEik)}
                          className="hover:underline"
                        >
                          {c.partyName}
                        </Link>
                        <span className="tabular-nums"> · {c.date}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <Link
                        to={hrefParty(c.partyEik)}
                        className="text-sm font-medium text-foreground hover:text-primary hover:underline line-clamp-2"
                      >
                        {c.partyName}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <Link
                          to={`/procurement/contract/${c.key}`}
                          className="hover:underline"
                        >
                          {t("company_contract_details") || "Детайли"}
                        </Link>
                        <span className="tabular-nums"> · {c.date}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 whitespace-nowrap pt-0.5 text-right tabular-nums">
                  <ContractAmount
                    amountEur={c.amountEur}
                    amount={c.amount}
                    currency={c.currency}
                  />
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-primary"
                    title={
                      src.label === "egov"
                        ? t("company_contract_open_source") ||
                          "Open in data.egov.bg"
                        : t("company_contract_open_eop") || "Open in CAIS ЕОП"
                    }
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
