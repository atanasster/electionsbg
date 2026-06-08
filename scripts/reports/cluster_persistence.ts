import fs from "fs";
import path from "path";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import { cikPartiesFileName } from "scripts/consts";
import type { RiskBand, RiskCluster, RiskClustersReport } from "./risk_score";

// Cross-election cluster persistence.
//
// A single-election risk cluster (see risk_score.ts → buildRiskClusters)
// is a knot of physically adjacent same-party elevated sections. One such
// knot appearing ONCE is unremarkable; the same knot clustering election
// after election is the fingerprint of a standing vote-control operation.
//
// This report links clusters ACROSS elections by shared section ids —
// domestic polling-section ids are stable for the same physical location
// (the swing signal relies on the same fact; abroad sections, whose ids
// are reassigned each cycle, are already excluded from risk_clusters.json).
// Connected components of the "shares ≥ MIN_SHARED_SECTIONS sections"
// graph are the persistent loci. Like the clusters themselves this is a
// VIEW over published screening data — it is not a fraud finding.

/** Two clusters from different elections are treated as the same locus
 * when they share at least this many member sections. */
const MIN_SHARED_SECTIONS = 2;

const BAND_RANK: Record<RiskBand, number> = {
  low: 0,
  elevated: 1,
  high: 2,
  critical: 3,
};
const worstBand = (a: RiskBand, b: RiskBand): RiskBand =>
  BAND_RANK[a] >= BAND_RANK[b] ? a : b;

/** One election in which a locus clustered. Multiple same-election
 * clusters that fall in one locus are merged into a single appearance. */
export type ClusterAppearance = {
  election: string;
  partyNum?: number;
  /** CEC nickname of the cluster's winning party — the key the SPA
   * resolves against canonical_parties.json for a display name. */
  winnerNickName?: string;
  /** That election's CEC colour — fallback when the party is absent
   * from the canonical index. */
  winnerColor?: string;
  sectionCount: number;
  maxBand: RiskBand;
  maxScore: number;
};

/** A flagged problem-section (Roma-махала) neighborhood that a locus's
 * member sections overlap — see scripts/reports/problem_sections. */
export type ProblemNeighborhoodRef = {
  id: string;
  nameBg: string;
  nameEn: string;
};

/** A geographic knot that clustered in two or more elections. */
export type PersistentLocus = {
  id: string;
  /** Distinct elections the locus clustered in — its "persistence". */
  electionCount: number;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  centroid: { lat: number; lng: number };
  /** Union of every member section across all appearances. */
  sectionCount: number;
  sections: string[];
  /** Member sections that also sit in a flagged problem-section
   * (Roma-махала) neighborhood — a demographic cross-check against the
   * problem_sections report. */
  problemSectionCount: number;
  /** The problem-section neighborhood the most overlapping sections
   * belong to, when any do. */
  problemNeighborhood?: ProblemNeighborhoodRef;
  /** Chronological — one entry per election. */
  appearances: ClusterAppearance[];
  /** Worst score / band seen across all appearances — the headline read. */
  maxScore: number;
  maxBand: RiskBand;
};

export type ClusterPersistenceReport = {
  generatedAt: string;
  minSharedSections: number;
  loci: PersistentLocus[];
};

// One election's cluster, tagged with its election + resolved winner.
type ClusterNode = RiskCluster & {
  election: string;
  winnerNickName?: string;
  winnerColor?: string;
  sectionSet: Set<string>;
};

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const round1 = (x: number): number => Math.round(x * 10) / 10;

