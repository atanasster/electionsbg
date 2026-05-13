// Top contracts preview for the company dashboard. Reads the pre-computed
// topContracts slice already embedded inside the contractor rollup — so the
// preview costs no extra fetch on top of the rollup the page already loads,
// instead of pulling the 4 MB contractor_contracts/<eik>.json just to render
// 10 rows.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Receipt, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useContractor } from "@/data/procurement/useContractor";
import { resolveContractSource } from "../candidates/procurement/sourceUrl";

const TOP_ROWS = 10;
const FMT_INT = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

const formatAmount = (
  amount: number | undefined,
  currency: string | undefined,
): string => {
  if (amount == null || amount <= 0) return "—";
  const rounded = Math.round(amount);
  if (currency === "EUR") return `€${FMT_INT.format(rounded)}`;
  if (currency === "BGN") return `${FMT_INT.format(rounded)} лв`;
  if (!currency) return FMT_INT.format(rounded);
  return `${FMT_INT.format(rounded)} ${currency}`;
};

export const CompanyTopContractsTile: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useContractor(eik);

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
          <Link
            to={`/company/${eik}/contracts`}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("procurement_tile_see_all") || "See all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="rounded-md border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">
                  {t("company_contract_date") || "Date"}
                </th>
                <th className="text-left px-3 py-2">
                  {t("company_contract_awarder") || "Awarder"}
                </th>
                <th className="text-right px-3 py-2">
                  {t("company_contract_amount") || "Amount"}
                </th>
                <th className="px-3 py-2 w-14"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {top.map((c) => {
                const src = resolveContractSource(c);
                return (
                  <tr key={c.key}>
                    <td className="px-3 py-2 tabular-nums">{c.date}</td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/awarder/${c.partyEik}`}
                        className="hover:underline"
                      >
                        {c.partyName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(c.amount, c.currency)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/procurement/contract/${c.key}`}
                          className="text-primary hover:underline"
                        >
                          {t("company_contract_details") || "Details"}
                        </Link>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          title={
                            src.label === "eop"
                              ? t("company_contract_open_eop") ||
                                "Open in CAIS ЕОП"
                              : t("company_contract_open_source") ||
                                "Open in data.egov.bg"
                          }
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
