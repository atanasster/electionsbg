import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDataProvenance } from "@/data/parliament/useDataProvenance";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
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

export const provenanceText = (
  scope: DataProvenanceScope | undefined,
  generatedAt: string | undefined,
  locale: string,
  t: (key: string, fallback?: string, opts?: Record<string, unknown>) => string,
): string => {
  if (!scope || scope.mpsWithDeclaration === 0) {
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
    return t(
      "dashboard_mp_connections_provenance_one_year",
      "Declarations {{year}} · {{filed}}/{{total}} MPs filed · refreshed {{date}}",
      { ...opts, year: scope.declarationYearMin },
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
  className?: string;
};

export const MpDeclarationsProvenance: FC<Props> = ({ className }) => {
  const { t, i18n } = useTranslation();
  const { provenance } = useDataProvenance();
  const { selected } = useElectionContext();

  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const scope = useMemo(() => {
    if (!provenance) return undefined;
    if (selectedFolder && provenance.byNs[selectedFolder]) {
      return provenance.byNs[selectedFolder];
    }
    return provenance.all;
  }, [provenance, selectedFolder]);

  if (!scope) return null;

  const text = provenanceText(
    scope,
    provenance?.generatedAt,
    i18n.language,
    (key, fallback, opts) => t(key, fallback ?? key, opts),
  );
  const tooltip = provenanceTooltip(scope);

  return (
    <Hint text={tooltip} underline={false} className={className}>
      <span className="text-xs text-muted-foreground">{text}</span>
    </Hint>
  );
};
