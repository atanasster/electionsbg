// Paginated detail page for "companies here held by someone in public life".
// Reads /api/db/place-mp-companies (migration 151); was the {ekatte}-page-NNN.json shards.
// Wired to:
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
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import {
  useCompaniesHqPage,
  type CompaniesHqPlace,
  type CompaniesHqRow,
} from "@/data/parliament/useCompaniesAtSettlement";
import { decodeEntities } from "@/lib/decodeEntities";

const SOFIA_EKATTE = "68134";

const CompanyCard: FC<{ row: CompaniesHqRow }> = ({ row }) => {
  const { t } = useTranslation();
  // One chip per PERSON with every capacity they hold — 151 groups the roles server-side for
  // exactly this reason. No client dedupe: doing it here is what dropped a capacity on half
  // the pairs when the route emitted one row per (person, role).
  const people = row.people;
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* TR ships quoted names HTML-escaped (`&quot;СЛАВЯНА&quot;`) — decode for display
                only, as /mp/companies and the governance tile do. */}
            <Link
              to={`/company/${encodeURIComponent(row.uic)}`}
              className="text-base font-medium hover:underline line-clamp-2"
            >
              {decodeEntities(row.name)}
            </Link>
            {row.legalForm && (
              <span className="text-xs text-muted-foreground ml-1">
                {row.legalForm}
              </span>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {people.map((p) => (
                <Link
                  key={p.slug}
                  to={`/person/${encodeURIComponent(p.slug)}`}
                  className="inline-flex items-center gap-1.5 text-xs rounded-full bg-muted px-2 py-0.5 hover:bg-muted/70"
                >
                  <span className="truncate max-w-[12rem]">{p.name}</span>
                  <span className="italic text-muted-foreground">
                    {p.roles
                      .map((r) => t(`tr_role_${r}`, { defaultValue: r }))
                      .join(", ")}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const { t, i18n } = useTranslation();
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();

  // Sofia → synthetic EKATTE. Numeric :id → settlement view. Alphanumeric :id
  // → municipality view (e.g. /settlement/PDV22/companies = Plovdiv obshtina).
  const isMuni = !sofia && !!id && !/^\d+$/.test(id);
  const place: CompaniesHqPlace = sofia
    ? { kind: "ekatte", ekatte: SOFIA_EKATTE }
    : isMuni
      ? { kind: "muni", obshtina: id }
      : { kind: "ekatte", ekatte: id };

  const {
    data: pageData,
    isLoading,
    isError,
  } = useCompaniesHqPage(place, page);

  const placeName = useMemo(() => {
    if (sofia) return "София";
    if (!id) return "";
    if (isMuni) {
      const m = findMunicipality(id);
      if (!m) return id;
      return i18n.language === "bg" ? m.name : m.name_en;
    }
    const s = findSettlement(id);
    if (!s) return id;
    return i18n.language === "bg" ? s.name : s.name_en;
  }, [id, sofia, isMuni, findSettlement, findMunicipality, i18n.language]);

  if (!sofia && !id) return null;

  // One payload, so `count`/`totalPages` cannot disagree with the rows the way the shards'
  // separate summary file could.
  const totalPages = pageData?.totalPages ?? 1;
  const count = pageData?.count ?? 0;
  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setSearchParams(p === 1 ? {} : { page: String(p) });
  };

  const titleStr = t("companies_hq_screen_title", { name: placeName });
  const backHref = sofia ? "/sofia" : `/settlement/${id}`;

  return (
    <>
      <SEO title={titleStr} description={titleStr} />
      <H1>
        <Link to={backHref}>{placeName}</Link>
        {" / "}
        {t("companies_hq_screen_breadcrumb")}
      </H1>
      <div className="my-3 text-sm text-muted-foreground">
        {t("companies_hq_screen_lede", {
          count,
          personCount: pageData?.personCount ?? 0,
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
      ) : isError ? (
        // A failed fetch must NOT render the empty state. „Няма фирми, свързани с публично
        // лице" is a factual claim about this place, and a route that 500s — or a database
        // where 151 was never applied, which degrades to count: 0 — would otherwise publish
        // that claim about every settlement in the country.
        <div className="text-sm text-muted-foreground">
          {t("companies_hq_screen_error")}
        </div>
      ) : !pageData || pageData.companies.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("companies_hq_screen_empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {pageData.companies.map((c) => (
            <CompanyCard key={c.uic} row={c} />
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
