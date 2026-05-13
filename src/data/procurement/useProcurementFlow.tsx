// Fetches data/procurement/derived/flow.json — the sankey-shaped MP-tied
// money-flow file produced by scripts/procurement/derived.ts. Small file
// (~10 KB at current data volumes) so we fetch it whole and let consumers
// filter client-side via the threshold slider.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type ProcurementFlowNodeType = "awarder" | "contractor" | "mp";

export type ProcurementFlowNode = {
  id: string;
  type: ProcurementFlowNodeType;
  label: string;
};

export type ProcurementFlowLink = {
  source: string;
  target: string;
  value: number;
  currency: string;
};

export type ProcurementFlowFile = {
  generatedAt: string;
  nodes: ProcurementFlowNode[];
  links: ProcurementFlowLink[];
};

const fetchFlow = async (): Promise<ProcurementFlowFile | null> => {
  const r = await fetch(dataUrl("/procurement/derived/flow.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementFlowFile;
};

export const useProcurementFlow = () =>
  useQuery({
    queryKey: ["procurement", "flow"] as const,
    queryFn: fetchFlow,
    staleTime: Infinity,
  });
