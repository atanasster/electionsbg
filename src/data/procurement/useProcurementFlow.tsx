// Fetches the sankey-shaped money-flow file. Scope-aware:
//   scope "all" → the corpus graph from scripts/procurement/derived.ts —
//                 flow.json (trimmed preview, eager landing load) or
//                 flow_full.json (complete graph, /procurement/flows).
//   scope "ns"  → the per-election graph from scripts/procurement/by_ns.ts
//                 (by_ns/flow/<date>.json) — already small, fetched whole for
//                 both the landing tile and the explorer page.
// Consumers filter client-side via the threshold slider.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { useProcurementScope } from "./useProcurementScope";

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

const fetchFlow = async (url: string): Promise<ProcurementFlowFile | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementFlowFile;
};

// full=false (default) loads the trimmed preview for the embedded landing tile;
// full=true loads the complete graph for the dedicated /procurement/flows page.
// When scope === "ns", both load the per-election graph (already small) instead.
export const useProcurementFlow = (full = false) => {
  const { scope } = useProcurementScope();
  const { selected } = useElectionContext();
  const ns = scope === "ns";
  const url = ns
    ? dataUrl(`/procurement/by_ns/flow/${selected}.json`)
    : dataUrl(`/procurement/derived/${full ? "flow_full.json" : "flow.json"}`);
  return useQuery({
    queryKey: [
      "procurement",
      "flow",
      ns ? `ns:${selected}` : full ? "full" : "preview",
    ] as const,
    queryFn: () => fetchFlow(url),
    staleTime: Infinity,
  });
};
