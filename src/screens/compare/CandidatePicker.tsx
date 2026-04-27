import { FC, useMemo, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type CandidateOption = {
  name: string;
  color?: string;
  partyNick?: string;
  oblastCodes: string[];
  prefs: string[];
};

type Props = {
  label: string;
  value?: string | null;
  options: CandidateOption[];
  placeholder: string;
  onChange: (name: string) => void;
};

const matches = (haystack: string, needle: string) => {
  if (!needle) return true;
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
};

const Row: FC<{ opt: CandidateOption }> = ({ opt }) => (
  <span className="flex items-center gap-2 min-w-0">
    <span
      className="inline-block w-3 h-3 rounded-sm shrink-0"
      style={{ backgroundColor: opt.color || "#888" }}
    />
    <span className="truncate">{opt.name}</span>
    {opt.partyNick && (
      <span className="text-xs text-muted-foreground shrink-0">
        {opt.partyNick}
      </span>
    )}
  </span>
);

export const CandidatePicker: FC<Props> = ({
  label,
  value,
  options,
  placeholder,
  onChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => options.find((o) => o.name === value),
    [options, value],
  );

  // Filter + cap to keep the list responsive on elections with thousands of
  // candidates. cmdk's own filter is fine but we cap to avoid rendering all.
  const filtered = useMemo(() => {
    const out: CandidateOption[] = [];
    for (const o of options) {
      if (matches(o.name, query)) out.push(o);
      if (out.length >= 200) break;
    }
    return out;
  }, [options, query]);

  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal h-10 px-3",
              !selected && "text-muted-foreground",
            )}
          >
            {selected ? (
              <Row opt={selected} />
            ) : (
              <span className="truncate">{placeholder}</span>
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]"
          align="start"
        >
          <CommandPrimitive shouldFilter={false}>
            <CommandInput
              placeholder={`${t("search")}...`}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{t("no_results")}</CommandEmpty>
              {filtered.map((opt) => (
                <CommandPrimitive.Item
                  key={opt.name}
                  value={opt.name}
                  onSelect={() => {
                    onChange(opt.name);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="cursor-pointer px-2 py-2 aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <Row opt={opt} />
                </CommandPrimitive.Item>
              ))}
            </CommandList>
          </CommandPrimitive>
        </PopoverContent>
      </Popover>
    </div>
  );
};
