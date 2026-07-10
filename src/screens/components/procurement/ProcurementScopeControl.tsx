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
  // Controlled mode: when both are supplied the scope lives in the caller's
  // state instead of the `?pscope` URL param. Used by the awarder/company page
  // (which drives a scoped DB fetch, not intra-section nav) to reuse the exact
  // pill UI without hijacking the URL. Omit both for the default URL-backed
  // behaviour on the procurement section pages.
  value?: ProcurementScope;
  onChange?: (next: ProcurementScope) => void;
  // Override the year list in the picker. Defaults to every calendar year since
  // PROCUREMENT_FIRST_YEAR; a caller with sparse coverage (e.g. the farm-subsidy
  // pack's CAP financial years) passes only the years it actually has data for.
  years?: number[];
  // Override the "this parliament" pill label (e.g. "Latest year" for datasets
  // with no per-parliament slice). Defaults to the procurement wording.
  nsLabelOverride?: string;
  // Hide the "All years" option. For datasets read one year at a time (the
  // judiciary caseload is a per-year snapshot with no cross-year aggregate),
  // offering it would select a scope the page cannot render. Defaults to true, so
  // every existing caller keeps its behaviour.
  allowAll?: boolean;
}

const LAST_YEAR = new Date().getFullYear();
const YEARS: number[] = Array.from(
  { length: LAST_YEAR - PROCUREMENT_FIRST_YEAR + 1 },
  (_, i) => LAST_YEAR - i,
);

export const ProcurementScopeControl: FC<Props> = ({
  mode = "toggle",
  className,
  value,
  onChange,
  years,
  nsLabelOverride,
  allowAll = true,
}) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const url = useProcurementScope();
  // Controlled (caller-owned state) when both props are given; otherwise the
  // URL-backed `?pscope` hook drives the control.
  const scope = value ?? url.scope;
  const setScope = onChange ?? url.setScope;
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
  const yearList = years ?? YEARS;
  const nsLabel =
    nsLabelOverride ??
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
            {allowAll && (
              <SelectItem value="all">
                {t("procurement_scope_all_years") || "All years"}
              </SelectItem>
            )}
            {yearList.map((y) => (
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
