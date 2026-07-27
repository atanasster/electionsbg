import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { eur } from "@/data/parliament/useAssetsRankings";
import type { MpCarRegistryRow } from "@/data/parliament/useMpCars";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { formatEur } from "@/lib/currency";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
// Generic MP-registry scope→filter helpers (shared with /mp-assets): ns bucket + mp_id IN.
import {
  mpAssetsNsScope,
  mpAssetsIdFilters,
  type MpAssetsScope,
} from "@/screens/utils/mpAssetsScope";
import { useRegionScope } from "@/screens/utils/useRegionScope";
import { RegionScopeChip } from "@/screens/utils/RegionScopeChip";
import { usePartyScope } from "@/screens/utils/usePartyScope";
import { PartyScopeChip } from "@/screens/utils/PartyScopeChip";
import { PartyHeader } from "@/screens/components/party/PartyHeader";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";

// MP-declared cars, served from Postgres (matview mp_cars_table, migration 105) through the
// /api/db/table registry engine — replaces the whole-file data/parliament/mp-cars.json
// (persons-pg-retirement-v1 T2.2). Server-paged; the ns/all toggle is the resource's ns
// scope, region/party chips → an mp_id IN filter, and the summary line comes from
// server-side aggregates (count + count(value_eur) + sum(value_eur)).
//
// INTENTIONAL BEHAVIOUR CHANGE vs the JSON screen (shared with /mp-assets): the old client
// screen fell back to the lifetime list when the selected parliament had zero rows; server
// paging can't detect an empty ns bucket without a round trip, so an older parliament with no
// declarations now shows an empty table (the user switches to "All parliaments"). The current
// parliament always has rows, so this only affects historical election selections.

