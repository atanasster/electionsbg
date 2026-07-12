// Fetches the sankey-shaped money-flow graph (awarder → politician-tied
// contractor → mp|official), DB-backed (/api/db/procurement-flow →
// procurement_flow). Window-scoped to the selected parliament or the full
// corpus (?pscope). One graph for both the landing preview and the explorer
// page — consumers filter client-side via the threshold slider.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

export type ProcurementFlowNodeType =
  | "awarder"
  | "contractor"
  | "mp"
  | "official";

export type ProcurementFlowNode = {
  id: string;
  type: ProcurementFlowNodeType;
  label: string;
};

export type ProcurementFlowLink = {
  source: string;
  target: string;
  valueEur: number;
};

export type ProcurementFlowFile = {
  generatedAt: string;
  nodes: ProcurementFlowNode[];
  links: ProcurementFlowLink[];
};

// The DB returns the whole window graph; the consumer thresholds it client-side
// (so the preview tile and the explorer page share one fetch — no full flag).
export const useProcurementFlow = () => {
  const { from, to } = useScopeWindow();
  return useQuery({
    queryKey: ["procurement", "flow", from, to] as const,
    queryFn: async (): Promise<ProcurementFlowFile | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-flow?${qs.toString()}`);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementFlowFile;
    },
    staleTime: Infinity,
  });
};
