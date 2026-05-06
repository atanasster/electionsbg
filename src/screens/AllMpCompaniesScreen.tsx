import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Briefcase, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { useCompanyIndex, CompanyEntry } from "@/data/parliament/useCompanyIndex";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";

const STATUS_CLASSES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  in_liquidation:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  bankrupt: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  ceased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  erased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const STATUS_ORDER: Record<string, number> = {
  active: 4,
  in_liquidation: 3,
  ceased: 2,
  bankrupt: 1,
};

type DistinctMp = { name: string; mpId: number | null; viaStake: boolean };
type RowData = CompanyEntry & {
  distinctMps: DistinctMp[];
  mpCount: number;
  searchBlob: string;
  status: string;
};

export const AllMpCompaniesScreen: FC = () => {
  const { t } = useTranslation();
  const { companies, isLoading } = useCompanyIndex();

  const data = useMemo<RowData[]>(() => {
    return companies.map((c) => {
      // One MP can declare the same company across multiple years and the
      // declarantName casing varies between filings (cacbg writes some years
      // ALL CAPS, others Title Case). Dedup case-insensitively, keeping the
      // first observed display form for each. Then merge in the post-graph
      // mpRoles list so TR-only relationships (manager, partner, …) show up
      // alongside declared stakes.
      const seen = new Map<string, DistinctMp>();
      for (const s of c.stakes) {
        const key = s.declarantName.toUpperCase().replace(/\s+/g, " ").trim();
        if (!seen.has(key))
          seen.set(key, {
            name: s.declarantName,
            mpId: s.mpId ?? null,
            viaStake: true,
          });
      }
      for (const r of c.mpRoles ?? []) {
        const key = r.mpName.toUpperCase().replace(/\s+/g, " ").trim();
        if (!seen.has(key))
          seen.set(key, { name: r.mpName, mpId: r.mpId, viaStake: false });
      }
      const distinctMps = Array.from(seen.values());
      const searchParts = [c.displayName, ...c.registeredOffices];
      if (c.tr?.uic) searchParts.push(c.tr.uic);
      for (const m of distinctMps) searchParts.push(m.name);
      return {
        ...c,
        distinctMps,
        mpCount: distinctMps.length,
        searchBlob: searchParts.join(" "),
        status: c.tr?.status ?? "",
      };
    });
  }, [companies]);

  const columns: DataTableColumns<RowData, unknown> = useMemo(
    () => [
      {
        accessorKey: "displayName",
        header: t("all_companies_col_name") || "Company",
        accessorFn: (row) => row.searchBlob,
        sortingFn: (a, b) =>
          a.original.displayName.localeCompare(b.original.displayName, "bg", {
            sensitivity: "base",
          }),
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="min-w-0">
              <Link
                to={`/mp/company/${encodeURIComponent(c.slug)}`}
                className="font-medium hover:underline"
              >
                <Briefcase className="inline h-3.5 w-3.5 mr-1 text-muted-foreground -mt-0.5" />
                {c.displayName}
              </Link>
              <div className="text-xs text-muted-foreground">
                {c.registeredOffices.length > 0 && (
                  <span>{c.registeredOffices.join(" · ")}</span>
                )}
                {c.tr?.uic && (
                  <a
                    href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${c.tr.uic}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t("tr_eik") || "UIC"} {c.tr.uic}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: "mps",
        header: t("all_companies_col_mps") || "Linked MPs",
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="min-w-0 text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {c.distinctMps.slice(0, 3).map((m) => (
                <span
                  key={m.name}
                  className="inline-flex items-center gap-1 max-w-full"
                >
                  <MpAvatar
                    name={m.name}
                    mpId={m.mpId ?? undefined}
                    className="h-4 w-4"
                  />
                  <Link
                    to={
                      m.mpId != null
                        ? candidateUrlForMp(m.mpId)
                        : `/candidate/${encodeURIComponent(m.name)}`
                    }
                    className="hover:underline truncate"
                  >
                    {m.name}
                  </Link>
                </span>
              ))}
              {c.distinctMps.length > 3 && (
                <span>+{c.distinctMps.length - 3}</span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "mpCount",
        header: "#",
        dataType: "thousands",
      },
      {
        accessorKey: "status",
        header: t("all_companies_col_status") || "Status",
        sortingFn: (a, b) => {
          const sa = STATUS_ORDER[a.original.status] ?? 0;
          const sb = STATUS_ORDER[b.original.status] ?? 0;
          return sa - sb;
        },
        cell: ({ row }) => {
          const status = row.original.tr?.status;
          if (!status) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
                STATUS_CLASSES[status] ?? STATUS_CLASSES.active
              }`}
            >
              {t(`tr_status_${status}`) || status}
            </span>
          );
        },
      },
    ],
    [t],
  );

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("all_companies_description") || ""}>
        {t("all_companies") || "MP-connected companies"}
      </Title>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("loading") || "Loading…"}
        </div>
      ) : (
        <DataTable<RowData, unknown>
          title={t("all_companies") || "MP-connected companies"}
          pageSize={25}
          columns={columns}
          data={data}
          initialSort={[{ id: "mpCount", desc: true }]}
        />
      )}
    </div>
  );
};
