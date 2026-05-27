// "Companies HQ'd here (MP-linked)" tile — mounted on settlement and Sofia
// capital dashboards. Reads the slim summary shard
// (parliament/companies-by-ekatte/{ekatte}-summary.json) so the tile loads
// instantly even for Sofia's ~316 companies. Tile self-suppresses (renders
// null) when the settlement has no MP-linked HQs — keeps dashboards tidy
// for the long tail of settlements that aren't business clusters.
//
// "See all" links to the paginated detail page at
// /settlement/:id/companies (or /sofia/companies for the capital).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Briefcase, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useCompaniesHqSummary,
  type CompaniesHqPlace,
  type CompaniesHqRow,
} from "@/data/parliament/useCompaniesAtSettlement";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";

const SOFIA_EKATTE = "68134";

type Props =
  | {
      /** Settlement page — pass numeric EKATTE; "68134" for the Sofia capital. */
      kind?: "ekatte";
      ekatte: string;
    }
  | {
      /** Municipality page — pass alphanumeric obshtina code (e.g. "PDV22"). */
      kind: "muni";
      obshtina: string;
    };

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

/** Dedupe an `mps` list by mpId so the avatar strip doesn't show the same
 * MP twice when they hold multiple roles (director + representative).
 * Preserve first-seen order so the principal role survives. */
const uniqueMps = (mps: CompaniesHqRow["mps"]) => {
  const seen = new Set<number>();
  const out: typeof mps = [];
  for (const m of mps) {
    if (seen.has(m.mpId)) continue;
    seen.add(m.mpId);
    out.push(m);
  }
  return out;
};

const roleKey = (role: string): string => {
  // declared_stake is our synthetic role from the declarations parser; show
  // it as "declared stake" via a dedicated key (defined in the i18n files).
  if (role === "declared_stake") return "companies_hq_role_declared_stake";
  return `tr_role_${role}`;
};

const CompanyRow: FC<{ row: CompaniesHqRow }> = ({ row }) => {
  const { t } = useTranslation();
  const mps = uniqueMps(row.mps).slice(0, 3); // cap the avatar strip
  const remaining = row.mps.length - mps.length;
  return (
    <Link
      to={`/mp/company/${encodeURIComponent(row.slug)}`}
      className="block rounded p-2 -mx-2 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium line-clamp-2">
            {row.displayName}
          </div>
          {mps.length > 0 && (
            <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {mps[0].mpName}
              {mps[0].role && (
                <>
                  {" · "}
                  <span className="italic">
                    {t(roleKey(mps[0].role), { defaultValue: mps[0].role })}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex -space-x-1 shrink-0">
          {mps.map((m) => (
            <MpAvatar key={m.mpId} mpId={m.mpId} name={m.mpName} />
          ))}
          {remaining > 0 && (
            <span className="text-[10px] text-muted-foreground self-end pl-1.5">
              +{remaining}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

export const CompaniesHqTile: FC<Props> = (props) => {
  const { t } = useTranslation();
  const place: CompaniesHqPlace =
    props.kind === "muni"
      ? { kind: "muni", obshtina: props.obshtina }
      : { kind: "ekatte", ekatte: props.ekatte };
  const { data, isLoading } = useCompaniesHqSummary(place);

  if (isLoading) return <SkeletonState />;
  if (!data || data.count === 0) return null;

  const detailHref =
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
          <span className="text-xs font-normal text-muted-foreground">
            {t("companies_hq_tile_subtitle", {
              count: data.count,
              mpCount: data.mpCount,
            })}
            {/* i18next picks _one / _other automatically based on count */}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
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
              {t("companies_hq_tile_mps_label")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {data.mpCount.toLocaleString("bg-BG")}
            </div>
          </div>
        </div>

        {data.topCompanies.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("companies_hq_tile_top_companies")}
            </div>
            <div className="divide-y divide-border/60">
              {data.topCompanies.map((c) => (
                <CompanyRow key={c.slug} row={c} />
              ))}
            </div>
          </div>
        )}

        {data.count > data.topCompanies.length && (
          <Link
            to={detailHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("companies_hq_tile_see_all", { count: data.count })}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </CardContent>
    </Card>
  );
};
