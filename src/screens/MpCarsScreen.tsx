import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { useMpCars } from "@/data/parliament/useMpCars";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import type { MpCarRow } from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useRegionScope } from "@/screens/utils/useRegionScope";
import { RegionScopeChip } from "@/screens/utils/RegionScopeChip";
import { usePartyScope } from "@/screens/utils/usePartyScope";
import { PartyScopeChip } from "@/screens/utils/PartyScopeChip";
import { PartyHeader } from "@/screens/components/party/PartyHeader";

type Scope = "ns" | "all";

const formatBgn = (n: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

export const MpCarsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { mpCars } = useMpCars();
  const { selected } = useElectionContext();
  const [scope, setScope] = useState<Scope>("ns");
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

  const source: MpCarRow[] = useMemo(() => {
    if (!mpCars) return [];
    let rows: MpCarRow[];
    if (scope === "ns" && folder) {
      const inScope = mpCars.cars.filter((c) => c.nsFolders.includes(folder));
      // Fall back to lifetime when the selected NS produced nothing — avoids
      // an empty page on parliaments with no filings yet.
      rows = inScope.length > 0 ? inScope : mpCars.cars;
    } else {
      rows = mpCars.cars;
    }
    if (regionMpIds) {
      rows = rows.filter((c) => regionMpIds.has(c.mpId));
    }
    if (partyMpIds) {
      rows = rows.filter((c) => partyMpIds.has(c.mpId));
    }
    return rows;
  }, [mpCars, scope, folder, regionMpIds, partyMpIds]);

  const columns: DataTableColumns<MpCarRow, unknown> = useMemo(
    () => [
      {
        accessorKey: "mpName",
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
        accessorKey: "partyGroupShort",
        header: t("mp_cars_col_party") || "Party group",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
            {row.original.partyGroupShort ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "make",
        header: t("mp_cars_col_make") || "Make",
        cell: ({ row }) =>
          row.original.make ?? (
            <span className="text-muted-foreground italic">
              {t("mp_cars_unknown_make") || "unknown"}
            </span>
          ),
      },
      {
        accessorKey: "detail",
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
        accessorKey: "acquiredYear",
        header: t("mp_cars_col_year") || "Year",
        sortUndefined: "last",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.acquiredYear ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "valueBgn",
        header: t("mp_cars_col_value") || "Value (BGN)",
        sortUndefined: "last",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono">
            {row.original.valueBgn != null ? (
              formatBgn(row.original.valueBgn, i18n.language)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "isSpouse",
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
    [t, i18n.language],
  );

  if (!mpCars) return null;

  const totalValue = source.reduce((s, r) => s + (r.valueBgn ?? 0), 0);
  const valued = source.filter((r) => r.valueBgn != null).length;

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
      className={
        partyFullName
          ? "w-full max-w-7xl mx-auto px-4 md:px-8 pb-12"
          : "w-full"
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

      <div className="text-xs text-muted-foreground mt-4 mb-2">
        {t("mp_cars_page_summary", {
          defaultValue:
            "{{total}} cars · {{valued}} with declared value · combined {{sum}} BGN",
          total: source.length,
          valued,
          sum: formatBgn(totalValue, i18n.language),
        })}
      </div>

      <DataTable<MpCarRow, unknown>
        title={pageTitle}
        pageSize={25}
        columns={columns}
        data={source}
        toolbarItems={scopeToggle}
        initialSort={[{ id: "valueBgn", desc: true }]}
      />

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_cars_page_footer") ||
          "Cars (passenger vehicles + jeeps) extracted from the most-recent declaration of every MP. Spouse-held cars are listed with holder = spouse. Source: register.cacbg.bg (Bulgarian Court of Audit)."}
      </div>
    </div>
  );
};
