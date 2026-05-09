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

const groupedMetrics = (() => {
  const groups: Record<string, typeof CENSUS_METRICS> = {};
  for (const m of CENSUS_METRICS) {
    if (!groups[m.i18nGroup]) groups[m.i18nGroup] = [];
    groups[m.i18nGroup].push(m);
  }
  return groups;
})();

export const MetricSelector: React.FC<{
  value: CensusMetric;
  onChange: (m: CensusMetric) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const { t } = useTranslation();
  const def = METRIC_BY_KEY[value];

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
