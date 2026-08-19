import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import {
  eur,
  type MpAssetsRankingRow,
} from "@/data/parliament/useAssetsRankings";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { formatThousands } from "@/data/utils";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
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
import { AssetsByGroup } from "@/screens/components/declarations/AssetsByGroup";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";

// MPs by declared assets, served from Postgres (matview mp_assets_rankings_table, migration
// 105) through the /api/db/table registry engine — replaces the whole-file
// data/parliament/assets-rankings.json (persons-pg-retirement-v1 T2.2). Server-side
// paging/sorting/filtering, so the page never downloads the full ranking.
//
// SCOPE MAPS TO REGISTRY FILTERS: the ns/all toggle is the resource's `ns` scope (fan-out
// bucket, defaultScope 'all'); the region + party chips become an `mp_id IN (...)` filter
// (the intersection when both are active, mirroring the old double `.filter`).
//
// FIGURES ARE person_wealth_year's, NOT the JSON's — the ~154 MPs with declared company
// shares read lower here than the retired file (see MpAssetsRankingRow); one number sitewide,
// consistent with the wealth chart and /person.

const fmtNum = (v: string | number | null, lang: string): string => {
  const n = eur(v);
  if (n == null) return "—";
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

export const AllMpAssetsScreen: FC = () => {
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
  // The same restriction the table gets, in the chart route's shape: `null` = unscoped, and a
  // scoped-but-empty set keeps the `[-1]` impossible id rather than becoming `[]` — an empty
  // list would be sent as no restriction at all and the chart would show the whole chamber
  // beside a table showing nobody (the regression mpAssetsIdFilters documents, one route on).
  const chartMpIds = useMemo<number[] | null>(() => {
    const f = extraFilters[0];
    return f ? (f.value as number[]) : null;
  }, [extraFilters]);

  const columns = useMemo<DataTableColumnDef<MpAssetsRankingRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("mp_assets_col_mp") || "MP",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            <MpAvatar mpId={row.original.mpId} name={row.original.name} />
            <Link
              to={candidateUrlForMp(row.original.mpId)}
              className="hover:underline truncate"
            >
              {row.original.name}
            </Link>
          </div>
        ),
      },
      {
        id: "party_group_short",
        accessorFn: (r) => r.partyGroupShort,
        header: t("mp_assets_col_party") || "Party group",
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
        id: "latest_declaration_year",
        accessorFn: (r) => r.latestDeclarationYear,
        header: t("mp_assets_col_year") || "Year",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.latestDeclarationYear ?? "—"}
          </div>
        ),
      },
      {
        id: "total_assets_eur",
        accessorFn: (r) => eur(r.totalAssetsEur),
        header: t("mp_assets_col_assets") || "Assets (€)",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono">
            {fmtNum(row.original.totalAssetsEur, i18n.language)}
          </div>
        ),
      },
      {
        id: "total_debts_eur",
        accessorFn: (r) => eur(r.totalDebtsEur),
        header: t("mp_assets_col_debts") || "Debts (€)",
        cell: ({ row }) => {
          const debts = eur(row.original.totalDebtsEur);
          return (
            <div
              className={`text-right tabular-nums font-mono ${debts && debts > 0 ? "text-red-600" : "text-muted-foreground"}`}
            >
              {debts && debts > 0 ? fmtNum(debts, i18n.language) : "—"}
            </div>
          );
        },
      },
      {
        id: "net_worth_eur",
        accessorFn: (r) => eur(r.netWorthEur),
        header: t("mp_assets_col_net") || "Net (€)",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono font-semibold">
            {fmtNum(row.original.netWorthEur, i18n.language)}
          </div>
        ),
      },
      {
        id: "real_estate_count",
        accessorFn: (r) => r.realEstateCount,
        header: t("mp_assets_col_real_estate") || "Properties",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.realEstateCount}
            {row.original.realEstateUnvalued > 0 && (
              <span className="text-muted-foreground ml-1">
                (+{row.original.realEstateUnvalued}{" "}
                {t("mp_assets_unvalued_short") || "n/v"})
              </span>
            )}
          </div>
        ),
      },
      {
        id: "delta_absolute_eur",
        accessorFn: (r) => eur(r.deltaAbsoluteEur),
        header: t("mp_assets_col_yoy") || "YoY change",
        // NULL ordering is a server concern here (DbDataTable sorts in manualSorting mode);
        // the engine's buildOrder emits NULLS LAST, so no-delta rows sort to the bottom.
        cell: ({ row }) => {
          const abs = eur(row.original.deltaAbsoluteEur);
          const pct = eur(row.original.deltaPct);
          if (abs == null) {
            return (
              <div className="text-right text-xs text-muted-foreground">—</div>
            );
          }
          const colorClass =
            abs > 0
              ? "text-green-600"
              : abs < 0
                ? "text-red-600"
                : "text-muted-foreground";
          return (
            <div className={`text-right text-xs tabular-nums ${colorClass}`}>
              <span className="inline-flex items-center gap-0.5">
                {abs > 0 ? (
                  <ArrowUp className="h-3 w-3" />
                ) : abs < 0 ? (
                  <ArrowDown className="h-3 w-3" />
                ) : null}
                {pct != null
                  ? `${Math.abs(pct).toFixed(0)}%`
                  : `${formatThousands(Math.round(Math.abs(abs)))}`}
              </span>
            </div>
          );
        },
      },
      {
        id: "open",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={candidateUrlForMp(row.original.mpId)}
            className="text-primary hover:underline inline-flex"
            aria-label="open candidate"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
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
        // Old screen also disabled this when the selected parliament had no rows in the
        // ranking; server-side paging can't know the per-ns count without a request, and the
        // fan-out matview has rows for every parliament, so we relax to just "no folder".
        disabled={!folder}
      >
        {t("mp_assets_scope_ns") || "Selected parliament"}
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
        {t("mp_assets_scope_all") || "All parliaments"}
      </button>
    </div>
  );

  const pageTitle = t("mp_assets_page_title") || "MPs by declared assets";

  return (
    <div
      data-og="mp-assets-og"
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
          seoDescription={t("mp_assets_page_description") || pageTitle}
        />
      ) : (
        <Title description={t("mp_assets_page_description") || ""}>
          {pageTitle}
        </Title>
      )}
      <DeclarationsBreadcrumb
        currentKey="mp_assets_link_label"
        className="mt-5"
      />

      {/* The group summary reads the SAME matview slice the table pages through — the ns
          bucket plus the region/party mp-id restriction — so a reader can add the rows up to
          the bars. It orders itself by the active metric; the table's own sort is separate. */}
      <div className="mt-5">
        <AssetsByGroup ns={dbScope.val} mpIds={chartMpIds} />
      </div>

      <DbDataTable<MpAssetsRankingRow>
        resource="mp_assets_rankings"
        scope={dbScope}
        columns={columns}
        extraFilters={extraFilters}
        defaultSort={[{ id: "net_worth_eur", desc: true }]}
        pageSize={25}
        toolbar={scopeToggle}
      />

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_assets_page_footer") ||
          "Net worth = sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (all holders named in the declaration) minus declared debts. Source: register.cacbg.bg (Bulgarian Court of Audit). Each MP's most recent filed declaration is used."}
      </div>
    </div>
  );
};
