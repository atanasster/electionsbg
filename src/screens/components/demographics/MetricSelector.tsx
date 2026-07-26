import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CensusMetric } from "@/data/census/censusTypes";
import { CENSUS_METRICS, METRIC_BY_KEY } from "./censusMetrics";

const groupMetrics = (
  defs: typeof CENSUS_METRICS,
): Record<string, typeof CENSUS_METRICS> => {
  const groups: Record<string, typeof CENSUS_METRICS> = {};
  for (const m of defs) {
    if (!groups[m.i18nGroup]) groups[m.i18nGroup] = [];
    groups[m.i18nGroup].push(m);
  }
  return groups;
};

export const MetricSelector: React.FC<{
  value: CensusMetric;
  onChange: (m: CensusMetric) => void;
  className?: string;
  // Restrict the choosable metrics (e.g. the vote-correlation views only
  // support the percentage metrics — not absolute `population`). Defaults to
  // the full census metric set.
  metrics?: CensusMetric[];
}> = ({ value, onChange, className, metrics }) => {
  const { t } = useTranslation();
  const def = METRIC_BY_KEY[value];

  const groupedMetrics = useMemo(() => {
    const allow = metrics ? new Set(metrics) : undefined;
    return groupMetrics(
      allow ? CENSUS_METRICS.filter((m) => allow.has(m.key)) : CENSUS_METRICS,
    );
  }, [metrics]);

  return (
    <Select value={value} onValueChange={(v) => onChange(v as CensusMetric)}>
      <SelectTrigger className={className ?? "w-[260px]"}>
        <SelectValue>{def ? t(def.i18nKey) : ""}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedMetrics).map(([groupKey, metrics]) => (
          <SelectGroup key={groupKey}>
            <SelectLabel>{t(groupKey)}</SelectLabel>
            {metrics.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {t(m.i18nKey)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
};
