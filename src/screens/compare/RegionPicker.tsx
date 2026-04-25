import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RegionInfo } from "@/data/dataTypes";

type Props = {
  label: string;
  value?: string | null;
  regions: RegionInfo[];
  placeholder: string;
  onChange: (value: string) => void;
};

export const RegionPicker: FC<Props> = ({
  label,
  value,
  regions,
  placeholder,
  onChange,
}) => {
  const { i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {regions.map((r) => {
            const display = isBg
              ? r.long_name || r.name
              : r.long_name_en || r.name_en || r.name;
            return (
              <SelectItem key={r.oblast} value={r.oblast}>
                {display}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};
