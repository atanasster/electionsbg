// "Фирми, регистрирани тук" — the companies the Commerce Registry seats at this
// settlement / municipality, ranked politically-linked first, then by public
// money received. Mounted on the settlement + municipality governance
// dashboards and the Sofia capital dashboard.
//
// It replaces the MP-linked static tile (CompaniesHqTile). That one listed a
// company only when an MP's NAME matched one of its officers, so a village with
// 46 registered firms showed exactly one — and, for the commonest name in the
// country, the wrong one. Here the PLACE is the question. A political link is
// an answer a row may carry, sourced from company_politicians (EIK-keyed), and
// officers are shown as what they are: names on a registry filing, with no
// person link and no MP avatar.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Briefcase, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  usePlaceCompanies,
  type PlaceKey,
  type PlaceCompany,
} from "@/data/parliament/usePlaceCompanies";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";

const SOFIA_EKATTE = "68134";
/** Officers per row before the strip collapses to "+N". A читалище board runs
 * to a dozen trustees; the tile is a teaser, /company/:eik is the full list. */
const OFFICERS_SHOWN = 2;

type Props =
  | { kind?: "ekatte"; ekatte: string }
  | { kind: "muni"; obshtina: string };

const SkeletonState: FC = () => (
  <Card>
    <CardHeader className="pb-2">
      <div className="h-5 w-40 bg-muted rounded animate-pulse" />
    </CardHeader>
    <CardContent>
      <div className="h-24 bg-muted/50 rounded animate-pulse" />
    </CardContent>
  </Card>
);

const trRoleLabel = (role: string, t: (k: string) => string): string => {
  const key = `tr_role_${role.trim()}`;
  const translated = t(key);
  return translated && translated !== key ? translated : role.trim();
};

const CompanyRow: FC<{ row: PlaceCompany }> = ({ row }) => {
  const { t, i18n } = useTranslation();
  const officers = row.officers.slice(0, OFFICERS_SHOWN);
  const remaining = row.officers.length - officers.length;
  // One person can hold two links to the same company (an `mp` row and an
  // `official` row carry different refs), which chipped the same name twice.
  const politicians = row.politicians.filter(
    (p, i, all) => all.findIndex((q) => q.name === p.name) === i,
  );
  return (
    <Link
      to={`/company/${encodeURIComponent(row.uic)}`}
      className="block rounded p-2 -mx-2 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* TR ships quoted names HTML-escaped (`&quot;СЛАВЯНА&quot;`), and
              the raw string is what the ranking sorts on — decode for display
              only, as /mp/companies does. */}
          <div className="text-sm font-medium line-clamp-2">
            {decodeEntities(row.name)}
          </div>
          {officers.length > 0 && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {officers.map((o, i) => (
                <span key={`${o.name}-${i}`}>
                  {i > 0 && " · "}
                  {o.name}
                  {o.roles && (
                    <span className="italic">
                      {" "}
                      {o.roles
                        .split(",")
                        .map((r) => trRoleLabel(r, t))
                        .join(", ")}
                    </span>
                  )}
                </span>
              ))}
              {remaining > 0 && <span> +{remaining}</span>}
            </div>
          )}
          {politicians.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {politicians.slice(0, 3).map((p) => (
                <span
                  key={p.ref}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary"
                >
                  <Landmark className="h-2.5 w-2.5" aria-hidden />
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
        {row.moneyEur > 0 && (
          <div className="text-xs tabular-nums text-muted-foreground shrink-0">
            {formatEurCompact(row.moneyEur, i18n.language)}
          </div>
        )}
      </div>
    </Link>
  );
};

export const PlaceCompaniesTile: FC<Props> = (props) => {
  const { t } = useTranslation();
  const place: PlaceKey =
    props.kind === "muni"
      ? { kind: "muni", obshtina: props.obshtina }
      : { kind: "ekatte", ekatte: props.ekatte };
  const { data, isLoading } = usePlaceCompanies(place);
  // The full page at /settlement/:id/companies is linked from `politicalCount` on THIS call —
  // it used to cost a SECOND fetch (the retired `{id}-summary.json` shard) on every governance
  // dashboard, purely to decide whether to render a link.
  //
  // ⚠️ It gates on `personLinkCount` — the page's OWN predicate — and an earlier cut of this
  // used `politicalCount`, which looks like a subset and is not. Measured: that hid the link
  // on 218 of the 260 municipalities and 1,290 of the 1,332 settlements that HAVE a page, and
  // ekatte 80217 has a political link with an empty page. This tile is the page's only entry
  // point — no sitemap loc, no prerender — so a wrong gate is the page not existing.

  if (isLoading) return <SkeletonState />;
  if (!data || data.count === 0) return null;

  const mpLinkedHref =
    props.kind === "muni"
      ? `/settlement/${props.obshtina}/companies`
      : props.ekatte === SOFIA_EKATTE
        ? `/sofia/companies`
        : `/settlement/${props.ekatte}/companies`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Briefcase className="h-4 w-4 text-amber-600" aria-hidden />
          <span>{t("companies_hq_tile_title")}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">
              {t("companies_hq_tile_count_label")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {data.count.toLocaleString("bg-BG")}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("place_companies_money_label")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {data.moneyCount.toLocaleString("bg-BG")}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("place_companies_political_label")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {data.politicalCount.toLocaleString("bg-BG")}
            </div>
          </div>
        </div>

        {data.companies.length > 0 && (
          <div className="divide-y divide-border/60">
            {data.companies.map((c) => (
              <CompanyRow key={c.uic} row={c} />
            ))}
          </div>
        )}

        {/* Two things a reader would otherwise get wrong: the ranking is not
            "biggest firms", and the count is not "every firm registered here". */}
        <div className="text-xs text-muted-foreground pt-1">
          {t("place_companies_source_note")}
        </div>

        {!!data.personLinkCount && (
          <Link
            to={mpLinkedHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("place_companies_see_mp_linked_all")}
          </Link>
        )}
      </CardContent>
    </Card>
  );
};
