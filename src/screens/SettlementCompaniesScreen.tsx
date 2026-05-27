// Paginated detail page for "Companies HQ'd here (MP-linked)".
// Reads {ekatte}-page-NNN.json shards (50 companies per page). Wired to:
//   /settlement/:id/companies — per-EKATTE
//   /sofia/companies          — Sofia capital (ekatte=68134, see route below)

import { FC, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { Card, CardContent } from "@/ux/Card";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import {
  useCompaniesHqPage,
  useCompaniesHqSummary,
  type CompaniesHqRow,
} from "@/data/parliament/useCompaniesAtSettlement";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";

const SOFIA_EKATTE = "68134";

const roleKey = (role: string): string =>
  role === "declared_stake"
    ? "companies_hq_role_declared_stake"
    : `tr_role_${role}`;

const CompanyCard: FC<{ row: CompaniesHqRow }> = ({ row }) => {
  const { t } = useTranslation();
  const seen = new Set<number>();
  const uniqueMps = row.mps.filter((m) => {
    if (seen.has(m.mpId)) return false;
    seen.add(m.mpId);
    return true;
  });
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Link
              to={`/mp/company/${encodeURIComponent(row.slug)}`}
              className="text-base font-medium hover:underline line-clamp-2"
            >
              {row.displayName}
            </Link>
            {row.registeredOffice && (
              <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {row.registeredOffice}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {uniqueMps.map((m) => (
                <Link
                  key={`${m.mpId}-${m.role}`}
                  to={`/mp/${m.mpId}`}
                  className="inline-flex items-center gap-1.5 text-xs rounded-full bg-muted px-2 py-0.5 hover:bg-muted/70"
                >
                  <MpAvatar mpId={m.mpId} name={m.mpName} />
                  <span className="truncate max-w-[12rem]">{m.mpName}</span>
                  <span className="italic text-muted-foreground">
                    {t(roleKey(m.role), { defaultValue: m.role })}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

type Props = {
  /** Set when this screen is mounted under /sofia/companies so we can use the
   * synthetic EKATTE and skip the settlement lookup. */
  sofia?: boolean;
};

export const SettlementCompaniesScreen: FC<Props> = ({ sofia = false }) => {
  const { id } = useParams();
  const ekatte = sofia ? SOFIA_EKATTE : id;
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const { t, i18n } = useTranslation();
  const { findSettlement } = useSettlementsInfo();

  const { data: summary } = useCompaniesHqSummary(ekatte);
  const { data: pageData, isLoading } = useCompaniesHqPage(ekatte, page);

  const settlementName = useMemo(() => {
    if (sofia) return "София";
    if (!ekatte) return "";
    const s = findSettlement(ekatte);
    if (!s) return ekatte;
    return i18n.language === "bg" ? s.name : s.name_en;
  }, [ekatte, sofia, findSettlement, i18n.language]);

  if (!ekatte) return null;

  const totalPages = summary?.totalPages ?? pageData?.totalPages ?? 1;
  const count = summary?.count ?? pageData?.count ?? 0;
  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setSearchParams(p === 1 ? {} : { page: String(p) });
  };

  const titleStr = t("companies_hq_screen_title", {
    name: settlementName,
  });

  return (
    <>
      <SEO title={titleStr} description={titleStr} />
      <H1>
        {sofia ? (
          <Link to="/sofia">{settlementName}</Link>
        ) : (
          <Link to={`/settlement/${ekatte}`}>{settlementName}</Link>
        )}
        {" / "}
        {t("companies_hq_screen_breadcrumb")}
      </H1>
      <div className="my-3 text-sm text-muted-foreground">
        {t("companies_hq_screen_lede", {
          count,
          mpCount: summary?.mpCount ?? 0,
        })}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-20 rounded-xl bg-muted/50 animate-pulse"
            />
          ))}
        </div>
      ) : !pageData || pageData.companies.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("companies_hq_screen_empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {pageData.companies.map((c) => (
            <CompanyCard key={c.slug} row={c} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav
          aria-label={t("companies_hq_screen_pagination_label")}
          className="flex items-center justify-between mt-4 text-sm"
        >
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border bg-card disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {t("pagination_prev")}
          </button>
          <span className="tabular-nums text-muted-foreground">
            {t("pagination_page_of", { page, total: totalPages })}
          </span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border bg-card disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
          >
            {t("pagination_next")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </nav>
      )}
    </>
  );
};