export const MpCarsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { partyGroupShortLabel } = useCanonicalParties();
  const [scope, setScope] = useState<MpAssetsScope>("ns");
  const {
    regionMpIds,
    label: regionLabel,
    clearedParams: regionClearedParams,
  } = useRegionScope();
  const {
    party: scopedParty,
    partyMpIds,
    label: partyLabel,
    fullName: partyFullName,
    clearedParams: partyClearedParams,
  } = usePartyScope();

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);
  const dbScope = useMemo(
    () => mpAssetsNsScope(scope, folder),
    [scope, folder],
  );
  const extraFilters = useMemo(
    () => mpAssetsIdFilters(regionMpIds, partyMpIds),
    [regionMpIds, partyMpIds],
  );

  const columns = useMemo<DataTableColumnDef<MpCarRegistryRow, unknown>[]>(
    () => [
      {
        id: "mp_name",
        accessorFn: (r) => r.mpName,
        header: t("mp_cars_col_mp") || "MP",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            <MpAvatar mpId={row.original.mpId} name={row.original.mpName} />
            <Link
              to={candidateUrlForMp(row.original.mpId)}
              className="hover:underline truncate"
            >
              {row.original.mpName}
            </Link>
          </div>
        ),
      },
      {
        id: "party_group_short",
        accessorFn: (r) => r.partyGroupShort,
        header: t("mp_cars_col_party") || "Party group",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
            {partyGroupShortLabel(row.original.partyGroupShort ?? undefined) ??
              row.original.partyGroupShort ??
              "—"}
          </span>
        ),
      },
      {
        id: "make",
        accessorFn: (r) => r.make,
        header: t("mp_cars_col_make") || "Make",
        cell: ({ row }) =>
          row.original.make ?? (
            <span className="text-muted-foreground italic">
              {t("mp_cars_unknown_make") || "unknown"}
            </span>
          ),
      },
      {
        id: "detail",
        accessorFn: (r) => r.detail,
        header: t("mp_cars_col_detail") || "Model (declared)",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[260px] block">
            {row.original.detail ?? "—"}
            {row.original.share && row.original.mergedFromCount > 1 && (
              <span
                className="ml-1 text-[10px] text-muted-foreground/80"
                title={
                  t("mp_cars_share_tooltip", {
                    defaultValue:
                      "Combined from {{count}} declaration rows: {{share}}",
                    count: row.original.mergedFromCount,
                    share: row.original.share,
                  }) || ""
                }
              >
                ({row.original.share})
              </span>
            )}
          </span>
        ),
      },
      {
        id: "acquired_year",
        accessorFn: (r) => r.acquiredYear,
        header: t("mp_cars_col_year") || "Year",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.acquiredYear ?? "—"}
          </div>
        ),
      },
      {
        id: "value_eur",
        accessorFn: (r) => eur(r.valueEur),
        header: t("mp_cars_col_value") || "Value (€)",
        cell: ({ row }) => {
          const v = eur(row.original.valueEur);
          return (
            <div className="text-right tabular-nums font-mono">
              {v != null ? (
                formatEur(v, i18n.language)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      {
        id: "is_spouse",
        accessorFn: (r) => r.isSpouse,
        header: t("mp_cars_col_holder") || "Holder",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.isSpouse
              ? t("mp_cars_holder_spouse") || "spouse"
              : t("mp_cars_holder_self") || "MP"}
          </span>
        ),
      },
      {
        id: "source",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <a
            href={row.original.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex"
            aria-label="open declaration source"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ),
      },
    ],
    [t, i18n.language, partyGroupShortLabel],
  );

  const scopeToggle = (
    <div className="flex items-center gap-2 flex-wrap">
      {regionLabel && (
        <RegionScopeChip
          label={regionLabel}
          clearedParams={regionClearedParams}
        />
      )}
      {partyLabel && (
        <PartyScopeChip label={partyLabel} clearedParams={partyClearedParams} />
      )}
      <button
        type="button"
        onClick={() => setScope("ns")}
        className={`text-xs px-3 py-1 rounded-full border ${
          scope === "ns"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card hover:bg-muted/40"
        }`}
        // Old screen also disabled this when the selected parliament had no cars; server-side
        // paging can't know that without a request, so we relax to "no folder".
        disabled={!folder}
      >
        {t("mp_cars_scope_ns") || "Selected parliament"}
        {folder ? ` · ${folder}` : ""}
      </button>
      <button
        type="button"
        onClick={() => setScope("all")}
        className={`text-xs px-3 py-1 rounded-full border ${
          scope === "all"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card hover:bg-muted/40"
        }`}
      >
        {t("mp_cars_scope_all") || "All parliaments"}
      </button>
    </div>
  );

  const pageTitle = t("mp_cars_page_title") || "MP-declared cars";

  return (
    <div
      data-og="mp-cars-og"
      className={
        partyFullName ? "w-full max-w-7xl mx-auto px-4 md:px-8 pb-12" : "w-full"
      }
    >
      {partyFullName ? (
        <PartyHeader
          party={scopedParty}
          fullName={partyFullName}
          subtitle={pageTitle}
          seoTitle={`${partyFullName} — ${pageTitle}`}
          seoDescription={t("mp_cars_page_description") || pageTitle}
        />
      ) : (
        <Title description={t("mp_cars_page_description") || ""}>
          {pageTitle}
        </Title>
      )}
      <DeclarationsBreadcrumb
        currentKey="mp_cars_link_label"
        className="mt-5"
      />

      <DbDataTable<MpCarRegistryRow>
        resource="mp_cars"
        scope={dbScope}
        columns={columns}
        extraFilters={extraFilters}
        defaultSort={[{ id: "value_eur", desc: true }]}
        pageSize={25}
        toolbar={scopeToggle}
        renderAggregates={(agg) => {
          const total = Number(agg.count ?? 0);
          const valued = Number(agg.countValueEur ?? 0);
          const sum = Number(agg.sumValueEur ?? 0);
          return (
            <span className="text-xs text-muted-foreground">
              {t("mp_cars_page_summary", {
                defaultValue:
                  "{{total}} cars · {{valued}} with declared value · combined {{sum}}",
                total,
                valued,
                sum: formatEur(sum, i18n.language),
              })}
            </span>
          );
        }}
      />

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_cars_page_footer") ||
          "Cars (passenger vehicles + jeeps) extracted from the most-recent declaration of every MP. Spouse-held cars are listed with holder = spouse. Source: register.cacbg.bg (Bulgarian Court of Audit)."}
      </div>
    </div>
  );
};
