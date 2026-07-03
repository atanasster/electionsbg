// Section-wide scope control for the procurement pages. Rendered in the same
// slot on every page (directly under the nav pills) so the reader always finds
// "what time range am I looking at?" in one place.
//
//   mode="toggle" — two pills: "this parliament" (NS-scoped) vs a years picker
//                   (all years, or one calendar year). Backed by the `?pscope`
//                   URL param so it's shareable and survives intra-section nav.
//   mode="corpus" — a static "all years" badge for pages whose data is only
//                   published full-corpus (no per-NS slice yet). Keeps the slot
//                   consistent and is honest about the scope instead of leaving
//                   the reader to guess.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElectionContext } from "@/data/ElectionContext";
import {
  ProcurementScope,
  PROCUREMENT_FIRST_YEAR,
  useProcurementScope,
} from "@/data/procurement/useProcurementScope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  mode?: "toggle" | "corpus";
  className?: string;
}

const LAST_YEAR = new Date().getFullYear();
const YEARS: number[] = Array.from(
  { length: LAST_YEAR - PROCUREMENT_FIRST_YEAR + 1 },
  (_, i) => LAST_YEAR - i,
);

export const ProcurementScopeControl: FC<Props> = ({
  mode = "toggle",
  className,
}) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { scope, setScope } = useProcurementScope();
  const electionLabel = selected?.replace(/_/g, "-");

  if (mode === "corpus") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground",
          className,
        )}
      >
        <CalendarRange className="h-3.5 w-3.5" />
        {t("procurement_scope_corpus_badge") || "Scope: all years"}
      </div>
    );
  }

  const nsActive = scope === "ns";
  const nsLabel =
    (t("procurement_scope_this_ns") || "This parliament") +
    (electionLabel ? ` · ${electionLabel}` : "");

  return (
    <div
      className={cn("inline-flex flex-wrap items-center gap-2", className)}
      role="group"
      aria-label={t("procurement_scope_aria") || "Time range"}
    >
      <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
        <button
          type="button"
          aria-pressed={nsActive}
          onClick={() => setScope("ns")}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors",
            nsActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {nsLabel}
        </button>
        <Select
          // "ns" has no matching item → Radix shows the placeholder pill.
          value={nsActive ? "" : scope}
          onValueChange={(v) => setScope(v as ProcurementScope)}
        >
          <SelectTrigger
            aria-label={t("procurement_scope_years") || "Years"}
            className={cn(
              "h-auto w-auto gap-1 rounded-full border-0 px-3 py-1 text-xs font-medium shadow-none focus:ring-0 [&>svg]:h-3 [&>svg]:w-3",
              nsActive
                ? "text-muted-foreground hover:text-foreground"
                : "bg-primary text-primary-foreground [&>svg]:opacity-80",
            )}
          >
            <SelectValue
              placeholder={t("procurement_scope_years") || "Years"}
            />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">
              {t("procurement_scope_all_years") || "All years"}
            </SelectItem>
            {YEARS.map((y) => (
              <SelectItem key={y} value={`y:${y}`}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