export const generateClusterPersistence = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}): void => {
  const electionsFile = path.resolve(
    publicFolder,
    "../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Section → problem-section neighborhood, unioned across every
  // election's problem_sections.json — used to flag which persistent
  // loci coincide with the known Roma-махала risk neighborhoods.
  const sectionToNeighborhood = new Map<string, string>();
  const neighborhoodById = new Map<string, ProblemNeighborhoodRef>();

  // Collect every cluster across every election as a graph node.
  const nodes: ClusterNode[] = [];
  for (const e of elections) {
    const year = e.name;

    const problemFile = `${publicFolder}/${year}/problem_sections.json`;
    if (fs.existsSync(problemFile)) {
      try {
        const ps = JSON.parse(fs.readFileSync(problemFile, "utf-8")) as {
          neighborhoods?: Array<{
            id: string;
            name_bg?: string;
            name_en?: string;
            sections?: Array<{ section?: string }>;
          }>;
        };
        for (const nb of ps.neighborhoods ?? []) {
          neighborhoodById.set(nb.id, {
            id: nb.id,
            nameBg: nb.name_bg ?? nb.id,
            nameEn: nb.name_en ?? nb.id,
          });
          for (const s of nb.sections ?? []) {
            if (s.section) sectionToNeighborhood.set(s.section, nb.id);
          }
        }
      } catch {
        // ignore — a missing/corrupt file just yields no overlap
      }
    }

    const clustersFile = `${publicFolder}/${year}/reports/section/risk_clusters.json`;
    if (!fs.existsSync(clustersFile)) continue;

    const partyByNum = new Map<number, PartyInfo>();
    const partiesFile = `${publicFolder}/${year}/${cikPartiesFileName}`;
    if (fs.existsSync(partiesFile)) {
      const parties: PartyInfo[] = JSON.parse(
        fs.readFileSync(partiesFile, "utf-8"),
      );
      for (const p of parties) partyByNum.set(p.number, p);
    }

    let report: RiskClustersReport;
    try {
      report = JSON.parse(fs.readFileSync(clustersFile, "utf-8"));
    } catch {
      continue;
    }
    for (const c of report.clusters ?? []) {
      const party =
        c.partyNum !== undefined ? partyByNum.get(c.partyNum) : undefined;
      nodes.push({
        ...c,
        election: year,
        winnerNickName: party?.nickName,
        winnerColor: party?.color,
        sectionSet: new Set(c.sections),
      });
    }
  }

  // Union-find over the "shares ≥ MIN_SHARED_SECTIONS sections" graph.
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      // Two clusters from the same election never merge — a locus is a
      // cross-election concept and same-election knots are already
      // separate clusters by construction.
      if (nodes[i].election === nodes[j].election) continue;
      let shared = 0;
      const small =
        nodes[i].sections.length <= nodes[j].sections.length
          ? nodes[i]
          : nodes[j];
      const large = small === nodes[i] ? nodes[j] : nodes[i];
      for (const s of small.sectionSet) {
        if (large.sectionSet.has(s)) {
          shared += 1;
          if (shared >= MIN_SHARED_SECTIONS) break;
        }
      }
      if (shared >= MIN_SHARED_SECTIONS) union(i, j);
    }
  }

  // Group nodes by component root.
  const components = new Map<number, ClusterNode[]>();
  for (let i = 0; i < nodes.length; i += 1) {
    const r = find(i);
    const arr = components.get(r);
    if (arr) arr.push(nodes[i]);
    else components.set(r, [nodes[i]]);
  }

  const loci: PersistentLocus[] = [];
  let seq = 0;
  for (const group of components.values()) {
    const electionsInGroup = new Set(group.map((n) => n.election));
    if (electionsInGroup.size < 2) continue; // not "persistent"

    // Merge any same-election clusters into one appearance so the
    // timeline is exactly one entry per election.
    const byElection = new Map<string, ClusterNode[]>();
    for (const n of group) {
      const arr = byElection.get(n.election);
      if (arr) arr.push(n);
      else byElection.set(n.election, [n]);
    }
    const appearances: ClusterAppearance[] = [];
    for (const [election, ns] of byElection) {
      const lead = [...ns].sort((a, b) => b.sectionCount - a.sectionCount)[0];
      appearances.push({
        election,
        partyNum: lead.partyNum,
        winnerNickName: lead.winnerNickName,
        winnerColor: lead.winnerColor,
        sectionCount: ns.reduce((s, n) => s + n.sectionCount, 0),
        maxBand: ns.reduce<RiskBand>((b, n) => worstBand(b, n.maxBand), "low"),
        maxScore: Math.max(...ns.map((n) => n.maxScore)),
      });
    }
    appearances.sort((a, b) => a.election.localeCompare(b.election));

    const sectionUnion = new Set<string>();
    for (const n of group) for (const s of n.sectionSet) sectionUnion.add(s);

    // Problem-section overlap — how many member sections sit in a
    // flagged Roma-махала neighborhood, and which one dominates.
    let problemSectionCount = 0;
    const nbHits = new Map<string, number>();
    for (const s of sectionUnion) {
      const nbId = sectionToNeighborhood.get(s);
      if (nbId) {
        problemSectionCount += 1;
        nbHits.set(nbId, (nbHits.get(nbId) ?? 0) + 1);
      }
    }
    let problemNeighborhood: ProblemNeighborhoodRef | undefined;
    let bestHits = 0;
    for (const [nbId, hits] of nbHits) {
      if (hits > bestHits) {
        bestHits = hits;
        problemNeighborhood = neighborhoodById.get(nbId);
      }
    }

    // Location label + centroid from the most recent appearance's lead
    // cluster — the locus's current identity.
    const latest = appearances[appearances.length - 1].election;
    const latestLead = [...byElection.get(latest)!].sort(
      (a, b) => b.sectionCount - a.sectionCount,
    )[0];

    loci.push({
      id: `p${seq}`,
      electionCount: electionsInGroup.size,
      oblast: latestLead.oblast,
      obshtina: latestLead.obshtina,
      ekatte: latestLead.ekatte,
      centroid: {
        lat: round6(
          group.reduce((s, n) => s + n.centroid.lat, 0) / group.length,
        ),
        lng: round6(
          group.reduce((s, n) => s + n.centroid.lng, 0) / group.length,
        ),
      },
      sectionCount: sectionUnion.size,
      sections: [...sectionUnion].sort(),
      problemSectionCount,
      problemNeighborhood,
      appearances,
      maxScore: round1(Math.max(...group.map((n) => n.maxScore))),
      maxBand: group.reduce<RiskBand>((b, n) => worstBand(b, n.maxBand), "low"),
    });
    seq += 1;
  }

  // Strongest first: more elections, then higher worst score.
  loci.sort(
    (a, b) => b.electionCount - a.electionCount || b.maxScore - a.maxScore,
  );

  const report: ClusterPersistenceReport = {
    generatedAt: new Date().toISOString(),
    minSharedSections: MIN_SHARED_SECTIONS,
    loci,
  };
  const outFile = `${publicFolder}/cluster_persistence.json`;
  fs.writeFileSync(outFile, stringify(report), "utf8");

  // Slim section→locus membership reverse-index. The section detail page
  // only needs to answer "is THIS section part of a persistent locus, and if
  // so its id + how many elections" to render one badge — not the full
  // report (every locus's section list, appearances and centroid). This
  // sidecar is ~the 344 member sections × {id, electionCount}. A section can
  // sit in at most one locus (loci are built from disjoint clusters), so a
  // flat map is unambiguous.
  const membership: Record<string, { id: string; electionCount: number }> = {};
  for (const l of loci) {
    for (const section of l.sections) {
      membership[section] = { id: l.id, electionCount: l.electionCount };
    }
  }
  fs.writeFileSync(
    `${publicFolder}/cluster_persistence_membership.json`,
    stringify(membership),
    "utf8",
  );

  const withProblem = loci.filter((l) => l.problemSectionCount > 0).length;
  console.log(
    "Successfully added file ",
    outFile,
    `(${loci.length} persistent loci from ${nodes.length} clusters; ${withProblem} overlap a problem-section neighborhood)`,
  );
};
