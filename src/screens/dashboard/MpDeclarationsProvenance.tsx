import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDataProvenance } from "@/data/parliament/useDataProvenance";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { Hint } from "@/ux/Hint";
import type { DataProvenanceScope } from "@/data/dataTypes";
import { provenanceText, provenanceTooltip } from "./provenanceUtils";

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
      min =
        min == null
          ? s.declarationYearMin
          : Math.min(min, s.declarationYearMin);
    }
    if (s.declarationYearMax != null) {
      max =
        max == null
          ? s.declarationYearMax
          : Math.max(max, s.declarationYearMax);
    }
    for (const [year, count] of Object.entries(
      s.latestDeclarationYearByCount,
    )) {
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

type Props = {
  /** Single oblast code (e.g. "S23"). When set, the subtitle scopes to MPs
   * whose currentRegion matches that MIR. Mutually exclusive with
   * `regionCodes`. */
  regionCode?: string;
  /** Set of oblast codes (e.g. Sofia's three MIRs). Their per-MIR scopes
   * are summed. */
  regionCodes?: string[];
  /** Explicit NS folder override ("52", "51", …). When provided as a string,
   * uses that parliament's per-NS scope regardless of the global election
   * selector. Pass `null` to force the lifetime ("All parliaments") scope.
   * Leave `undefined` to fall through to the election-context default. */
  nsFolder?: string | null;
  className?: string;
};

export const MpDeclarationsProvenance: FC<Props> = ({
  regionCode,
  regionCodes,
  nsFolder,
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

  const effectiveFolder = nsFolder === undefined ? selectedFolder : nsFolder;

  const scope = useMemo(() => {
    if (!provenance) return undefined;
    if (codes && effectiveFolder) {
      const regionMap = provenance.byNsRegion?.[effectiveFolder];
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
    if (effectiveFolder && provenance.byNs[effectiveFolder]) {
      return provenance.byNs[effectiveFolder];
    }
    return provenance.all;
  }, [provenance, effectiveFolder, codes]);

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
