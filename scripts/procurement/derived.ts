// Top-contractors index + sankey-flow file. Both derive from the rollups
// already on disk + the MP-connected join, so this runs after rollups and
// cross_reference in the ingest pipeline.

import fs from "fs";
import path from "path";
import type {
  AwarderConcentrationEntry,
  AwarderConcentrationFile,
  AwarderRollup,
  ContractorRollup,
  FlowFile,
  MpConnectedFile,
  TopContractorEntry,
  TopContractorsFile,
} from "./types";
import type { PepConnectedFile } from "./pep_connected";
import { assertFlowIntegrity, canonicalJson } from "./validate";

const TOP_LIMIT = 1000;

// The /procurement landing tile is a PREVIEW: it defaults to ~30 visible links
// and links out to the full /procurement/flows explorer. So we ship a trimmed
// flow.json (top-N links by euro value + their nodes) for the eager landing
// load and the complete graph as flow_full.json for the explorer. Keeps the
// largest single payload on the landing page small without losing any data.
const FLOW_PREVIEW_LIMIT = 150;

// Thresholds for the awarder→contractor concentration flag. Tuned so the
// emitted file stays small (only "interesting" pairs) without dropping
// legitimate red flags.
//   sharePct: 30% of one awarder's lifetime spending going to a single
//             contractor is the conventional red-flag bar in CEE procurement
//             oversight (Transparency International methodology).
//   minAwarderTotalEur: small awarders with < €100k lifetime spend produce
//             noisy 100%-share rows that aren't meaningful — exclude.
const CONCENTRATION_THRESHOLD = 0.3;
const CONCENTRATION_MIN_AWARDER_EUR = 100_000;

// Top contractors across the corpus, sorted by euro total. The per-MP-tied
// subset is identified by intersecting with the MP-connected EIK set — same
// `mpTied: boolean` shape the SPA's /procurement page expects.
export const buildTopContractors = (
  contractorsDir: string,
  mpConnected: MpConnectedFile,
): TopContractorsFile => {
  const mpTiedEiks = new Map<string, Set<number>>();
  for (const entry of mpConnected.entries) {
    const set = mpTiedEiks.get(entry.contractorEik) ?? new Set<number>();
    set.add(entry.mpId);
    mpTiedEiks.set(entry.contractorEik, set);
  }

  const all: TopContractorEntry[] = [];
  if (fs.existsSync(contractorsDir)) {
    for (const file of fs.readdirSync(contractorsDir)) {
      if (!file.endsWith(".json")) continue;
      const c = JSON.parse(
        fs.readFileSync(path.join(contractorsDir, file), "utf8"),
      ) as ContractorRollup;
      const tiedSet = mpTiedEiks.get(c.eik);
      all.push({
        eik: c.eik,
        name: c.name,
        totalEur: c.totalEur,
        totalOther: c.totalOther,
        contractCount: c.contractCount,
        awardCount: c.awardCount,
        mpTied: !!tiedSet,
        mpIds: tiedSet ? [...tiedSet].sort((a, b) => a - b) : [],
      });
    }
  }
  all.sort((a, b) => b.totalEur - a.totalEur);
  return {
    generatedAt: new Date().toISOString(),
    total: all.length,
    entries: all.slice(0, TOP_LIMIT),
  };
};

