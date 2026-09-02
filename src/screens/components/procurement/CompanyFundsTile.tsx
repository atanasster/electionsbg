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
import { GRADE_TONE } from "@/lib/riskGrade";
import {
  ABSENCE_MEANING_BG_FALLBACK,
  ABSENCE_MEANING_EN,
} from "./CompanyCleanDeliveryTile";

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
  /** `contract_number`s ИСУН publishes in its „Проекти без наложени финансови
   *  корекции" list (migration 175, via the clean-delivery arm of /api/db/company).
   *  The join is exact — 9,940 of 9,940 clean contracts resolve to a
   *  `fund_projects` row — so a marked row is the register's own statement about
   *  THAT contract, not an inference.
   *
   *  ⚠️ AN UNMARKED ROW MEANS NOTHING, and the tile must keep saying so. This is
   *  the same trap `CompanyCleanDeliveryTile` exists to close: a reader seeing 2
   *  of 4 projects marked concludes the other 2 were corrected. ИСУН publishes no
   *  „was corrected" list — individual irregularities go to OLAF's IMS, which is
   *  confidential — and a project can be absent from this register because it
   *  finished late, was terminated, or is still in verification. */
  cleanContracts?: ReadonlySet<string> | null;
  /** `isun_clean_delivery_coverage.absence_meaning`, verbatim (BG). Preferred over
   *  `ABSENCE_MEANING_BG_FALLBACK` so this tile and `CompanyCleanDeliveryTile` —
   *  which render the same sentence from the same column, on the same page —
   *  cannot drift from the register or from each other. NULL only on a database
   *  with no coverage row; the fallback then carries the bound, including the
   *  OLAF/IMS clause an earlier local literal here had dropped. `absenceCaveat`
   *  holds the rule. */
  absenceMeaning?: string | null;
}> = ({ eik, funds, projects, cleanContracts, absenceMeaning }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang.startsWith("bg");
  const count = Number(funds.contract_count ?? 0);
  // Deliberately a BOOLEAN, not a count. A rendered „N of M marked" is the
  // subtractable pair this dataset must never publish: M − N reads as „were
  // corrected", which inverts the register.
  const marked = projects.some((p) => cleanContracts?.has(p.contract_number));
  // ⚠️ NOT the same question as `marked`, and the difference is the whole reason
  // the caveat is split below. `projects` is the SIX LARGEST by contracted value
  // (db_routes: ORDER BY total_eur DESC LIMIT 6) and „largest" has nothing to do
  // with „clean" — so a company whose clean contracts are all small shows six
  // unmarked rows here while CompanyCleanDeliveryTile names those contracts
  // elsewhere on the page. Gating the absence clause on `marked` alone leaves
  // exactly that reader with no caveat between the two lists.
  const consulted = (cleanContracts?.size ?? 0) > 0;
  const noteId = `funds-clean-note-${eik}`;

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
                          {cleanContracts?.has(p.contract_number) && (
                            // Presence only. „Не е в списъка" on an unmarked row
                            // would state an absence as a finding, which is the
                            // one thing this register cannot support.
                            <div className="text-xs text-emerald-700 dark:text-emerald-300">
                              {bg
                                ? "В списъка на ИСУН „Проекти без наложени финансови корекции“"
                                : "In ИСУН's „projects with no financial corrections imposed“ list"}
                            </div>
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
                          {/* The badge sits OUTSIDE the clamped box. Inline at the
                              end of `line-clamp-2` it is pushed to line three by
                              any two-line title — routine for ИСУН titles, and
                              positively correlated with these rows, since the
                              preview is ordered by contracted value — and clipped
                              away, leaving a footnote about a mark nobody can see
                              and a clean project rendered identically to an
                              unmarked one. */}
                          <div className="flex items-start gap-1.5">
                            <div className="min-w-0 text-sm font-medium text-foreground line-clamp-2">
                              {p.title || p.contract_number}
                            </div>
                            {cleanContracts?.has(p.contract_number) && (
                              <span
                                aria-describedby={noteId}
                                className={`mt-0.5 shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${GRADE_TONE.A.chip}`}
                              >
                                {bg ? "без корекция" : "no correction"}
                              </span>
                            )}
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

        {/* ⚠️ NOT DECORATION. Without it the marks turn the list into a verdict on
            the unmarked rows — the exact reading `CompanyCleanDeliveryTile` was
            rewritten to prevent. Two clauses, gated separately: the first explains
            a BADGE and needs one on screen; the second bounds the ABSENCE of
            badges and must render whenever the register was consulted at all,
            including the case where none of its contracts reached this top-6
            preview. */}
        {(marked || consulted) && (
          <p id={noteId} className="text-xs leading-snug text-muted-foreground">
            {marked &&
              (bg
                ? "„Без корекция“ идва от списъка на ИСУН с приключили проекти без наложена финансова корекция. "
                : "„No correction“ comes from ИСУН's list of completed projects with no financial correction imposed. ")}
            {/* Verbatim from the register in BG (see `absenceMeaning`), and the
                one exported EN mirror — never a local literal, which is how the
                first draft of this footnote lost the OLAF/IMS clause. */}
            {bg
              ? (absenceMeaning ?? ABSENCE_MEANING_BG_FALLBACK)
              : ABSENCE_MEANING_EN}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
