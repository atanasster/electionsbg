// Shared scope control for every public-money view (procurement, water,
// defense, culture, judiciary, subsidies, the sectors hub). Rendered in the same
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
//
// THE CONTROL NEVER INVENTS A SCOPE. It shows the one that is active, including
// a year outside its own `years` list — `?pscope` is shared across every
// public-money section and rides along on ordinary in-app links, so a scope
// minted where it is valid (y:2019 on /procurement) reaches pages whose picker
// has no such option. Radix renders a controlled Select value with no matching
// item as EMPTY — not even the placeholder — which left the whole widget reading
// as the page default while the page answered for something else entirely, so
// the year is rendered explicitly rather than left to item lookup.
//
// A page that CANNOT serve such a year must resolve it itself (useScope(support)
// → resolveScope) and hand the control the resolved scope via `value`; then the
// pill and the numbers agree because they are the same value. A page that serves
// an explicit "no data for this year" state instead (see /subsidies) passes
// nothing and the reader keeps seeing the year they asked for.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElectionContext } from "@/data/ElectionContext";
import {
  Scope,
  defaultScopeYears,
  scopeYear,
  useScope,
} from "@/data/scope/useScope";
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
  value?: Scope;
  onChange?: (next: Scope) => void;
  // Override the year list in the picker. Defaults to every calendar year since
  // SCOPE_FIRST_YEAR; a caller with sparse coverage (e.g. the farm-subsidy
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

const YEARS: number[] = defaultScopeYears();

export const ScopeControl: FC<Props> = ({
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
  const yearList = years ?? YEARS;
  const url = useScope();
  // Controlled (caller-owned state) when both props are given; otherwise the
  // URL-backed `?pscope` hook drives the control.
  //
  // The active scope is taken AS GIVEN. A controlled `value` has already been
  // resolved by the page against its own coverage, and `url.scope` by useScope
  // against the corpus — running either through a second, differently-bounded
  // resolve here is how the mismatch creeps back: a caller whose coverage sits
  // outside the corpus band (budget and pension series predate 2011) would have
  // its own year clamped to "ns" while the page counted that year.
  //
  // The single exception is "all" with the option switched off: there is no item
  // and no label for a mode the control was told this page does not have.
  const active = value ?? url.scope;
  const scope: Scope = active === "all" && !allowAll ? "ns" : active;
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
  const nsLabel =
    nsLabelOverride ??
    (t("procurement_scope_this_ns") || "This parliament") +
      (electionLabel ? ` · ${electionLabel}` : "");
  // The trigger's own label, rather than whichever <SelectItem> happens to match
  // — the whole point of the header note. `undefined` for "ns" so Radix falls
  // through to the placeholder.
  const activeLabel = nsActive
    ? undefined
    : scope === "all"
      ? t("procurement_scope_all_years") || "All years"
      : String(scopeYear(scope));

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
          onValueChange={(v) => setScope(v as Scope)}
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
            <SelectValue placeholder={t("procurement_scope_years") || "Years"}>
              {activeLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {allowAll && (
              <SelectItem value="all">
                {t("procurement_scope_all_years") || "All years"}
              </SelectItem>
            )}
            {/* Only the years the caller actually covers are offered. An active
                year outside them is still SHOWN (activeLabel above) — visible
                and switchable-away-from, without pretending it has data. */}
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