// Sankey-shaped flow to connected people: awarder → contractor → {mp |
// official}. Terminal nodes are MPs (`mp:<id>`) and the broader political
// class (`official:<slug>` — cabinet, governors, mayors, councillors, …).
// Only nodes/edges that touch a contract won by a connected company are
// included; the full procurement graph would be unreadable.
//
// Edge values are euro totals (EUR + BGN folded via the locked peg). Edges
// whose contracts are entirely USD/GBP/CHF collapse to 0 and are dropped —
// negligible at current data volumes.
export const buildFlow = (
  awardersDir: string,
  mpConnected: MpConnectedFile,
  pepConnected: PepConnectedFile,
): FlowFile => {
  // Union of every contractor EIK reachable from an MP or an official — these
  // are the only contractors whose awarder edges we keep.
  const tiedEiks = new Set<string>();
  for (const e of mpConnected.entries) tiedEiks.add(e.contractorEik);
  for (const e of pepConnected.entries) tiedEiks.add(e.contractorEik);
  if (tiedEiks.size === 0 || !fs.existsSync(awardersDir)) {
    return { generatedAt: new Date().toISOString(), nodes: [], links: [] };
  }

  const nodes = new Map<
    string,
    {
      id: string;
      type: "awarder" | "contractor" | "mp" | "official";
      label: string;
    }
  >();
  const links: FlowFile["links"] = [];
  // Contractors that received at least one awarder→contractor edge from the
  // rollup walk below. The awarder rollups cap byContractor at their top ~50
  // clients, so a connected contractor that isn't among a buyer's largest gets
  // no edge here — we backfill those from topAwarders afterwards so they never
  // render orphaned (contractor → person with no Възложител feeding in).
  const awarderLinkedContractors = new Set<string>();
  // Per connected-contractor top awarders, captured from the person loops below
  // (each mp-/pep-connected entry carries topAwarders sourced from the
  // contractor's own rollup). Keyed per contractor, so it covers every tied
  // contractor regardless of how small a client it is of any single buyer.
  const topAwardersByEik = new Map<
    string,
    {
      name: string;
      awarders: Array<{ eik: string; name: string; totalEur: number }>;
    }
  >();

  // Walk awarders/<EIK>.json and for each contractor they paid that's MP-
  // tied, emit an awarder→contractor link.
  for (const file of fs.readdirSync(awardersDir)) {
    if (!file.endsWith(".json")) continue;
    const a = JSON.parse(
      fs.readFileSync(path.join(awardersDir, file), "utf8"),
    ) as AwarderRollup;
    let touched = false;
    for (const bc of a.byContractor) {
      if (!tiedEiks.has(bc.eik)) continue;
      const valueEur = bc.totalEur;
      if (valueEur <= 0) continue;
      touched = true;
      const awarderNode = `awarder:${a.eik}`;
      const contractorNode = `contractor:${bc.eik}`;
      nodes.set(awarderNode, {
        id: awarderNode,
        type: "awarder",
        label: a.name,
      });
      nodes.set(contractorNode, {
        id: contractorNode,
        type: "contractor",
        label: bc.name,
      });
      links.push({
        source: awarderNode,
        target: contractorNode,
        valueEur,
      });
      awarderLinkedContractors.add(bc.eik);
    }
    if (!touched) continue;
  }

  // Contractor → MP links. Sum the contractor's euro total per MP that links
  // to it. With multiple MPs per contractor (rare but happens), each MP gets a
  // separate edge weighted by the contractor's total (full amount, not split
  // — the journalism payload is "this MP is tied to this contractor", not
  // "this MP got €X"; the contractor got €X and is connected to the MP).
  for (const entry of mpConnected.entries) {
    const valueEur = entry.totalEur;
    if (valueEur <= 0) continue;
    const contractorNode = `contractor:${entry.contractorEik}`;
    const mpNode = `mp:${entry.mpId}`;
    nodes.set(contractorNode, {
      id: contractorNode,
      type: "contractor",
      label: entry.contractorName,
    });
    nodes.set(mpNode, { id: mpNode, type: "mp", label: entry.mpName });
    links.push({
      source: contractorNode,
      target: mpNode,
      valueEur,
    });
    if (!topAwardersByEik.has(entry.contractorEik))
      topAwardersByEik.set(entry.contractorEik, {
        name: entry.contractorName,
        awarders: entry.topAwarders,
      });
  }

  // Contractor → official links. Same shape as the MP edges but keyed on the
  // official's slug. pep_connected has one entry per (official, contractor)
  // pair (high-confidence links only — see pep_connected.ts), so each pair
  // yields one edge weighted by the contractor's euro total.
  for (const entry of pepConnected.entries) {
    const valueEur = entry.totalEur;
    if (valueEur <= 0) continue;
    const contractorNode = `contractor:${entry.contractorEik}`;
    const officialNode = `official:${entry.slug}`;
    nodes.set(contractorNode, {
      id: contractorNode,
      type: "contractor",
      label: entry.contractorName,
    });
    nodes.set(officialNode, {
      id: officialNode,
      type: "official",
      label: entry.name,
    });
    links.push({
      source: contractorNode,
      target: officialNode,
      valueEur,
    });
    if (!topAwardersByEik.has(entry.contractorEik))
      topAwardersByEik.set(entry.contractorEik, {
        name: entry.contractorName,
        awarders: entry.topAwarders,
      });
  }

  // Backfill awarder provenance for connected contractors the rollup walk
  // missed (they fell outside every buyer's top-50). Without this they render
  // as orphans — a contractor → person ribbon with no awarder column feeding
  // it. topAwarders names the buyers that actually paid the contractor, so one
  // edge per top awarder restores the awarder → company → person chain.
  for (const [eik, c] of topAwardersByEik) {
    if (awarderLinkedContractors.has(eik)) continue;
    const contractorNode = `contractor:${eik}`;
    for (const ta of c.awarders ?? []) {
      const valueEur = ta.totalEur;
      if (valueEur <= 0) continue;
      const awarderNode = `awarder:${ta.eik}`;
      nodes.set(awarderNode, {
        id: awarderNode,
        type: "awarder",
        label: ta.name,
      });
      // Contractor node already exists from the person loop; set is idempotent.
      nodes.set(contractorNode, {
        id: contractorNode,
        type: "contractor",
        label: c.name,
      });
      links.push({ source: awarderNode, target: contractorNode, valueEur });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    links,
  };
};

// Awarder→contractor concentration. For each awarder, what share of its
// lifetime euro spending goes to its top contractors? Emits only pairs at or
// above CONCENTRATION_THRESHOLD where the awarder's lifetime spend exceeds
// CONCENTRATION_MIN_AWARDER_EUR — the long tail (one-shot small awarders,
// negligible shares) would dwarf the file without adding signal.
//
// The risk read here is "this buyer's procurement is concentrated on one
// supplier". Used as one input to the per-contract risk score in the SPA.
export const buildAwarderConcentration = (
  awardersDir: string,
): AwarderConcentrationFile => {
  const entries: AwarderConcentrationEntry[] = [];
  if (fs.existsSync(awardersDir)) {
    for (const file of fs.readdirSync(awardersDir)) {
      if (!file.endsWith(".json")) continue;
      const a = JSON.parse(
        fs.readFileSync(path.join(awardersDir, file), "utf8"),
      ) as AwarderRollup;
      if (a.totalEur < CONCENTRATION_MIN_AWARDER_EUR) continue;
      for (const bc of a.byContractor) {
        if (bc.totalEur <= 0) continue;
        const sharePct = bc.totalEur / a.totalEur;
        if (sharePct < CONCENTRATION_THRESHOLD) continue;
        entries.push({
          awarderEik: a.eik,
          awarderName: a.name,
          contractorEik: bc.eik,
          contractorName: bc.name,
          sharePct,
          awarderTotalEur: a.totalEur,
          pairTotalEur: bc.totalEur,
          contractCount: bc.contractCount,
        });
      }
    }
  }
  entries.sort((a, b) => b.sharePct - a.sharePct);
  return {
    generatedAt: new Date().toISOString(),
    thresholdPct: CONCENTRATION_THRESHOLD,
    minAwarderTotalEur: CONCENTRATION_MIN_AWARDER_EUR,
    total: entries.length,
    entries,
  };
};

// Each contractor→person edge carries the contractor's full euro total, while
// each awarder→contractor edge is just one buyer's slice. So any value-ranked
// or threshold cut keeps the (larger) person edge while dropping the smaller
// awarder edge, leaving the contractor shown with no Възложител feeding it. For
// every contractor with a surviving person edge but no surviving awarder edge,
// restore its single largest awarder edge from the full pool so the
// awarder → company → person chain is never rendered broken. Node ids are
// prefixed (`awarder:` / `contractor:` / `mp:` / `official:`), so we classify
// edges by their source/target prefix. The client threshold filter applies the
// identical rule (see ProcurementFlowTile).
const restoreAwarderProvenance = (
  kept: FlowFile["links"],
  pool: FlowFile["links"],
): FlowFile["links"] => {
  const out = [...kept];
  const keptSet = new Set(kept);
  const hasAwarder = new Set<string>(); // contractor ids with a kept awarder edge
  const personLinked = new Set<string>(); // contractor ids with a kept person edge
  for (const l of kept) {
    if (l.source.startsWith("awarder:")) hasAwarder.add(l.target);
    else if (l.source.startsWith("contractor:")) personLinked.add(l.source);
  }
  for (const cid of personLinked) {
    if (hasAwarder.has(cid)) continue;
    let best: FlowFile["links"][number] | null = null;
    for (const l of pool) {
      if (l.target !== cid || !l.source.startsWith("awarder:")) continue;
      if (!best || l.valueEur > best.valueEur) best = l;
    }
    if (best && !keptSet.has(best)) out.push(best);
  }
  return out;
};

// Trim the flow to its top-N links by euro value, dropping nodes left with no
// surviving link. Mirrors the client's threshold-slider filter, so the preview
// renders identically to the default landing view.
export const trimFlow = (flow: FlowFile): FlowFile => {
  if (flow.links.length <= FLOW_PREVIEW_LIMIT) return flow;
  const ranked = [...flow.links]
    .sort((a, b) => b.valueEur - a.valueEur)
    .slice(0, FLOW_PREVIEW_LIMIT);
  const links = restoreAwarderProvenance(ranked, flow.links);
  const keep = new Set<string>();
  for (const l of links) {
    keep.add(l.source);
    keep.add(l.target);
  }
  return {
    generatedAt: flow.generatedAt,
    nodes: flow.nodes.filter((n) => keep.has(n.id)),
    links,
  };
};

export const writeDerived = (
  outDir: string,
  top: TopContractorsFile,
  flow: FlowFile,
  awarderConcentration: AwarderConcentrationFile,
): void => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "top_contractors.json"),
    canonicalJson(top),
  );
  // flow.json = trimmed preview (eager landing load); flow_full.json = complete
  // graph (lazy-loaded by the /procurement/flows explorer). Assert both are
  // free of orphaned contractors before writing — a regression here ships a
  // broken sankey, so fail the ingest loudly instead.
  const preview = trimFlow(flow);
  assertFlowIntegrity(flow, "flow_full.json");
  assertFlowIntegrity(preview, "flow.json (preview)");
  fs.writeFileSync(path.join(outDir, "flow_full.json"), canonicalJson(flow));
  fs.writeFileSync(path.join(outDir, "flow.json"), canonicalJson(preview));
  fs.writeFileSync(
    path.join(outDir, "awarder_concentration.json"),
    canonicalJson(awarderConcentration),
  );
};
