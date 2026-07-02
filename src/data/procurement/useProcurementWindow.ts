// The [from, to) date window for the current procurement scope, shared by the
// overview and the contracts browser. The window is the selected parliament's
// tenure: [selected election, next election). elections.json is newest-first,
// so the next (more recent) election sits at the previous index. Scope "all"
// (?pscope=all) drops the window → full corpus (null, null).

import allElections from "@/data/json/elections.json";
import { useElectionContext } from "@/data/ElectionContext";
import { useProcurementScope } from "./useProcurementScope";

const dash = (d: string): string => d.replace(/_/g, "-");
const elections = allElections as Array<{ name: string }>;

export const useProcurementWindow = (): {
  from: string | null;
  to: string | null;
  all: boolean;
  selected: string;
} => {
  const { selected } = useElectionContext();
  const { scope } = useProcurementScope();
  const all = scope === "all";
  const idx = elections.findIndex((e) => e.name === selected);
  const from = all ? null : dash(selected);
  const to = all ? null : idx > 0 ? dash(elections[idx - 1].name) : null;
  return { from, to, all, selected };
};
