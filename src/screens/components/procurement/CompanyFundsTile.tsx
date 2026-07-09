// EU-funds (ИСУН) tile for the DB company page. The funds analogue of the top
// contracts tile: headline totals (contracted / paid / project count / org type)
// + a preview of the largest projects, with "виж всички" into the backend-
// paginated funds drill-down (/company/:eik/funds). Fed by the company route
// (fund_beneficiaries aggregate + top fund_projects). All DB-only.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Euro } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Tooltip } from "@/ux/Tooltip";
import { formatEur } from "@/lib/currency";

export interface CompanyFunds {
  name: string | null;
  org_type: string | null;
  contract_count: number | null;
  contracted_eur: number | null;
  paid_eur: number | null;
}
export interface FundProjectRow {
  contract_number: string;
  title: string | null;
  program_name: string | null;
  total_eur: number | null;
  paid_eur: number | null;
  status: string | null;
  duration_months: number | null;
}

const num = new Intl.NumberFormat("bg-BG");

const Metric: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="font-semibold tabular-nums">{children}</div>
  </div>
);

export const CompanyFundsTile: FC<{
  eik: string;
  funds: CompanyFunds;
  projects: FundProjectRow[];
}> = ({ eik, funds, projects }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const count = Number(funds.contract_count ?? 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Euro className="h-4 w-4 text-muted-foreground" />
          {t("company_funds_title") || "Средства от ЕС (ИСУН)"}
          <Link
            to={`/company/${eik}/funds`}
            className="ml-auto text-[10px] normal-case text-primary hover:underline"
          >
            {t("procurement_tile_see_all") || "Виж всички"} →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Metric label={t("company_funds_contracted") || "Договорени"}>
            {formatEur(Number(funds.contracted_eur ?? 0), lang)}
          </Metric>
          <Metric label={t("company_funds_paid") || "Изплатени"}>
            {formatEur(Number(funds.paid_eur ?? 0), lang)}
          </Metric>
          <Metric label={t("company_funds_projects") || "Проекти"}>
            <Link
              to={`/company/${eik}/funds`}
              className="text-accent hover:underline"
            >
              {num.format(count)}
            </Link>
          </Metric>
          {funds.org_type && (
            <Metric label={t("company_funds_org_type") || "Тип организация"}>
              <span className="font-normal">{funds.org_type}</span>
            </Metric>
          )}
        </div>

        {projects.length > 0 && (
          <ul className="divide-y divide-border rounded-md border bg-card">
            {projects.map((p) => {
              const total = Number(p.total_eur ?? 0);
              const paid = Number(p.paid_eur ?? 0);
              const pct =
                total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
              const months = Number(p.duration_months ?? 0);
              const durationLabel =
                months > 0
                  ? `${months} ${t("funds_contract_months", { count: months })}`
                  : null;
              return (
                <li key={p.contract_number}>
                  <Link
                    to={`/funds/contract/${encodeURIComponent(p.contract_number)}`}
                    className="block rounded-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <Tooltip
                      className="max-w-80 p-3"
                      content={
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold leading-snug">
                            {p.title || p.contract_number}
                          </div>
                          {p.program_name && (
                            <div className="text-xs text-muted-foreground">
                              {p.program_name}
                            </div>
                          )}
                          {p.status && (
                            <div className="text-xs">{p.status}</div>
                          )}
                          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs tabular-nums">
                            <span className="text-muted-foreground">
                              {t("company_funds_contracted") || "Договорени"}
                            </span>
                            <span className="text-right font-medium">
                              {formatEur(total, lang)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("company_funds_paid") || "Изплатени"}
                            </span>
                            <span className="text-right font-medium">
                              {formatEur(paid, lang)}
                            </span>
                            <span className="text-muted-foreground">
                              {t("funds_contract_disbursement") || "Усвояване"}
                            </span>
                            <span className="text-right font-medium">
                              {pct}%
                            </span>
                            {durationLabel && (
                              <>
                                <span className="text-muted-foreground">
                                  {t("funds_contract_duration") ||
                                    "Продължителност"}
                                </span>
                                <span className="text-right font-medium">
                                  {durationLabel}
                                </span>
                              </>
                            )}
                          </div>
                          {p.title && (
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                              {p.contract_number}
                            </div>
                          )}
                          <div className="text-[11px] font-medium text-primary">
                            {t("company_funds_view_project") || "Виж проекта"} →
                          </div>
                        </div>
                      }
                    >
                      <div className="flex items-start gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground line-clamp-2">
                            {p.title || p.contract_number}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                            {p.program_name}
                            {p.status ? ` · ${p.status}` : ""}
                            {durationLabel ? ` · ${durationLabel}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 whitespace-nowrap pt-0.5 text-right tabular-nums text-sm">
                          {formatEur(total, lang)}
                          <div className="text-xs text-muted-foreground">
                            {t("company_funds_paid_short") || "изпл."}{" "}
                            {formatEur(paid, lang)}
                          </div>
                        </div>
                      </div>
                    </Tooltip>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
