import type { DataProvenanceScope } from "@/data/dataTypes";

// Month + year with no day, so it cannot use @/lib/formatDate. The UTC pin is scoped to a
// date-ONLY input for the same reason that module scopes it: a bare calendar day is parsed
// as UTC midnight and falls into the previous month in any negative-offset zone, while a
// real timestamp should still be shown in the reader's own zone.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const formatRefreshDate = (iso: string | undefined, locale: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "bg" ? "bg-BG" : "en-GB", {
    month: "short",
    year: "numeric",
    ...(DATE_ONLY.test(iso) ? { timeZone: "UTC" as const } : {}),
  });
};

export const provenanceText = (
  scope: DataProvenanceScope | undefined,
  generatedAt: string | undefined,
  locale: string,
  t: (key: string, fallback?: string, opts?: Record<string, unknown>) => string,
  isRegional: boolean = false,
): string => {
  if (!scope || scope.mpsWithDeclaration === 0) {
    if (isRegional) {
      return t(
        "dashboard_mp_connections_provenance_region_none",
        "No MPs in this region have filed yet",
      );
    }
    return t(
      "dashboard_mp_connections_provenance_none",
      "No declarations on file for this parliament yet",
    );
  }
  const refreshed = formatRefreshDate(generatedAt, locale);
  const opts = {
    filed: scope.mpsWithDeclaration,
    total: scope.mpsTotal,
    date: refreshed,
  };
  if (scope.declarationYearMin === scope.declarationYearMax) {
    if (isRegional) {
      return t(
        "dashboard_mp_connections_provenance_region_one_year",
        "Declarations {{year}} · {{filed}}/{{total}} MPs filed in this region · refreshed {{date}}",
        { ...opts, year: scope.declarationYearMin },
      );
    }
    return t(
      "dashboard_mp_connections_provenance_one_year",
      "Declarations {{year}} · {{filed}}/{{total}} MPs filed · refreshed {{date}}",
      { ...opts, year: scope.declarationYearMin },
    );
  }
  if (isRegional) {
    return t(
      "dashboard_mp_connections_provenance_region",
      "Declarations {{from}}–{{to}} · {{filed}}/{{total}} MPs filed in this region · refreshed {{date}}",
      {
        ...opts,
        from: scope.declarationYearMin,
        to: scope.declarationYearMax,
      },
    );
  }
  return t(
    "dashboard_mp_connections_provenance",
    "Declarations {{from}}–{{to}} · {{filed}}/{{total}} MPs filed · refreshed {{date}}",
    {
      ...opts,
      from: scope.declarationYearMin,
      to: scope.declarationYearMax,
    },
  );
};

export const provenanceTooltip = (
  scope: DataProvenanceScope | undefined,
): string => {
  if (!scope || scope.mpsWithDeclaration === 0) return "";
  const years = Object.entries(scope.latestDeclarationYearByCount)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, count]) => `${year}: ${count}`)
    .join(" · ");
  return `Latest filing per MP — ${years}`;
};
