import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useIndicators,
  type IndicatorId,
} from "@/data/indicators/useIndicators";

// Single indicator today; the selector is here so adding DZI / EU funds /
// healthcare in Phase 5-6 is a one-line change (extend the IndicatorId
// union; the labels come from the payload metadata).
export const IndicatorsSelector: React.FC<{
  value: IndicatorId;
  onChange: (k: IndicatorId) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const { i18n } = useTranslation();
  const { data } = useIndicators();
  if (!data) return null;
  const lang = i18n.language;
  const indicators = Object.entries(data.indicators) as [
    IndicatorId,
    (typeof data.indicators)[IndicatorId],
  ][];
  const current = data.indicators[value];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as IndicatorId)}>
      <SelectTrigger className={className ?? "w-[260px]"}>
        <SelectValue>
          {current ? (lang === "bg" ? current.labelBg : current.labelEn) : ""}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {indicators.map(([key, meta]) => (
          <SelectItem key={key} value={key}>
            {lang === "bg" ? meta.labelBg : meta.labelEn}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
