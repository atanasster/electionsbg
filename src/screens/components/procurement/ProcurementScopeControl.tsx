// Section-wide scope control for the procurement pages. Rendered in the same
// slot on every page (directly under the nav pills) so the reader always finds
// "what time range am I looking at?" in one place.
//
//   mode="toggle" — a live segmented control: "this parliament" (NS-scoped) vs
//                   "all years" (full corpus). Backed by the `?pscope` URL
//                   param so it's shareable and survives intra-section nav.
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
  useProcurementScope,
} from "@/data/procurement/useProcurementScope";

interface Props {
  mode?: "toggle" | "corpus";
  className?: string;
}

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

  const options: { value: ProcurementScope; label: string }[] = [
    {
      value: "ns",
      label:
        (t("procurement_scope_this_ns") || "This parliament") +
        (electionLabel ? ` · ${electionLabel}` : ""),
    },
    { value: "all", label: t("procurement_scope_all_years") || "All years" },
  ];

  return (
    <div
      className={cn("inline-flex flex-wrap items-center gap-2", className)}
      role="group"
      aria-label={t("procurement_scope_aria") || "Time range"}
    >
      <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
        {options.map((o) => {
          const active = scope === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => setScope(o.value)}
              className={cn(
                "rounded-full px-3 py-1 font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
