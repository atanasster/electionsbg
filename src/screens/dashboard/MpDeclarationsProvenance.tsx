import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDataProvenance } from "@/data/parliament/useDataProvenance";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { Hint } from "@/ux/Hint";
import type { DataProvenanceScope } from "@/data/dataTypes";

const formatRefreshDate = (iso: string | undefined, locale: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "bg" ? "bg-BG" : "en-GB", {
    month: "short",
    year: "numeric",
  });
};

const mergeScopes = (scopes: DataProvenanceScope[]): DataProvenanceScope => {
  let mpsTotal = 0;
  let mpsWithDeclaration = 0;
  let min: number | null = null;
  let max: number | null = null;
  const byCount: Record<string, number> = {};
  for (const s of scopes) {
    mpsTotal += s.mpsTotal;
    mpsWithDeclaration += s.mpsWithDeclaration;
    if (s.declarationYearMin != null) {
      min = min == null ? s.declarationYearMin : Math.min(min, s.declarationYearMin);
    }
    if (s.declarationYearMax != null) {
      max = max == null ? s.declarationYearMax : Math.max(max, s.declarationYearMax);
    }
    for (const [year, count] of Object.entries(s.latestDeclarationYearByCount)) {
      byCount[year] = (byCount[year] ?? 0) + count;
    }
  }
  return {
    mpsTotal,
    mpsWithDeclaration,
    declarationYearMin: min,
    declarationYearMax: max,
    latestDeclarationYearByCount: byCount,
  };
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

type Props = {
  /** Single oblast code (e.g. "S23"). When set, the subtitle scopes to MPs
   * whose currentRegion matches that MIR. Mutually exclusive with
   * `regionCodes`. */
  regionCode?: string;
  /** Set of oblast codes (e.g. Sofia's three MIRs). Their per-MIR scopes
   * are summed. */
  regionCodes?: string[];
  className?: string;
};

export const MpDeclarationsProvenance: FC<Props> = ({
  regionCode,
  regionCodes,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { provenance } = useDataProvenance();
  const { selected } = useElectionContext();

  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const codes = useMemo(() => {
    if (regionCodes && regionCodes.length > 0) return regionCodes;
    if (regionCode) return [regionCode];
    return null;
  }, [regionCode, regionCodes]);

  const isRegional = codes != null;

  const scope = useMemo(() => {
    if (!provenance) return undefined;
    if (codes && selectedFolder) {
      const regionMap = provenance.byNsRegion?.[selectedFolder];
      if (!regionMap) return undefined;
      const parts: DataProvenanceScope[] = [];
      for (const code of codes) {
        const mir = oblastToMir(code);
        if (!mir) continue;
        const s = regionMap[mir];
        if (s) parts.push(s);
      }
      if (parts.length === 0) return undefined;
      return mergeScopes(parts);
    }
    if (selectedFolder && provenance.byNs[selectedFolder]) {
      return provenance.byNs[selectedFolder];
    }
    return provenance.all;
  }, [provenance, selectedFolder, codes]);

  if (!scope) return null;

  const text = provenanceText(
    scope,
    provenance?.generatedAt,
    i18n.language,
    (key, fallback, opts) => t(key, fallback ?? key, opts),
    isRegional,
  );
  const tooltip = provenanceTooltip(scope);

  return (
    <Hint text={tooltip} underline={false} className={className}>
      <span className="text-xs text-muted-foreground">{text}</span>
    </Hint>
  );
};
