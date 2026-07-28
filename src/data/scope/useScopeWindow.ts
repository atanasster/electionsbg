// The [from, to) date window for the current procurement scope, shared by the
// overview and the contracts browser. Scope "ns" = the selected parliament's
// tenure: [selected election, next election) — elections.json is newest-first,
// so the next (more recent) election sits at the previous index. Scope
// "y:<year>" = that calendar year. Scope "all" (?pscope=all) drops the window
// → full corpus (null, null).
//
// The mapping itself lives in ./windows, NOT here: the Node loaders that PRECOMPUTE
// per-scope rows must derive the identical window, and a precompute keyed on a window the
// UI computes differently does not fail — it serves the wrong period's numbers under the
// right label. One implementation, two callers.

import allElections from "@/data/json/elections.json";
import { useElectionContext } from "@/data/ElectionContext";
import { scopeYear, useScope } from "./useScope";
import { scopeKeyFor, scopeWindowFor, type ElectionRef } from "./windows";

const elections = allElections as ElectionRef[];

export const useScopeWindow = (): {
  from: string | null;
  to: string | null;
  all: boolean;
  year: number | null;
  selected: string;
  /** The key the precomputed per-scope rows are stored under ('all' | 'y:2024' |
   *  'ns:2026_04_19') — the join key for anything served from a scoped precompute. */
  scopeKey: string;
} => {
  const { selected } = useElectionContext();
  const { scope } = useScope();
  const { from, to } = scopeWindowFor(scope, selected, elections);
  return {
    from,
    to,
    all: scope === "all",
    year: scopeYear(scope),
    selected,
    scopeKey: scopeKeyFor(scope, selected),
  };
};
