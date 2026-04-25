import { FC } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { localDate } from "@/data/utils";

type Props = {
  label: string;
  value?: string | null;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
};

export const ElectionPicker: FC<Props> = ({
  label,
  value,
  options,
  placeholder,
  onChange,
}) => {
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
          {options.map((name) => (
            <SelectItem key={name} value={name}>
              {localDate(name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
