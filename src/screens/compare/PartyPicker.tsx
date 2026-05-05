import { FC } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";

export type PartyOption = {
  partyNum: number;
  nickName: string;
  color?: string;
  pct?: number;
};

type Props = {
  label: string;
  value?: number | null;
  options: PartyOption[];
  placeholder: string;
  onChange: (partyNum: number) => void;
};

export const PartyPicker: FC<Props> = ({
  label,
  value,
  options,
  placeholder,
  onChange,
}) => {
  const { displayNameFor } = useCanonicalParties();
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Select
        value={
          value !== undefined && value !== null ? String(value) : undefined
        }
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((p) => (
            <SelectItem key={p.partyNum} value={String(p.partyNum)}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: p.color || "#888" }}
                />
                <span className="truncate">
                  {displayNameFor(p.nickName) ?? p.nickName}
                </span>
                {p.pct !== undefined && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.pct.toFixed(1)}%
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
