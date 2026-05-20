import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useRegional,
  type RegionalIndicatorKey,
} from "@/data/regional/useRegional";

// A handful of indicators today — no need for groups. We render labels from
// the metadata in the payload (titleBg / titleEn) so adding another indicator
// only requires extending the fetcher and the type union.
export const RegionalIndicatorSelector: React.FC<{
  value: RegionalIndicatorKey;
  onChange: (k: RegionalIndicatorKey) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const { i18n } = useTranslation();
  const { data } = useRegional();
  if (!data) return null;
  const lang = i18n.language;
  const indicators = Object.entries(data.indicators) as [
    RegionalIndicatorKey,
    (typeof data.indicators)[RegionalIndicatorKey],
  ][];
  const current = data.indicators[value];
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as RegionalIndicatorKey)}
    >
      <SelectTrigger className={className ?? "w-[260px]"}>
        <SelectValue>
          {current ? (lang === "bg" ? current.titleBg : current.titleEn) : ""}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {indicators.map(([key, meta]) => (
          <SelectItem key={key} value={key}>
            {lang === "bg" ? meta.titleBg : meta.titleEn}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
