// Shared chrome for every procurement section page: the nav pills + the scope
// control, rendered in one consistent order directly under the page <Title>.
// Centralising this kills the per-page drift (nav above/below, scope only on
// the landing, bespoke back-links) — each page just drops it in after its
// title and picks a scope mode.
//
//   scopeMode="toggle" — live "this parliament / all years" segmented control
//                        (pages backed by a per-NS data slice).
//   scopeMode="corpus" — static "all years" badge (pages that only have a
//                        full-corpus view today).
//   scopeMode="none"   — no scope row (the watchlist is per-user, scope-free).

import { FC } from "react";
import { ProcurementNav } from "./ProcurementNav";
import { ProcurementScopeControl } from "./ProcurementScopeControl";

export const ProcurementSectionHeader: FC<{
  scopeMode?: "toggle" | "corpus" | "none";
}> = ({ scopeMode = "toggle" }) => (
  <div>
    <ProcurementNav />
    {scopeMode !== "none" ? (
      <div className="mb-3">
        <ProcurementScopeControl
          mode={scopeMode === "corpus" ? "corpus" : "toggle"}
        />
      </div>
    ) : null}
  </div>
);
