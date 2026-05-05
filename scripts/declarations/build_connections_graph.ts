/**
 * Build the cross-MP/company/person connections graph from the existing
 * declarations + TR-enrichment outputs.
 *
 * Inputs (all under `<publicFolder>/parliament/`):
 *   index.json                       — MP roster
 *   companies-index.json             — declared companies (+ optional TR data)
 *   mp-management/{mpId}.json        — TR-derived management roles per MP
 *
 * Output:
 *   connections.json                 — full graph (loaded by /connections only)
 *   mp-connections/{mpId}.json       — per-MP subgraph (1-hop + co-officer 2-hop),
 *                                      loaded on each candidate page
 *
 * Design notes:
 *   - Companies have two possible IDs: "company:{slug}" when they appear in a
 *     declaration (slug from companies-index), and "company:tr:{uic}" when only
 *     TR sees them. We dedupe by uic when an enriched company has a slug.
 *   - Person nodes (non-MP) are created only for officers/owners whose name
 *     does NOT match an MP. They share a normalized-name id, so a person who
 *     appears across multiple TR companies collapses to one node.
 *   - Edges are deduped by (source, target, kind, role). isCurrent on a
 *     declared_stake edge means table=10 (current shares) rather than 11.
 */

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
  ConnectionsCompanyNode,
  ConnectionsEdge,
  ConnectionsGraph,
  ConnectionsMpNode,
  ConnectionsNode,
  ConnectionsPath,
  ConnectionsPersonNode,
  ConnectionsPartyMatrixCell,
  ConnectionsPartyMatrixFile,
  ConnectionsPartyMatrixScope,
  ConnectionsStatsFile,
  ConnectionsStatsScope,
  ConnectionsTopPair,
  ConnectionsTopPairEndpoint,
  MpManagementFile,
  TrCompanyEnrichment,
  TrCompanyOfficer,
} from "../../src/data/dataTypes";
import type { CompaniesIndexFile } from "./build_company_index";

type MpIndexEntry = {
  id: number;
  name: string;
  normalizedName: string;
  currentRegion: { code: string; name: string } | null;
  currentPartyGroup: string | null;
  currentPartyGroupShort: string | null;
  nsFolders: string[];
  isCurrent: boolean;
};
type ParliamentIndex = { mps: MpIndexEntry[] };

const normalizeName = (s: string) =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

