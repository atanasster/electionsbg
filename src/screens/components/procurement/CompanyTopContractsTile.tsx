// Top contracts preview for the company dashboard. Reads the pre-computed
// topContracts slice already embedded inside the DB rollup the page loads —
// so the preview costs no extra fetch.
//
// Works for both sides: on a contractor page `partyEik/partyName` is the AWARDER;
// on an awarder page (awarder_procurement) it's the CONTRACTOR. The contract
// TITLE is the primary, clickable element (→ the contract detail page); the
// party + date sit under it. Link targets are injectable per page.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt, ExternalLink, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { ProcurementContractorRollup } from "@/data/dataTypes";
import { decodeEntities } from "@/lib/decodeEntities";
import { resolveContractSource } from "../candidates/procurement/sourceUrl";
import { ContractAmount } from "./ContractAmount";

const TOP_ROWS = 10;

export const CompanyTopContractsTile: FC<{
  eik: string;
  rollup: ProcurementContractorRollup | null;
  /** Link builder for the counterparty (awarder or contractor). */
  partyHref?: (eik: string) => string;
  /** Override the "see all" target (defaults to the DB contracts page).
   *  Pass null to hide the link (e.g. the person page has no per-person list). */
  seeAllHref?: string | null;
  /** When set, each row names the WINNING company (contractorEik/Name on the
   *  row) as a clickable line — used on the person page where top contracts
   *  span several of the person's companies. */
  contractorHref?: (eik: string) => string;
}> = ({ eik, rollup, partyHref, seeAllHref, contractorHref }) => {
  const { t } = useTranslation();
  const data = rollup;
  const hrefParty = partyHref ?? ((e: string) => `/awarder/${e}`);
  const hrefSeeAll =
    seeAllHref === null ? null : (seeAllHref ?? `/company/${eik}/contracts`);

  const top = data?.topContracts?.slice(0, TOP_ROWS) ?? [];

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
              className="ml-auto text-[10px] normal-case text-primary hover:underline"
            >
              {t("procurement_tile_see_all") || "See all"} →
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
                  {/* Which of the person's companies won it (person page only). */}
                  {contractorHref && c.contractorEik && c.contractorName && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs">
                      <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <Link
                        to={contractorHref(c.contractorEik)}
                        className="truncate font-medium text-accent hover:underline"
                      >
                        {decodeEntities(c.contractorName)}
                      </Link>
                    </div>
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
