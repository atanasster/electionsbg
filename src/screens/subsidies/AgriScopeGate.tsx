// The two shared /subsidies scope COMPONENTS. The hook and the scoped-href helper
// live in @/data/agri/useAgriScope — separate file so react-refresh keeps working
// (a module that exports both components and plain functions loses fast refresh).
// Read that file's header for what the four states mean and why the scope is read
// unresolved.

import { type FC, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange } from "lucide-react";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";
import { scopeYear } from "@/data/scope/useScope";
import type { AgriScopeState } from "@/data/agri/useAgriScope";
import { agriLabel } from "@/data/agri/labels";

/** The „Обхват" pill row. */
export const AgriScopePicker: FC<{ className?: string }> = ({ className }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" />
        {agriLabel.scope(bg)}
      </span>
      <ScopeControl
        years={AGRI_FINANCIAL_YEARS}
        nsLabelOverride={agriLabel.latestYear(bg)}
      />
    </div>
  );
};

/** The three non-ready states, rendered identically everywhere. */
export const AgriScopeFallback: FC<{
  gate: AgriScopeState;
  /** Skeleton height while loading; the caller knows what it is about to draw. */
  loadingClassName?: string;
  children: ReactNode;
}> = ({ gate, loadingClassName, children }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { state, paused, scope, setScope, refetch } = gate;

  if (state === "ready") return <>{children}</>;

  if (state === "loading")
    return (
      <div
        className={
          loadingClassName ??
          "h-[420px] animate-pulse rounded-xl border bg-card shadow-sm"
        }
      />
    );

  if (state === "failed")
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
        <p className={paused ? "" : "mb-3"}>
          {paused
            ? bg
              ? "Данните за субсидиите още не са заредени — изчакваме връзката. Ще опитаме отново автоматично."
              : "The subsidy data hasn't loaded yet — waiting for the connection. It will retry automatically."
            : bg
              ? "Данните за субсидиите не се заредиха. Обикновено е временно."
              : "The subsidy data failed to load. This is usually temporary."}
        </p>
        {/* No retry while PAUSED: React Query refuses to run one in that state and
            resumes by itself on reconnect or when the tab returns to the foreground,
            so the button would do nothing but look like it might. */}
        {!paused && (
          <button
            type="button"
            onClick={refetch}
            className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
          >
            {agriLabel.tryAgain(bg)}
          </button>
        )}
      </div>
    );

  return (
    <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
      <p className="mb-1">
        {bg
          ? `Няма данни за субсидии за ${scopeYear(scope) ?? "избрания период"}.`
          : `No subsidy data for ${scopeYear(scope) ?? "the selected period"}.`}
      </p>
      <p className="mb-3">
        {/* „публикува данни ЗА следните години" — the Fund publishes payments for a
            financial year, it does not publish the year. */}
        {bg
          ? `ДФ „Земеделие“ публикува данни за следните финансови години: ${AGRI_FINANCIAL_YEARS.join(", ")}.`
          : `The State Fund Agriculture publishes data for these financial years: ${AGRI_FINANCIAL_YEARS.join(", ")}.`}
      </p>
      {/* Only when it would actually go somewhere: on a database where the loader
          never ran, the default scope 404s too and this card renders for "ns" itself,
          where an offer to switch to the active scope is a dead control. */}
      {scope !== "ns" && (
        <button
          type="button"
          onClick={() => setScope("ns")}
          className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
        >
          {bg
            ? `Покажи последната година (${AGRI_FINANCIAL_YEARS[0]})`
            : `Show the latest year (${AGRI_FINANCIAL_YEARS[0]})`}
        </button>
      )}
    </div>
  );
};
