// Shared chrome for every procurement section page: the hierarchy breadcrumb +
// the scope control, rendered in one consistent order directly under the page
// <Title>. Centralising this kills the per-page drift (nav above/below, scope
// only on the landing, bespoke back-links) — each page drops it in after its
// title, names its current sub-page, and picks a scope mode.
//
// The breadcrumb (Управление › Обществени поръчки › <this page>) replaced the
// old ProcurementNav pill rows — the hub (/procurement) fronts the sub-pages as
// tiles, so lateral navigation happens there rather than via a pill strip on
// every page (matches the sectors sub-pages).
//
//   current            — i18n key for this sub-page's breadcrumb leaf.
//   scopeMode="toggle" — live "this parliament / all years" segmented control
//                        (pages backed by a per-NS data slice).
//   scopeMode="corpus" — static "all years" badge (pages that only have a
//                        full-corpus view today).
//   scopeMode="none"   — no scope row (the watchlist is per-user, scope-free).

import { FC } from "react";
import { ProcurementBreadcrumb } from "./ProcurementBreadcrumb";
import { ScopeControl } from "../ScopeControl";

export const ProcurementSectionHeader: FC<{
  current?: string;
  scopeMode?: "toggle" | "corpus" | "none";
}> = ({ current, scopeMode = "toggle" }) => (
  <div>
    <ProcurementBreadcrumb currentKey={current} className="my-3" />
    {scopeMode !== "none" ? (
      <div className="mb-3">
        <ScopeControl mode={scopeMode === "corpus" ? "corpus" : "toggle"} />
      </div>
    ) : null}
  </div>
);
