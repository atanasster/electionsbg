// Top-contractors index + sankey-flow file. Both derive from the rollups
// already on disk + the MP-connected join, so this runs after rollups and
// cross_reference in the ingest pipeline.

import fs from "fs";
import path from "path";
import type {
  AwarderRollup,
  ContractorRollup,
  FlowFile,
  MpConnectedFile,
  TopContractorEntry,
  TopContractorsFile,
} from "./types";
import { canonicalJson } from "./validate";

const TOP_LIMIT = 1000;

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

// Sankey-shaped MP-tied flow: awarder → contractor → mp. Only nodes/edges
// that touch an MP-connected contract are included; the full procurement
// graph would be unreadable.
//
// Edge values are euro totals (EUR + BGN folded via the locked peg). Edges
// whose contracts are entirely USD/GBP/CHF collapse to 0 and are dropped —
// negligible at current data volumes.
export const buildFlow = (
  awardersDir: string,
  mpConnected: MpConnectedFile,
): FlowFile => {
  const tiedEiks = new Set(mpConnected.entries.map((e) => e.contractorEik));
  if (tiedEiks.size === 0 || !fs.existsSync(awardersDir)) {
    return { generatedAt: new Date().toISOString(), nodes: [], links: [] };
  }

  const nodes = new Map<
    string,
    { id: string; type: "awarder" | "contractor" | "mp"; label: string }
  >();
  const links: FlowFile["links"] = [];

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
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    links,
  };
};

export const writeDerived = (
  outDir: string,
  top: TopContractorsFile,
  flow: FlowFile,
): void => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "top_contractors.json"),
    canonicalJson(top),
  );
  fs.writeFileSync(path.join(outDir, "flow.json"), canonicalJson(flow));
};