// Bulgarian legal-entity suffix tokens. TR sometimes lists a company (rather
// than a natural person) as an owner of another company — e.g. `"ДИТЕКС" ЕООД`
// owns `ДИТЕКС ПРОПЪРТИ ЕООД`. Detecting the suffix lets us route those names
// to a company node instead of fabricating a fake "person".
const LEGAL_ENTITY_SUFFIX_RE =
  /(?:^|[\s"„“»«'`])(ЕООД|ООД|АД|ЕАД|КД|СД|КДА|ДЗЗД|ЕТ)(?:[\s"„“»«'`.,;]|$)/u;

const isLegalEntityName = (name: string): boolean =>
  LEGAL_ENTITY_SUFFIX_RE.test(name.toUpperCase());

// Strip surrounding quotes and trailing legal-form token to get a comparable
// core name. `"ДИТЕКС" ЕООД` → `ДИТЕКС`, `ДИТЕКС ПРОПЪРТИ ЕООД` → `ДИТЕКС
// ПРОПЪРТИ`. Used to match TR-listed company owners against the declared
// companies index (whose `displayName` is the bare core name).
const normalizeCompanyName = (name: string): string => {
  let s = name.toUpperCase();
  s = s.replace(/["„“»«'`]/g, " ");
  s = s.replace(/(?:^|\s)(ЕООД|ООД|АД|ЕАД|КД|СД|КДА|ДЗЗД|ЕТ)(?=\s|$)/gu, " ");
  return s.replace(/\s+/g, " ").trim();
};

const mpNodeId = (mpId: number) => `mp:${mpId}`;
const companySlugNodeId = (slug: string) => `company:${slug}`;
const companyUicNodeId = (uic: string) => `company:tr:${uic}`;
const companyNameNodeId = (norm: string) => `company:name:${norm}`;
const personNodeId = (norm: string) => `person:${norm}`;

const edgeKey = (
  e: Pick<ConnectionsEdge, "source" | "target" | "kind" | "role">,
) => `${e.source}|${e.target}|${e.kind}|${e.role}`;

export type BuildConnectionsArgs = {
  publicFolder: string;
  /** Where raw_data lives. When `<rawFolder>/tr/state.sqlite` exists, the
   * graph builder pulls the full set of current officers/owners for every
   * TR-touched UIC — not just the MP-matched ones. This is what turns the
   * graph from "MPs and their declared companies" into a real web with
   * non-MP co-officers visible. */
  rawFolder?: string;
  stringify: (o: object) => string;
};

export const buildConnectionsGraph = ({
  publicFolder,
  rawFolder,
  stringify,
}: BuildConnectionsArgs): void => {
  const parliamentDir = path.join(publicFolder, "parliament");
  const indexPath = path.join(parliamentDir, "index.json");
  const companiesIndexPath = path.join(parliamentDir, "companies-index.json");
  const mpManagementDir = path.join(parliamentDir, "mp-management");

  if (!fs.existsSync(indexPath) || !fs.existsSync(companiesIndexPath)) {
    console.warn(
      `[connections] missing inputs (index.json or companies-index.json) — skipping`,
    );
    return;
  }

  const mpIndex: ParliamentIndex = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );
  const companiesIndex: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(companiesIndexPath, "utf-8"),
  );

  const mpById = new Map<number, MpIndexEntry>();
  const mpByNormName = new Map<string, MpIndexEntry>();
  for (const mp of mpIndex.mps) {
    mpById.set(mp.id, mp);
    mpByNormName.set(mp.normalizedName, mp);
  }

  // For MPs whose parliament.bg profile has an empty oldnsList (e.g. ex-MPs
  // like Ивелин Михайлов whose record never picked up the historical NS
  // folders), we backfill nsFolders from declaration institutions — each
  // declaration entry carries an institution string like
  // "51-во Народно събрание".
  const declaredNsFoldersByMp = new Map<number, Set<string>>();
  for (const company of companiesIndex.companies) {
    for (const stake of company.stakes) {
      const m = stake.institution?.match(/^(\d{2})-/);
      if (!m) continue;
      const set = declaredNsFoldersByMp.get(stake.mpId) ?? new Set<string>();
      set.add(m[1]);
      declaredNsFoldersByMp.set(stake.mpId, set);
    }
  }
  const nsFoldersForMp = (mpId: number): string[] => {
    const fromIndex = mpById.get(mpId)?.nsFolders ?? [];
    const fromDeclarations = declaredNsFoldersByMp.get(mpId) ?? new Set();
    const merged = new Set<string>(fromIndex);
    for (const f of fromDeclarations) merged.add(f);
    return Array.from(merged);
  };

  const nodes = new Map<string, ConnectionsNode>();
  const edges = new Map<string, ConnectionsEdge>();
  /** uic → company-slug nodeId, populated as we touch declared companies. Used
   * to alias TR-only company ids back to slugs when both sides resolve. */
  const uicToSlugNode = new Map<string, string>();
  /** normalized company name → nodeId, populated as we touch any company node
   * (declared, TR-only, or synthetic-by-name). Used to resolve a TR-listed
   * legal-entity owner string back to an existing company instead of
   * fabricating a person node for it. */
  const companyByNormName = new Map<string, string>();

  const ensureMpNode = (mp: MpIndexEntry): string => {
    const id = mpNodeId(mp.id);
    if (!nodes.has(id)) {
      const node: ConnectionsMpNode = {
        id,
        type: "mp",
        mpId: mp.id,
        label: mp.name,
        partyGroupShort: mp.currentPartyGroupShort,
        isCurrent: mp.isCurrent,
        nsFolders: nsFoldersForMp(mp.id),
      };
      nodes.set(id, node);
    }
    return id;
  };

  const ensureCompanyNodeFromDeclaration = (
    slug: string,
    label: string,
    enrichment: TrCompanyEnrichment | undefined,
    fallbackSeat: string | null,
  ): string => {
    const id = companySlugNodeId(slug);
    if (!nodes.has(id)) {
      const node: ConnectionsCompanyNode = {
        id,
        type: "company",
        label,
        slug,
        uic: enrichment?.uic ?? null,
        legalForm: enrichment?.legalForm ?? null,
        status: enrichment?.status ?? null,
        seat: enrichment?.seat ?? fallbackSeat,
      };
      nodes.set(id, node);
    }
    if (enrichment?.uic) {
      uicToSlugNode.set(enrichment.uic, id);
    }
    const normLabel = normalizeCompanyName(label);
    if (normLabel) companyByNormName.set(normLabel, id);
    return id;
  };

  const ensureCompanyNodeFromUic = (
    uic: string,
    label: string | null,
    legalForm: string | null,
    status: string | null,
    seat: string | null,
  ): string => {
    // If this UIC is already aliased to a declaration-slug node, reuse it.
    const existing = uicToSlugNode.get(uic);
    if (existing) return existing;
    const id = companyUicNodeId(uic);
    if (!nodes.has(id)) {
      const node: ConnectionsCompanyNode = {
        id,
        type: "company",
        label: label ?? uic,
        slug: null,
        uic,
        legalForm,
        status,
        seat,
      };
      nodes.set(id, node);
    }
    if (label) {
      const normLabel = normalizeCompanyName(label);
      if (normLabel && !companyByNormName.has(normLabel)) {
        companyByNormName.set(normLabel, id);
      }
    }
    return id;
  };

  // Used when TR lists a legal entity (a company) as the owner of another
  // company. We don't get a UIC in that record — it's just a name string —
  // so resolve via the normalized-name index when possible, otherwise
  // synthesize a `company:name:{...}` node so repeat appearances collapse.
  const ensureCompanyNodeFromName = (rawName: string): string => {
    const norm = normalizeCompanyName(rawName);
    const existing = norm ? companyByNormName.get(norm) : undefined;
    if (existing) return existing;
    const id = companyNameNodeId(norm || normalizeName(rawName));
    if (!nodes.has(id)) {
      const node: ConnectionsCompanyNode = {
        id,
        type: "company",
        label: rawName,
        slug: null,
        uic: null,
        legalForm: null,
        status: null,
        seat: null,
      };
      nodes.set(id, node);
      if (norm) companyByNormName.set(norm, id);
    }
    return id;
  };

  const ensurePersonNode = (rawName: string): string => {
    const norm = normalizeName(rawName);
    const id = personNodeId(norm);
    if (!nodes.has(id)) {
      const node: ConnectionsPersonNode = {
        id,
        type: "person",
        label: rawName,
      };
      nodes.set(id, node);
    }
    return id;
  };

  // Routes a TR-listed name to either a company node (when the name carries a
  // Bulgarian legal-entity suffix like ЕООД/ООД/АД) or a person node. The
  // legal-entity branch prevents companies-as-owners from being fabricated as
  // fake persons.
  const ensurePersonOrCompanyNode = (rawName: string): string =>
    isLegalEntityName(rawName)
      ? ensureCompanyNodeFromName(rawName)
      : ensurePersonNode(rawName);

  const addEdge = (e: ConnectionsEdge): void => {
    const k = edgeKey(e);
    const prior = edges.get(k);
    if (!prior) {
      edges.set(k, e);
      return;
    }
    // Promote currentness/confidence — favour the more informative copy.
    const merged: ConnectionsEdge = {
      ...prior,
      isCurrent: prior.isCurrent || e.isCurrent,
      confidence:
        prior.confidence === "high" || e.confidence === "high"
          ? "high"
          : (prior.confidence ?? e.confidence),
    };
    edges.set(k, merged);
  };

  // ---- 1) Declared stakes (companies-index.json) ------------------------

  for (const company of companiesIndex.companies) {
    const seat = company.registeredOffices[0] ?? null;
    const companyNodeId = ensureCompanyNodeFromDeclaration(
      company.slug,
      company.displayName,
      company.tr,
      seat,
    );

    for (const stake of company.stakes) {
      const mp = mpById.get(stake.mpId);
      if (!mp) continue;
      const mpId = ensureMpNode(mp);
      addEdge({
        source: mpId,
        target: companyNodeId,
        kind: "declared_stake",
        role:
          stake.stake.table === "10" ? "current_share" : "transferred_share",
        isCurrent: stake.stake.table === "10",
        confidence: "high",
      });
    }

    // TR enrichment edges (officers + owners) for this declared company.
    if (company.tr) {
      const all: Array<{ p: TrCompanyOfficer; isOwner: boolean }> = [
        ...company.tr.currentOfficers.map((p) => ({ p, isOwner: false })),
        ...company.tr.currentOwners.map((p) => ({ p, isOwner: true })),
      ];
      for (const { p, isOwner } of all) {
        const personId = p.matchedMpId
          ? ensureMpNode(mpById.get(p.matchedMpId)!)
          : ensurePersonOrCompanyNode(p.name);
        addEdge({
          source: personId,
          target: companyNodeId,
          kind: isOwner ? "tr_owner" : "tr_role",
          role: p.role,
          isCurrent: true,
          confidence: "high", // person-by-person on the company page is exact
        });
      }
    }
  }

  // ---- 2) MP management roles (mp-management/{mpId}.json) ----------------

  if (fs.existsSync(mpManagementDir)) {
    for (const file of fs.readdirSync(mpManagementDir)) {
      if (!file.endsWith(".json")) continue;
      const mgmt: MpManagementFile = JSON.parse(
        fs.readFileSync(path.join(mpManagementDir, file), "utf-8"),
      );
      const mp = mpById.get(mgmt.mpId);
      if (!mp) continue;
      const mpId = ensureMpNode(mp);
      for (const r of mgmt.roles) {
        const companyNodeId = ensureCompanyNodeFromUic(
          r.uic,
          r.companyName,
          r.legalForm,
          r.status,
          r.seat,
        );
        const isOwner =
          r.role === "partner" ||
          r.role === "sole_owner" ||
          r.role === "actual_owner" ||
          r.role === "foreign_trader";
        addEdge({
          source: mpId,
          target: companyNodeId,
          kind: isOwner ? "tr_owner" : "tr_role",
          role: r.role,
          isCurrent: r.erasedAt === null,
          confidence: r.confidence,
        });
      }
    }
  }

  // ---- 3) Expand: pull all current officers/owners for every TR-touched UIC
  //         (turns the graph into a real web — surfaces non-MP co-officers and
  //         family-business co-ownership patterns).

  if (rawFolder) {
    const sqlitePath = path.join(rawFolder, "tr", "state.sqlite");
    if (fs.existsSync(sqlitePath)) {
      // Collect every UIC currently in the graph (declared + management-only).
      const uicNodes = new Map<string, string>(); // uic → nodeId
      for (const n of nodes.values()) {
        if (n.type === "company" && n.uic) uicNodes.set(n.uic, n.id);
      }

      if (uicNodes.size > 0) {
        const db = new DatabaseSync(sqlitePath, { readOnly: true });
        db.exec("PRAGMA query_only = ON; PRAGMA cache_size = -64000;");

        const ownerRoles = new Set([
          "partner",
          "sole_owner",
          "actual_owner",
          "foreign_trader",
        ]);

        const stmt = db.prepare(
          `SELECT role, name, name_norm, position_label, share_percent,
                  added_at, erased_at
             FROM company_persons
            WHERE uic = ? AND erased_at IS NULL`,
        );

        let added = 0;
        for (const [uic, companyNodeId] of uicNodes) {
          const rows = stmt.all(uic) as Array<{
            role: string;
            name: string;
            name_norm: string;
            position_label: string | null;
            share_percent: number | null;
            added_at: string | null;
            erased_at: string | null;
          }>;
          for (const r of rows) {
            const matchedMp = mpByNormName.get(r.name_norm);
            const personId = matchedMp
              ? ensureMpNode(matchedMp)
              : ensurePersonOrCompanyNode(r.name);
            addEdge({
              source: personId,
              target: companyNodeId,
              kind: ownerRoles.has(r.role) ? "tr_owner" : "tr_role",
              role: r.role,
              isCurrent: true,
              // Confidence on these synthesized edges:
              //   high    when this is a direct TR record on a company we
              //           already had via a declaration (we've already seen
              //           the MP↔company link from another source)
              //   medium  when the only basis is the name match (i.e. this
              //           edge is the sole reason for the connection)
              confidence: matchedMp ? "medium" : "high",
            });
            added++;
          }
        }
        db.close();
        console.log(
          `[connections]   pulled ${added} TR officer/owner edge(s) across ${uicNodes.size} UICs`,
        );
      }
    } else {
      console.log(
        `[connections]   no TR SQLite at ${sqlitePath} — skipping officer expansion`,
      );
    }
  }

  // ---- 4) Build per-MP subgraphs (1-hop + 2-hop + MP→MP shortest paths) --
  //
  // Per-MP file shape:
  //   - 1-hop neighborhood (companies the MP touches) + 2-hop (co-officers
  //     of those companies) — keeps the small "neighborhood graph" use case.
  //   - paths[] : pre-computed shortest paths from this MP to every other
  //     MP reachable within MAX_PATH_LENGTH edges. Each path's nodes/edges
  //     are unioned into nodes/edges so the UI never has to fetch the full
  //     graph to render path chains on the candidate page.
  //
  // BFS from each MP gives one shortest path per (source, target) pair.
  // Paths through the bipartite MP/person ↔ company graph have even length,
  // so the meaningful caps are 2 (MP shares one company with another MP) and
  // 4 (MP → company → person → company → MP). We keep a depth of 4 edges —
  // beyond that paths become too tenuous to be evidence of anything.

  const MAX_PATH_LENGTH = 4;
  const PATHS_PER_MP_LIMIT = 200;

  // Adjacency: node id → array of {neighborId, edge}. Indexed by both ends
  // so BFS can walk an edge from either side.
  const adjacency = new Map<
    string,
    Array<{ neighbor: string; edge: ConnectionsEdge }>
  >();
  for (const e of edges.values()) {
    const a = adjacency.get(e.source) ?? [];
    a.push({ neighbor: e.target, edge: e });
    adjacency.set(e.source, a);
    if (e.target !== e.source) {
      const b = adjacency.get(e.target) ?? [];
      b.push({ neighbor: e.source, edge: e });
      adjacency.set(e.target, b);
    }
  }

  // Index edges by node id once so the per-MP subgraph filter is O(neighborhood)
  // rather than O(E) per MP.
  const edgesByNode = new Map<string, ConnectionsEdge[]>();
  for (const e of edges.values()) {
    const a = edgesByNode.get(e.source) ?? [];
    a.push(e);
    edgesByNode.set(e.source, a);
    if (e.target !== e.source) {
      const b = edgesByNode.get(e.target) ?? [];
      b.push(e);
      edgesByNode.set(e.target, b);
    }
  }

  // The UI wants to render the "best" edge between each consecutive node
  // pair on a path — the most informative one when multiple roles exist
  // (e.g. manager + partner on the same company). Pre-pick once.
  const pickEdge = (a: string, b: string): ConnectionsEdge | undefined => {
    const score = (e: ConnectionsEdge) =>
      (e.isCurrent ? 2 : 0) + (e.confidence === "high" ? 1 : 0);
    let best: ConnectionsEdge | undefined;
    for (const { neighbor, edge } of adjacency.get(a) ?? []) {
      if (neighbor !== b) continue;
      if (!best || score(edge) > score(best)) best = edge;
    }
    return best;
  };

  const mpNodeIds = new Set<string>();
  for (const n of nodes.values()) if (n.type === "mp") mpNodeIds.add(n.id);

  /** Single-source BFS that records, for every other MP reachable within
   * MAX_PATH_LENGTH edges, one shortest path back to source. */
  const computePathsFrom = (sourceId: string): ConnectionsPath[] => {
    type Entry = { prev: string | null; depth: number };
    const visited = new Map<string, Entry>();
    visited.set(sourceId, { prev: null, depth: 0 });
    const queue: string[] = [sourceId];
    const targets: string[] = [];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const { depth } = visited.get(cur)!;
      if (depth >= MAX_PATH_LENGTH) continue;
      for (const { neighbor } of adjacency.get(cur) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.set(neighbor, { prev: cur, depth: depth + 1 });
        queue.push(neighbor);
        if (neighbor !== sourceId && mpNodeIds.has(neighbor)) {
          targets.push(neighbor);
        }
      }
    }

    const paths: ConnectionsPath[] = [];
    for (const target of targets) {
      const chain: string[] = [];
      let cur: string | null = target;
      while (cur !== null) {
        chain.unshift(cur);
        cur = visited.get(cur)!.prev;
      }
      let isAllCurrent = true;
      let isAllHighConfidence = true;
      for (let i = 0; i < chain.length - 1; i++) {
        const e = pickEdge(chain[i], chain[i + 1]);
        if (!e) {
          isAllCurrent = false;
          isAllHighConfidence = false;
          break;
        }
        if (!e.isCurrent) isAllCurrent = false;
        if (e.confidence !== "high") isAllHighConfidence = false;
      }
      paths.push({
        targetMpNodeId: target,
        length: chain.length - 1,
        nodeIds: chain,
        isAllCurrent,
        isAllHighConfidence,
      });
    }

    // Rank: shortest first → all-current preferred → all-high-conf
    // preferred → alphabetical target name (stable). BFS records each
    // target once, so no same-target dupes can occur here.
    paths.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      if (a.isAllCurrent !== b.isAllCurrent) return a.isAllCurrent ? -1 : 1;
      if (a.isAllHighConfidence !== b.isAllHighConfidence)
        return a.isAllHighConfidence ? -1 : 1;
      const la = nodes.get(a.targetMpNodeId)?.label ?? "";
      const lb = nodes.get(b.targetMpNodeId)?.label ?? "";
      return la.localeCompare(lb, "bg");
    });

    return paths.slice(0, PATHS_PER_MP_LIMIT);
  };

  const mpConnectionsDir = path.join(parliamentDir, "mp-connections");
  fs.rmSync(mpConnectionsDir, { recursive: true, force: true });
  fs.mkdirSync(mpConnectionsDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  let mpFileCount = 0;
  let totalPaths = 0;

  // Global MP↔MP pair index. Keyed by `min(a,b)|max(a,b)` so the BFS we run
  // from each MP records each pair only once. We keep the canonical shortest
  // path the first time we see it (BFS guarantees shortest already).
  type PairEntry = {
    a: string; // sorted lo
    b: string; // sorted hi
    path: ConnectionsPath; // chain runs a → … → b
  };
  const globalPairs = new Map<string, PairEntry>();

  for (const node of nodes.values()) {
    if (node.type !== "mp") continue;
    const ownId = node.id;
    const neighborCompanies = (adjacency.get(ownId) ?? []).map(
      (x) => x.neighbor,
    );
    // 2-hop expansion: include co-officers/owners from each neighbor company
    const second = new Set<string>();
    for (const c of neighborCompanies) {
      for (const { neighbor: n } of adjacency.get(c) ?? []) {
        if (n !== ownId) second.add(n);
      }
    }
    const idSet = new Set<string>([ownId, ...neighborCompanies, ...second]);

    // Compute paths and union all path nodes into idSet so the per-MP file
    // carries everything the UI needs to render path chains without the
    // global graph.
    const paths = idSet.size > 0 ? computePathsFrom(ownId) : [];
    for (const p of paths) {
      for (const id of p.nodeIds) idSet.add(id);
      // Record into the global pair index. Sort the pair so we keep one
      // canonical entry per A↔B regardless of which side BFS started from.
      const a = ownId < p.targetMpNodeId ? ownId : p.targetMpNodeId;
      const b = ownId < p.targetMpNodeId ? p.targetMpNodeId : ownId;
      const key = `${a}|${b}`;
      if (!globalPairs.has(key)) {
        // Reorient the chain so it always runs a → … → b for stable rendering.
        const orientedChain =
          p.nodeIds[0] === a ? p.nodeIds : [...p.nodeIds].reverse();
        globalPairs.set(key, {
          a,
          b,
          path: { ...p, targetMpNodeId: b, nodeIds: orientedChain },
        });
      }
    }

    if (idSet.size <= 1) continue; // hub-only — skip; fetch 404s, frontend renders nothing
    const subNodes: ConnectionsNode[] = [];
    for (const id of idSet) {
      const n = nodes.get(id);
      if (n) subNodes.push(n);
    }
    const seenEdges = new Set<string>();
    const subEdges: ConnectionsEdge[] = [];
    for (const id of idSet) {
      for (const e of edgesByNode.get(id) ?? []) {
        if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
        const k = `${e.source}${e.target}${e.kind}${e.role ?? ""}`;
        if (seenEdges.has(k)) continue;
        seenEdges.add(k);
        subEdges.push(e);
      }
    }
    fs.writeFileSync(
      path.join(mpConnectionsDir, `${node.mpId}.json`),
      stringify({
        generatedAt,
        mpNodeId: ownId,
        nodes: subNodes,
        edges: subEdges,
        paths,
      }),
      "utf-8",
    );
    mpFileCount++;
    totalPaths += paths.length;
  }

  // ---- 4b) Score and emit global top MP↔MP pairs -------------------------
  //
  // Surfaces the most journalistically interesting connections immediately
  // when the user lands on /connections — they read it as chip chains, no
  // graph wrangling required. Weights are intentionally kept as named
  // constants so we can retune without rewriting logic. Cross-party
  // dominates because that's the headline-worthy case (rival parties
  // co-owning a company).

  const PAIR_TOP_LIMIT = 500;
  const W_CROSS_PARTY = 100;
  const W_BOTH_CURRENT = 50;
  const W_PER_SHARED_COMPANY = 20;
  const W_ALL_CURRENT = 10;
  const W_ALL_HIGH_CONF = 5;
  const W_PER_LENGTH_BONUS = 8; // multiplied by (5 - path.length)

  // Companies (1-hop neighbors) per MP. Used to count how many companies the
  // pair shares directly — a "multiple shared companies" signal that's only
  // meaningful for length-2 paths (length-4 pairs share an associate, not
  // a company).
  const companiesByMp = new Map<string, Set<string>>();
  for (const id of mpNodeIds) {
    const set = new Set<string>();
    for (const { neighbor } of adjacency.get(id) ?? []) {
      const n = nodes.get(neighbor);
      if (n?.type === "company") set.add(neighbor);
    }
    companiesByMp.set(id, set);
  }

  const endpointFor = (nodeId: string): ConnectionsTopPairEndpoint | null => {
    const node = nodes.get(nodeId);
    if (!node || node.type !== "mp") return null;
    return {
      mpId: node.mpId,
      nodeId: node.id,
      label: node.label,
      partyGroupShort: node.partyGroupShort,
      nsFolders: node.nsFolders,
      isCurrent: node.isCurrent,
    };
  };

  type ScoredPair = {
    pair: ConnectionsTopPair;
    rawScore: number;
  };
  const scoredPairs: ScoredPair[] = [];
  for (const entry of globalPairs.values()) {
    const epA = endpointFor(entry.a);
    const epB = endpointFor(entry.b);
    if (!epA || !epB) continue;

    const sharedCompanies =
      entry.path.length === 2
        ? (() => {
            const aCos = companiesByMp.get(entry.a) ?? new Set<string>();
            const bCos = companiesByMp.get(entry.b) ?? new Set<string>();
            let n = 0;
            for (const c of aCos) if (bCos.has(c)) n++;
            return n;
          })()
        : 0;

    const crossParty =
      epA.partyGroupShort != null &&
      epB.partyGroupShort != null &&
      epA.partyGroupShort !== epB.partyGroupShort;

    // "Both currently seated" means both endpoints are in the live parliament
    // at build time — used to weight pairs that matter for current discourse
    // higher than pairs of historical MPs. Per-NS scoping happens client-side.
    const bothCurrent = epA.isCurrent && epB.isCurrent;

    const score =
      (crossParty ? W_CROSS_PARTY : 0) +
      (bothCurrent ? W_BOTH_CURRENT : 0) +
      sharedCompanies * W_PER_SHARED_COMPANY +
      (entry.path.isAllCurrent ? W_ALL_CURRENT : 0) +
      (entry.path.isAllHighConfidence ? W_ALL_HIGH_CONF : 0) +
      Math.max(0, 5 - entry.path.length) * W_PER_LENGTH_BONUS;

    const pathNodes: ConnectionsNode[] = [];
    for (const id of entry.path.nodeIds) {
      const n = nodes.get(id);
      if (n) pathNodes.push(n);
    }
    const pathEdges: ConnectionsEdge[] = [];
    for (let i = 0; i < entry.path.nodeIds.length - 1; i++) {
      const e = pickEdge(entry.path.nodeIds[i], entry.path.nodeIds[i + 1]);
      if (e) pathEdges.push(e);
    }

    scoredPairs.push({
      pair: {
        mpA: epA,
        mpB: epB,
        path: entry.path,
        pathNodes,
        pathEdges,
        score,
        sharedCompanyCount: sharedCompanies,
        crossParty,
      },
      rawScore: score,
    });
  }

  scoredPairs.sort((a, b) => {
    if (a.rawScore !== b.rawScore) return b.rawScore - a.rawScore;
    if (a.pair.path.length !== b.pair.path.length)
      return a.pair.path.length - b.pair.path.length;
    return a.pair.mpA.label.localeCompare(b.pair.mpA.label, "bg");
  });

  const topPairs = scoredPairs
    .slice(0, PAIR_TOP_LIMIT)
    .map((s) => s.pair) satisfies ConnectionsTopPair[];

  const topPairsPath = path.join(parliamentDir, "connections-top-pairs.json");
  fs.writeFileSync(
    topPairsPath,
    stringify({ generatedAt, pairs: topPairs }),
    "utf-8",
  );

  // ---- 4c) Aggregated stats + party × party matrix ----------------------
  //
  // Drives the hero sentence and clickable heatmap on the Connections page.
  // Both are precomputed because the alternative — rolling up the 1.9 MB
  // graph client-side just to render a sentence and a small grid — would
  // force every visitor to download data they don't otherwise need until
  // they open the orbital tab.
  //
  // The "samplePairKeys" on each cell are pair signatures the UI uses to
  // filter the Strongest Ties tab when the user clicks a cell. We pick the
  // top 5 by score so the drilldown lands on the most interesting examples.

  type PairContext = {
    pair: ConnectionsTopPair;
    pairKey: string;
    score: number;
  };
  const allPairsForAggregation: PairContext[] = scoredPairs.map((s) => ({
    pair: s.pair,
    pairKey: `${s.pair.mpA.nodeId}|${s.pair.mpB.nodeId}`,
    score: s.rawScore,
  }));

  const computeStatsScope = (
    pairs: PairContext[],
    mpsTotal: number,
    nsFilter: string | null,
  ): ConnectionsStatsScope => {
    const connectedMps = new Set<string>();
    const otherMps = new Set<string>();
    const companies = new Set<string>();
    for (const ctx of pairs) {
      // For per-NS scopes: an endpoint is "in scope" iff it sat in this NS;
      // otherwise it counts as a "reached other MP". For the lifetime scope
      // every endpoint is in scope, so otherMps stays empty there and the
      // sentence renders only mpsConnected + sharedCompanies.
      const aInScope = nsFilter
        ? ctx.pair.mpA.nsFolders.includes(nsFilter)
        : true;
      const bInScope = nsFilter
        ? ctx.pair.mpB.nsFolders.includes(nsFilter)
        : true;
      if (aInScope) connectedMps.add(ctx.pair.mpA.nodeId);
      if (bInScope) connectedMps.add(ctx.pair.mpB.nodeId);
      if (!aInScope) otherMps.add(ctx.pair.mpA.nodeId);
      if (!bInScope) otherMps.add(ctx.pair.mpB.nodeId);
      for (const node of ctx.pair.pathNodes) {
        if (node.type === "company") companies.add(node.id);
      }
    }
    return {
      mpsTotal,
      mpsConnected: connectedMps.size,
      otherMpsReached: otherMps.size,
      sharedCompanies: companies.size,
    };
  };

  const computeMatrixScope = (
    pairs: PairContext[],
  ): ConnectionsPartyMatrixScope => {
    type CellAccum = {
      partyA: string;
      partyB: string;
      ties: PairContext[];
    };
    const cells = new Map<string, CellAccum>();
    const partySet = new Set<string>();
    for (const ctx of pairs) {
      const a = ctx.pair.mpA.partyGroupShort ?? "Independent";
      const b = ctx.pair.mpB.partyGroupShort ?? "Independent";
      partySet.add(a);
      partySet.add(b);
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo}|${hi}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { partyA: lo, partyB: hi, ties: [] };
        cells.set(key, cell);
      }
      cell.ties.push(ctx);
    }
    const out: Record<string, ConnectionsPartyMatrixCell> = {};
    for (const [key, cell] of cells) {
      cell.ties.sort((x, y) => y.score - x.score);
      out[key] = {
        partyA: cell.partyA,
        partyB: cell.partyB,
        tieCount: cell.ties.length,
        samplePairKeys: cell.ties.slice(0, 5).map((t) => t.pairKey),
      };
    }
    return {
      parties: Array.from(partySet).sort(),
      cells: out,
    };
  };

  const allMpsCount = Array.from(nodes.values()).filter(
    (n) => n.type === "mp",
  ).length;

  const stats: ConnectionsStatsFile = {
    generatedAt,
    all: computeStatsScope(allPairsForAggregation, allMpsCount, null),
    byNs: {},
  };
  const matrix: ConnectionsPartyMatrixFile = {
    generatedAt,
    all: computeMatrixScope(allPairsForAggregation),
    byNs: {},
  };

  const nsFoldersForStats = new Set<string>();
  for (const node of nodes.values()) {
    if (node.type !== "mp") continue;
    for (const ns of node.nsFolders) nsFoldersForStats.add(ns);
  }
  for (const ns of nsFoldersForStats) {
    const nsPairs = allPairsForAggregation.filter(
      (ctx) =>
        ctx.pair.mpA.nsFolders.includes(ns) ||
        ctx.pair.mpB.nsFolders.includes(ns),
    );
    const mpsInNs = Array.from(nodes.values()).filter(
      (n) => n.type === "mp" && n.nsFolders.includes(ns),
    ).length;
    stats.byNs[ns] = computeStatsScope(nsPairs, mpsInNs, ns);
    matrix.byNs[ns] = computeMatrixScope(nsPairs);
  }

  fs.writeFileSync(
    path.join(parliamentDir, "connections-stats.json"),
    stringify(stats),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(parliamentDir, "connections-party-matrix.json"),
    stringify(matrix),
    "utf-8",
  );

  // ---- 5) Compute headline rankings --------------------------------------
  //
  // Surfaces "who is the most connected" without forcing users to grapple
  // with the force-directed graph. Persisted as a small JSON so the
  // /connections page can render it instantly.

  type DegreeRow = {
    nodeId: string;
    totalDegree: number;
    highConfDegree: number;
  };
  const degreeMap = new Map<string, DegreeRow>();
  const ensureRow = (id: string): DegreeRow => {
    let r = degreeMap.get(id);
    if (!r) {
      r = { nodeId: id, totalDegree: 0, highConfDegree: 0 };
      degreeMap.set(id, r);
    }
    return r;
  };
  for (const e of edges.values()) {
    const a = ensureRow(e.source);
    const b = ensureRow(e.target);
    a.totalDegree++;
    b.totalDegree++;
    if (e.confidence === "high") {
      a.highConfDegree++;
      b.highConfDegree++;
    }
  }

  type TopMp = {
    mpId: number;
    label: string;
    partyGroupShort: string | null;
    isCurrent: boolean;
    nsFolders: string[];
    totalDegree: number;
    highConfDegree: number;
    mpMpDirectDegree: number;
    mpMpReachDegree: number;
  };
  type TopCompany = {
    nodeId: string;
    slug: string | null;
    uic: string | null;
    label: string;
    legalForm: string | null;
    status: string | null;
    seat: string | null;
    /** Number of MPs (high-confidence only) connected to this company. The
     * counted MPs are those reached via a `declared_stake` or any TR edge
     * with confidence === "high". */
    mpCount: number;
    /** Total non-MP-person and MP edges. */
    totalDegree: number;
  };

  const topMpsAll: TopMp[] = [];
  const topCompaniesAll: TopCompany[] = [];

  // For company → MP count we walk edges directly so we can apply the
  // confidence gate (avoids the common-name false-positive flooding the list).
  const mpsByCompany = new Map<string, Set<string>>();
  for (const e of edges.values()) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t) continue;
    let mpId: string | null = null;
    let companyId: string | null = null;
    if (s.type === "mp" && t.type === "company") {
      mpId = s.id;
      companyId = t.id;
    } else if (t.type === "mp" && s.type === "company") {
      mpId = t.id;
      companyId = s.id;
    }
    if (!mpId || !companyId) continue;
    if (e.confidence !== "high") continue;
    const set = mpsByCompany.get(companyId) ?? new Set<string>();
    set.add(mpId);
    mpsByCompany.set(companyId, set);
  }

  // Per-MP MP↔MP degree, derived from globalPairs (built in section 4b above).
  // Direct = length-2 paths only — the MP and the other endpoint share at
  // least one company; Reach = any precomputed path. The dashboard ranks by
  // Direct because length-4 paths through a shared associate are too noisy
  // to headline. We accumulate sets so we count distinct OTHER MPs, not
  // pair instances.
  const directCoMpsByMp = new Map<string, Set<string>>();
  const reachCoMpsByMp = new Map<string, Set<string>>();
  const ensureSet = (m: Map<string, Set<string>>, key: string): Set<string> => {
    let s = m.get(key);
    if (!s) {
      s = new Set();
      m.set(key, s);
    }
    return s;
  };
  for (const entry of globalPairs.values()) {
    ensureSet(reachCoMpsByMp, entry.a).add(entry.b);
    ensureSet(reachCoMpsByMp, entry.b).add(entry.a);
    if (entry.path.length === 2) {
      ensureSet(directCoMpsByMp, entry.a).add(entry.b);
      ensureSet(directCoMpsByMp, entry.b).add(entry.a);
    }
  }

  for (const node of nodes.values()) {
    const row = degreeMap.get(node.id);
    if (!row) continue;
    if (node.type === "mp") {
      topMpsAll.push({
        mpId: node.mpId,
        label: node.label,
        partyGroupShort: node.partyGroupShort,
        isCurrent: node.isCurrent,
        nsFolders: nsFoldersForMp(node.mpId),
        totalDegree: row.totalDegree,
        highConfDegree: row.highConfDegree,
        mpMpDirectDegree: directCoMpsByMp.get(node.id)?.size ?? 0,
        mpMpReachDegree: reachCoMpsByMp.get(node.id)?.size ?? 0,
      });
    } else if (node.type === "company") {
      topCompaniesAll.push({
        nodeId: node.id,
        slug: node.slug,
        uic: node.uic,
        label: node.label,
        legalForm: node.legalForm,
        status: node.status,
        seat: node.seat,
        mpCount: mpsByCompany.get(node.id)?.size ?? 0,
        totalDegree: row.totalDegree,
      });
    }
  }

  // Headline rank is "how many fellow MPs does this person share a company
  // with" — that's what readers want from the dashboard. We skip reach as
  // a tiebreaker because a length-4 path can run through a name-matched
  // associate node (low-confidence) and inflate the count for MPs whose
  // co-MP ties are otherwise zero. Tie-break instead by raw high-conf
  // degree (the MP's own business network depth), then total, then label.
  topMpsAll.sort(
    (a, b) =>
      b.mpMpDirectDegree - a.mpMpDirectDegree ||
      b.highConfDegree - a.highConfDegree ||
      b.totalDegree - a.totalDegree ||
      a.label.localeCompare(b.label, "bg"),
  );
  topCompaniesAll.sort(
    (a, b) =>
      b.mpCount - a.mpCount ||
      b.totalDegree - a.totalDegree ||
      a.label.localeCompare(b.label, "bg"),
  );

  // Persist *every* MP/company with any degree (not just top 30). The home
  // page uses the head, the regional dashboards filter by region, and a
  // dedicated /connections rankings panel can paginate further. This stays
  // compact in practice — under ~100 KB even with the full graph behind it.
  const lifetimeTopMps = topMpsAll.filter((r) => r.totalDegree > 0);
  const lifetimeTopCompanies = topCompaniesAll.filter((r) => r.totalDegree > 0);

  // Per-parliament slices. For each NS folder we filter MPs to those whose
  // nsFolders include it, then recompute the company rankings against just
  // those MPs so a company's mpCount reflects "MPs of NS X with a high-conf
  // tie to this company" — which is what the per-parliament scope wants to
  // surface. The lifetime rankings above keep their broader meaning for the
  // "All parliaments" scope.
  const allNsFolders = new Set<string>();
  for (const r of lifetimeTopMps) {
    for (const ns of r.nsFolders) allNsFolders.add(ns);
  }
  const byNs: Record<string, { topMps: TopMp[]; topCompanies: TopCompany[] }> =
    {};
  for (const ns of allNsFolders) {
    const mpsInNsRaw = lifetimeTopMps.filter((r) => r.nsFolders.includes(ns));
    const mpNodeIdsInNs = new Set(mpsInNsRaw.map((r) => mpNodeId(r.mpId)));

    // Recompute MP↔MP degree counting only co-MPs that ALSO sat in this
    // parliament. Otherwise a 52nd-NS member would inherit ties with former
    // MPs the dashboard reader has no reason to recognise as part of "this
    // parliament's" network.
    const directInNs = new Map<string, Set<string>>();
    const reachInNs = new Map<string, Set<string>>();
    for (const entry of globalPairs.values()) {
      const aIn = mpNodeIdsInNs.has(entry.a);
      const bIn = mpNodeIdsInNs.has(entry.b);
      if (aIn && bIn) {
        ensureSet(reachInNs, entry.a).add(entry.b);
        ensureSet(reachInNs, entry.b).add(entry.a);
        if (entry.path.length === 2) {
          ensureSet(directInNs, entry.a).add(entry.b);
          ensureSet(directInNs, entry.b).add(entry.a);
        }
      }
    }

    const mpsInNs = mpsInNsRaw
      .map((r) => ({
        ...r,
        mpMpDirectDegree: directInNs.get(mpNodeId(r.mpId))?.size ?? 0,
        mpMpReachDegree: reachInNs.get(mpNodeId(r.mpId))?.size ?? 0,
      }))
      .sort(
        (a, b) =>
          b.mpMpDirectDegree - a.mpMpDirectDegree ||
          b.highConfDegree - a.highConfDegree ||
          b.totalDegree - a.totalDegree ||
          a.label.localeCompare(b.label, "bg"),
      );

    const mpsByCompanyInNs = new Map<string, Set<string>>();
    const companyTotalDegreeInNs = new Map<string, number>();
    for (const e of edges.values()) {
      const s = nodes.get(e.source);
      const t = nodes.get(e.target);
      if (!s || !t) continue;
      let mpId: string | null = null;
      let companyId: string | null = null;
      if (s.type === "mp" && t.type === "company") {
        mpId = s.id;
        companyId = t.id;
      } else if (t.type === "mp" && s.type === "company") {
        mpId = t.id;
        companyId = s.id;
      }
      if (!mpId || !companyId) continue;
      if (!mpNodeIdsInNs.has(mpId)) continue;
      companyTotalDegreeInNs.set(
        companyId,
        (companyTotalDegreeInNs.get(companyId) ?? 0) + 1,
      );
      if (e.confidence !== "high") continue;
      const set = mpsByCompanyInNs.get(companyId) ?? new Set<string>();
      set.add(mpId);
      mpsByCompanyInNs.set(companyId, set);
    }

    const companiesInNs: TopCompany[] = [];
    for (const c of lifetimeTopCompanies) {
      const totalDegree = companyTotalDegreeInNs.get(c.nodeId) ?? 0;
      if (totalDegree === 0) continue;
      companiesInNs.push({
        ...c,
        mpCount: mpsByCompanyInNs.get(c.nodeId)?.size ?? 0,
        totalDegree,
      });
    }
    companiesInNs.sort(
      (a, b) =>
        b.mpCount - a.mpCount ||
        b.totalDegree - a.totalDegree ||
        a.label.localeCompare(b.label, "bg"),
    );

    byNs[ns] = { topMps: mpsInNs, topCompanies: companiesInNs };
  }

  const rankings = {
    generatedAt: new Date().toISOString(),
    topMps: lifetimeTopMps,
    topCompanies: lifetimeTopCompanies,
    byNs,
  };

  // ---- 6) Write outputs --------------------------------------------------

  const graph: ConnectionsGraph = {
    generatedAt,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };

  const fullPath = path.join(parliamentDir, "connections.json");
  const rankingsPath = path.join(parliamentDir, "connections-rankings.json");
  fs.writeFileSync(fullPath, stringify(graph), "utf-8");
  fs.writeFileSync(rankingsPath, stringify(rankings), "utf-8");

  // Compact search index — drives the filter rail's entity autocomplete on
  // the Connections page. Persons (non-MP) are intentionally excluded to
  // keep suggestions defensible.
  const searchEntries = [
    ...Array.from(nodes.values())
      .filter((n) => n.type === "mp")
      .map((n) =>
        n.type === "mp"
          ? {
              type: "mp" as const,
              mpId: n.mpId,
              label: n.label,
              partyGroupShort: n.partyGroupShort,
              nsFolders: n.nsFolders,
            }
          : null,
      )
      .filter(<T>(x: T | null): x is T => x !== null),
    ...Array.from(nodes.values())
      .filter((n) => n.type === "company")
      .map((n) =>
        n.type === "company"
          ? {
              type: "company" as const,
              slug: n.slug,
              uic: n.uic,
              label: n.label,
              seat: n.seat,
            }
          : null,
      )
      // Drop placeholder/empty company labels — they appear when a TR officer
      // record references a company that never gets a real name.
      .filter(
        <T extends { label: string | null }>(x: T | null): x is T =>
          x !== null && !!x.label && x.label.trim() !== "" && x.label !== "-",
      ),
  ];
  const searchPath = path.join(parliamentDir, "connections-search.json");
  fs.writeFileSync(
    searchPath,
    stringify({ generatedAt, entries: searchEntries }),
    "utf-8",
  );

  // The legacy connections-by-mp.json index has been replaced by per-MP
  // subgraph files under mp-connections/. Remove it if present so old clones
  // don't keep a stale 300 KB file in their build output.
  const legacyByMp = path.join(parliamentDir, "connections-by-mp.json");
  if (fs.existsSync(legacyByMp)) fs.rmSync(legacyByMp);

  const counts = { mp: 0, company: 0, person: 0 };
  for (const n of graph.nodes) counts[n.type]++;
  console.log(
    `[connections] wrote ${graph.nodes.length} nodes ` +
      `(${counts.mp} MP, ${counts.company} company, ${counts.person} person), ` +
      `${graph.edges.length} edges → ${fullPath}`,
  );
  console.log(
    `[connections]   per-MP subgraphs → ${mpFileCount} files (${totalPaths} MP→MP paths total) in ${mpConnectionsDir}`,
  );
  console.log(
    `[connections]   rankings → ${rankings.topMps.length} top MPs, ` +
      `${rankings.topCompanies.length} top companies, ` +
      `${Object.keys(rankings.byNs).length} NS scopes`,
  );
  console.log(
    `[connections]   top pairs → ${topPairs.length} (of ${globalPairs.size} total MP↔MP) → ${topPairsPath}`,
  );
};
