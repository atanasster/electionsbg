// Builds an entity-scoped buyer→supplier money-flow graph (sankey shape) from
// data already loaded on the entity pages — the awarder / contractor rollup's
// byContractor / byAwarder lists plus the MP-connected edges. No new data file:
// the per-entity flow is a client-side transform, so /awarder/:eik and
// /company/:eik can each show "who pays whom" without a pipeline change.
//
// Output feeds ProcurementFlowSankey directly (same node/link shape as the
// national MP-tied flow). The natural depth is awarder → contractor → MP:
//   - awarder scope:    center buyer (left) → its top suppliers → any MPs tied
//                       to those suppliers (the coral overlay).
//   - contractor scope: top buyers (left) → this supplier (middle) → any MPs
//                       tied to this supplier.

import type {
  ProcurementFlowLink,
  ProcurementFlowNode,
} from "./useProcurementFlow";

export type EntityFlowRole = "awarder" | "contractor";

export type EntityFlowCounterparty = {
  eik: string;
  name: string;
  totalEur: number;
};

export type EntityFlowMpEdge = {
  contractorEik: string;
  mpId: number;
  mpName: string;
  valueEur: number;
};

export const buildEntityFlowGraph = (opts: {
  role: EntityFlowRole;
  centerEik: string;
  centerName: string;
  counterparties: EntityFlowCounterparty[];
  /** MP overlay edges. For the awarder scope these are the tied suppliers'
   *  MPs; for the contractor scope, this company's own MPs. */
  mpEdges?: EntityFlowMpEdge[];
  /** Top-N counterparties to render (by euro). Keeps the diagram readable. */
  limit?: number;
}): { nodes: ProcurementFlowNode[]; links: ProcurementFlowLink[] } => {
  const limit = opts.limit ?? 20;
  const nodes = new Map<string, ProcurementFlowNode>();
  const links: ProcurementFlowLink[] = [];

  const top = [...opts.counterparties]
    .filter((c) => c.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, limit);

  if (opts.role === "awarder") {
    const awarderNode = `awarder:${opts.centerEik}`;
    nodes.set(awarderNode, {
      id: awarderNode,
      type: "awarder",
      label: opts.centerName,
    });
    for (const c of top) {
      const cn = `contractor:${c.eik}`;
      nodes.set(cn, { id: cn, type: "contractor", label: c.name });
      links.push({ source: awarderNode, target: cn, valueEur: c.totalEur });
    }
    const visible = new Set(top.map((c) => c.eik));
    for (const e of opts.mpEdges ?? []) {
      if (!visible.has(e.contractorEik)) continue;
      const cn = `contractor:${e.contractorEik}`;
      const mn = `mp:${e.mpId}`;
      nodes.set(mn, { id: mn, type: "mp", label: e.mpName });
      links.push({ source: cn, target: mn, valueEur: e.valueEur });
    }
  } else {
    const contractorNode = `contractor:${opts.centerEik}`;
    nodes.set(contractorNode, {
      id: contractorNode,
      type: "contractor",
      label: opts.centerName,
    });
    for (const a of top) {
      const an = `awarder:${a.eik}`;
      nodes.set(an, { id: an, type: "awarder", label: a.name });
      links.push({ source: an, target: contractorNode, valueEur: a.totalEur });
    }
    for (const e of opts.mpEdges ?? []) {
      const mn = `mp:${e.mpId}`;
      nodes.set(mn, { id: mn, type: "mp", label: e.mpName });
      links.push({
        source: contractorNode,
        target: mn,
        valueEur: e.valueEur,
      });
    }
  }

  // Dedupe links by endpoint pair — d3-sankey throws on parallel edges, and a
  // counterparty could appear once as a flow edge and again via the MP overlay.
  const seen = new Set<string>();
  const deduped = links.filter((l) => {
    const k = `${l.source}|${l.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { nodes: [...nodes.values()], links: deduped };
};
