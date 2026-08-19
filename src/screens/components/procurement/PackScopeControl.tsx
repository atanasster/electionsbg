// The time control for a pack that OWNS its page's scope
// (SectorDashboardConfig.packOwnsScope) — the collector packs, Митници and НАП,
// whose year list is whatever their own query returned and so cannot live in the
// screen's config.
//
// ⚠️ THE POINT IS THAT THE PILL AND THE FIGURES ARE ONE VALUE. `usePackScope`
// resolves `?pscope` against the years the pack can actually serve and hands the
// SAME resolved scope to the control. Inlining that per pack is how „the pill
// read 2022 above „…митническите приходи (2025)" and €7,4 млрд" happened, and an
// UNCONTROLLED <ScopeControl> repaints it exactly: it runs its own `useScope()`
// with no support, which resolves the param against every year since 2011 and
// paints one the pack cannot render. So the two halves ship as one unit here,
// and no caller assembles them by hand.
//
// ⚠️ RENDER `strip` ABOVE THE PACK'S OWN EARLY RETURNS. The screen's suppression
// is STRUCTURAL — it drops its own control the moment the EIK is in the pack
// registry — while a pack's content is conditional on a lazy chunk and a fetch.
// A pack that returns its skeleton, or null on a failed corpus, before rendering
// this leaves the page with NO time control at all and no explanation.

import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useScope, scopeYear, type Scope } from "@/data/scope/useScope";

/** The resolved scope, the year it selects, and the control to render — as ONE
 *  value, so a caller cannot resolve against one year list and paint another.
 *
 *  The strip is built inline rather than exported as a component on purpose:
 *  there is no way to mount the control with a scope resolved some other way,
 *  which is the „pill 2022 over 2025 figures" state reassembled by hand. (It also
 *  keeps this module a hook-only export, which is what react-refresh wants.)
 *
 *  `year` is the selected calendar year, or `null` while `years` is still empty
 *  (the corpus has not loaded); callers fall back to their own newest entry. */
export const usePackScope = (
  years: number[],
): { scope: Scope; year: number | null; strip: ReactNode } => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { scope, setScope } = useScope({ years, allowAll: false });
  return {
    scope,
    year: scopeYear(scope) ?? years[0] ?? null,
    strip: (
      <div className="mb-3">
        <ScopeControl
          mode="toggle"
          value={scope}
          onChange={setScope}
          years={years}
          // Each year is its own file/snapshot and there is no cross-year
          // aggregate to render, so „all years" is a scope these packs genuinely
          // cannot serve — same reason the judiciary caseload turns it off.
          allowAll={false}
          // No per-parliament slice either: a collector's year is a fiscal year,
          // so `ns` means „the latest one" and has to say so.
          nsLabelOverride={bg ? "Последна година" : "Latest year"}
        />
      </div>
    ),
  };
};
