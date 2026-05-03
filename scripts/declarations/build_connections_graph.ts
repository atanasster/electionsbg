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
 *   connections.json                 — full graph
 *   connections-by-mp.json           — { [mpId]: nodeIds[] } 1-hop neighborhood
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
  ConnectionsPersonNode,
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

const mpNodeId = (mpId: number) => `mp:${mpId}`;
const companySlugNodeId = (slug: string) => `company:${slug}`;
const companyUicNodeId = (uic: string) => `company:tr:${uic}`;
const personNodeId = (norm: string) => `person:${norm}`;

const edgeKey = (e: Pick<ConnectionsEdge, "source" | "target" | "kind" | "role">) =>
  `${e.source}|${e.target}|${e.kind}|${e.role}`;

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
      const set =
        declaredNsFoldersByMp.get(stake.mpId) ?? new Set<string>();
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
        role: stake.stake.table === "10" ? "current_share" : "transferred_share",
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
          : ensurePersonNode(p.name);
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
              : ensurePersonNode(r.name);
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

  // ---- 4) Build per-MP 1-hop neighborhoods -------------------------------

  // node id → set of node ids reachable in 1 hop (companies for MPs, MPs/persons for companies)
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges.values()) {
    const a = adjacency.get(e.source) ?? new Set<string>();
    a.add(e.target);
    adjacency.set(e.source, a);
    const b = adjacency.get(e.target) ?? new Set<string>();
    b.add(e.source);
    adjacency.set(e.target, b);
  }

  const byMp: Record<number, string[]> = {};
  for (const node of nodes.values()) {
    if (node.type !== "mp") continue;
    const ownId = node.id;
    const neighborCompanies = Array.from(adjacency.get(ownId) ?? []);
    // 2-hop expansion: include co-officers/owners from each neighbor company
    const second = new Set<string>();
    for (const c of neighborCompanies) {
      for (const n of adjacency.get(c) ?? []) {
        if (n !== ownId) second.add(n);
      }
    }
    const ids = new Set<string>([ownId, ...neighborCompanies, ...second]);
    byMp[node.mpId] = Array.from(ids);
  }

  // ---- 4) Compute headline rankings --------------------------------------
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

  // We rank by high-confidence degree to keep the headlines defensible —
  // common-name false positives don't count toward the top of the list.
  // Tie-break by total degree, then alphabetical for stability.
  topMpsAll.sort(
    (a, b) =>
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
  const rankings = {
    generatedAt: new Date().toISOString(),
    topMps: topMpsAll.filter((r) => r.totalDegree > 0),
    topCompanies: topCompaniesAll.filter((r) => r.totalDegree > 0),
  };

  // ---- 5) Write outputs --------------------------------------------------

  const graph: ConnectionsGraph = {
    generatedAt: new Date().toISOString(),
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };

  const fullPath = path.join(parliamentDir, "connections.json");
  const indexPath2 = path.join(parliamentDir, "connections-by-mp.json");
  const rankingsPath = path.join(parliamentDir, "connections-rankings.json");
  fs.writeFileSync(fullPath, stringify(graph), "utf-8");
  fs.writeFileSync(
    indexPath2,
    stringify({ generatedAt: graph.generatedAt, byMp }),
    "utf-8",
  );
  fs.writeFileSync(rankingsPath, stringify(rankings), "utf-8");

  const counts = { mp: 0, company: 0, person: 0 };
  for (const n of graph.nodes) counts[n.type]++;
  console.log(
    `[connections] wrote ${graph.nodes.length} nodes ` +
      `(${counts.mp} MP, ${counts.company} company, ${counts.person} person), ` +
      `${graph.edges.length} edges → ${fullPath}`,
  );
  console.log(
    `[connections]   rankings → ${rankings.topMps.length} top MPs, ` +
      `${rankings.topCompanies.length} top companies`,
  );
};
