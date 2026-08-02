// Blob-native types + pure derivations for the /connections graph engine (P4.1). The screen renders
// the down-sampled PUBLIC-figure bridge graph served by /api/db/graph-global (the graph_payloads
// 'global' blob, migrations 128/129) — a person↔company bipartite graph, NOT the retired person↔person
// static JSON. These helpers are pure (no fetch, no React) so the matrix builder, the strongest-pairs
// derivation and the BFS path-finder are unit-tested in graphBlob.test.ts.
//
// Money arrives as a JS number here (the blob is jsonb; node-pg JSON-parses it) — unlike the
// DbDataTable routes, which hand numeric columns back as strings.

import { decodeEntities } from "@/lib/decodeEntities";

export type GraphBlobPerson = {
  id: number;
  slug: string;
  name: string | null;
  facet: string | null;
  money: number;
  degree: number;
  party: string | null;
  partyColor: string | null;
};
export type GraphBlobCompany = {
  eik: string;
  name: string | null;
  money: number;
  officers: number;
};
export type GraphBlobEdge = { p: number; c: string; kind: string };
export type GraphMatrixCell = { a: string; b: string; companies: number };

export type GraphGlobalBlob = {
  meta: { audience: string; companyCap: number; bridgeCompaniesTotal: number };
  companies: GraphBlobCompany[];
  persons: GraphBlobPerson[];
  edges: GraphBlobEdge[];
  matrix: GraphMatrixCell[];
  partyMatrix: GraphMatrixCell[];
  // party → colour for EVERY public politician party (global, so a party×party axis whose party is off
  // the drawn set still colours). A party can be present with no colour (party_color NULL) — resolve
  // via partyColor() below, which falls back deterministically.
  partyColors: Record<string, string>;
};

// The per-person ego neighbourhood (/api/db/graph-ego). Names only the subject — never a third party.
export type GraphEgo = {
  subject: {
    slug: string;
    name: string;
    facet: string | null;
    money: number;
    degree: number;
  };
  companies: GraphBlobCompany[];
  edges: { eik: string; kind: string; role: string; current: boolean | null }[];
  disclaimer: string;
};

// ── Facet vocabulary + colour (the node/legend palette). Kept here so the canvas, the legend and the
// matrix axes share one source. 'company' is the private Tier-V facet — it never appears in the public
// global blob, but the ego drill-in can surface it under the private toggle, so it carries a colour.
export const FACET_ORDER = [
  "politician",
  "executive",
  "magistrate",
  "public_sector",
  "company",
] as const;
export type Facet = (typeof FACET_ORDER)[number];

export const FACET_COLOR: Record<string, string> = {
  politician: "#2563eb", // blue
  executive: "#0d9488", // teal
  magistrate: "#7c3aed", // violet
  public_sector: "#d97706", // amber
  company: "#737373", // grey (private owners, ego-only)
};
export const COMPANY_COLOR = "#b45309"; // dark amber — the company nodes themselves

export const facetColor = (facet: string | null | undefined): string =>
  (facet && FACET_COLOR[facet]) || "#737373";

// Resolve a party's colour from the blob's global palette, with a deterministic fallback when the
// party carries no colour (party_color NULL) — a stable slate so the axis/node still renders.
const PARTY_FALLBACK = "#94a3b8"; // slate-400
export const partyColor = (
  blob: Pick<GraphGlobalBlob, "partyColors">,
  party: string | null | undefined,
): string => (party && blob.partyColors[party]) || PARTY_FALLBACK;

// ── The canvas view model — a lean person↔company node/edge set, independent of the retired
// ConnectionsNode union. `id` is "p:<slug>" for people, "c:<eik>" for companies.
export type GraphViewNode = {
  id: string;
  kind: "person" | "company";
  label: string;
  slug?: string; // person → /person/<slug> + ego fetch
  eik?: string; // company → /company/<eik>
  facet?: string | null;
  party?: string | null;
  partyColor?: string | null;
  money: number;
  degree: number; // person edge-degree, or company officer count
  color: string;
  radius: number;
};
export type GraphViewEdge = { source: string; target: string; kind: string };
export type GraphView = { nodes: GraphViewNode[]; edges: GraphViewEdge[] };

export const personNodeId = (slug: string): string => `p:${slug}`;
export const companyNodeId = (eik: string): string => `c:${eik}`;
// Canonical unordered edge key, shared by the canvas (path highlight) and the screen (BFS trail).
export const pathEdgeKey = (a: string, b: string): string => `${a}|${b}`;

// Numeric fields arrive as JS numbers (jsonb), but coerce defensively so a serialization change
// (numeric-as-string) degrades to wrong-but-safe rather than NaN radii that throw in the draw loop.
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const radiusFor = (degree: number): number =>
  3 + Math.min(7, Math.sqrt(Math.max(0, degree)) * 1.5);

/** Map the blob into the canvas view model. Persons coloured by facet, companies by COMPANY_COLOR;
 *  radius scales with degree/officers. Edges point person → company (bipartite). Labels are
 *  entity-decoded here so the canvas and the DOM lists agree. */
export const blobToView = (blob: GraphGlobalBlob): GraphView => {
  const byId = new Map<number, GraphBlobPerson>();
  for (const p of blob.persons) byId.set(p.id, p);

  const nodes: GraphViewNode[] = [
    ...blob.persons.map((p) => ({
      id: personNodeId(p.slug),
      kind: "person" as const,
      label: decodeEntities(p.name ?? p.slug),
      slug: p.slug,
      facet: p.facet,
      party: p.party,
      partyColor: p.partyColor,
      money: num(p.money),
      degree: num(p.degree),
      color: facetColor(p.facet),
      radius: radiusFor(num(p.degree)),
    })),
    ...blob.companies.map((c) => ({
      id: companyNodeId(c.eik),
      kind: "company" as const,
      label: decodeEntities(c.name ?? c.eik),
      eik: c.eik,
      money: num(c.money),
      degree: num(c.officers),
      color: COMPANY_COLOR,
      radius: radiusFor(num(c.officers)),
    })),
  ];

  // Edges reference a person by id; drop any whose endpoints are not both in the blob (defensive —
  // the blob guarantees closure, but a partial fetch should not crash the sim).
  const companySet = new Set(blob.companies.map((c) => c.eik));
  const edges: GraphViewEdge[] = [];
  for (const e of blob.edges) {
    const p = byId.get(e.p);
    if (!p || !companySet.has(e.c)) continue;
    edges.push({
      source: personNodeId(p.slug),
      target: companyNodeId(e.c),
      kind: e.kind,
    });
  }
  return { nodes, edges };
};

// ── Hero stats (derived from the blob, replacing connections-stats.json).
export type GraphStats = {
  bridgeCompanies: number; // companies drawn
  bridgeCompaniesTotal: number; // the full bridge set the draw samples from
  publicFigures: number;
  edges: number;
};
export const blobStats = (blob: GraphGlobalBlob): GraphStats => ({
  bridgeCompanies: blob.companies.length,
  bridgeCompaniesTotal: blob.meta.bridgeCompaniesTotal,
  publicFigures: blob.persons.length,
  edges: blob.edges.length,
});

// ── Matrix helpers — canonical unordered cell lookup, shared by facet× and party× matrices.
export const cellKey = (a: string, b: string): string =>
  a <= b ? `${a}|${b}` : `${b}|${a}`;

export const buildMatrixLookup = (
  cells: GraphMatrixCell[],
): { axes: string[]; get: (a: string, b: string) => number; max: number } => {
  const map = new Map<string, number>();
  const axes = new Set<string>();
  let max = 0;
  for (const c of cells) {
    map.set(cellKey(c.a, c.b), c.companies);
    axes.add(c.a);
    axes.add(c.b);
    if (c.companies > max) max = c.companies;
  }
  return {
    axes: [...axes],
    get: (a, b) => map.get(cellKey(a, b)) ?? 0,
    max,
  };
};

// Facet axes keep the fixed FACET_ORDER (minus any absent); party axes sort by descending self-tie
// (diagonal) then name, so the busiest parties lead.
export const facetAxes = (blob: GraphGlobalBlob): string[] => {
  const present = new Set<string>();
  for (const c of blob.matrix) {
    present.add(c.a);
    present.add(c.b);
  }
  return FACET_ORDER.filter((f) => present.has(f));
};
export const partyAxes = (blob: GraphGlobalBlob): string[] => {
  const self = new Map<string, number>();
  const all = new Set<string>();
  for (const c of blob.partyMatrix) {
    all.add(c.a);
    all.add(c.b);
    if (c.a === c.b) self.set(c.a, c.companies);
  }
  return [...all].sort(
    (x, y) => (self.get(y) ?? 0) - (self.get(x) ?? 0) || x.localeCompare(y),
  );
};

// ── Strongest connections — person pairs sharing ≥1 drawn bridge company, derived from the blob
// (replacing connections-top-pairs.json). Each pair carries the shared companies, sorted by count then
// combined money. This is person↔person INFERRED through the shared company, exactly like the old
// top-pairs but scoped to the curated blob.
export type GraphPair = {
  a: GraphBlobPerson;
  b: GraphBlobPerson;
  shared: { eik: string; name: string | null; money: number }[];
  sharedMoney: number;
  crossParty: boolean;
};
export const blobStrongestPairs = (
  blob: GraphGlobalBlob,
  limit = 30,
): GraphPair[] => {
  const personById = new Map<number, GraphBlobPerson>();
  for (const p of blob.persons) personById.set(p.id, p);
  const companyById = new Map<string, GraphBlobCompany>();
  for (const c of blob.companies) companyById.set(c.eik, c);

  // company → the people on it (within the drawn blob).
  const peopleByCompany = new Map<string, number[]>();
  for (const e of blob.edges) {
    if (!companyById.has(e.c) || !personById.has(e.p)) continue;
    const arr = peopleByCompany.get(e.c) ?? [];
    if (!arr.includes(e.p)) arr.push(e.p);
    peopleByCompany.set(e.c, arr);
  }

  // For each company, every unordered pair of its people shares it.
  const pairMap = new Map<
    string,
    { a: number; b: number; eiks: Set<string> }
  >();
  for (const [eik, people] of peopleByCompany) {
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const [a, b] =
          people[i] < people[j]
            ? [people[i], people[j]]
            : [people[j], people[i]];
        const key = `${a}|${b}`;
        const rec = pairMap.get(key) ?? { a, b, eiks: new Set<string>() };
        rec.eiks.add(eik);
        pairMap.set(key, rec);
      }
  }

  const pairs: GraphPair[] = [];
  for (const rec of pairMap.values()) {
    const a = personById.get(rec.a);
    const b = personById.get(rec.b);
    if (!a || !b) continue;
    const shared = [...rec.eiks].map((eik) => {
      const c = companyById.get(eik);
      return { eik, name: c?.name ?? null, money: num(c?.money) };
    });
    const sharedMoney = shared.reduce((s, c) => s + c.money, 0);
    pairs.push({
      a,
      b,
      shared,
      sharedMoney,
      crossParty: !!a.party && !!b.party && a.party !== b.party,
    });
  }
  // Sort by shared-company count, then combined shared money, then a stable id tiebreak.
  pairs.sort(
    (x, y) =>
      y.shared.length - x.shared.length ||
      y.sharedMoney - x.sharedMoney ||
      x.a.id - y.a.id ||
      x.b.id - y.b.id,
  );
  return pairs.slice(0, limit);
};

// ── Rankings — top people (by money then degree) and top companies (by money), straight off the blob.
export const blobTopPeople = (
  blob: GraphGlobalBlob,
  limit = 15,
): GraphBlobPerson[] =>
  [...blob.persons]
    .sort(
      (a, b) =>
        num(b.money) - num(a.money) ||
        num(b.degree) - num(a.degree) ||
        a.id - b.id,
    )
    .slice(0, limit);

export const blobTopCompanies = (
  blob: GraphGlobalBlob,
  limit = 15,
): GraphBlobCompany[] =>
  [...blob.companies]
    .sort((a, b) => num(b.money) - num(a.money) || a.eik.localeCompare(b.eik))
    .slice(0, limit);

// ── Facet filtering — the ONE source of "which person nodes are hidden", shared by the canvas draw
// AND the BFS so the path-finder can never route through a node the canvas does not draw (FINDING-006).
// Companies are never hidden by facet; a person is hidden when its facet is in `hiddenFacets`.
export const hiddenNodeIds = (
  view: GraphView,
  hiddenFacets: Set<string>,
): Set<string> => {
  const ids = new Set<string>();
  if (hiddenFacets.size === 0) return ids;
  for (const n of view.nodes)
    if (n.kind === "person" && hiddenFacets.has(n.facet ?? "")) ids.add(n.id);
  return ids;
};

// ── BFS path-finder over the (undirected) bipartite view. Returns the ordered node-id trail from
// `from` to `to`, or null if unreachable. `blocked` node ids are skipped (hidden-facet people), so the
// path stays within the rendered graph. Person→company→person alternation falls out of the graph.
export const bfsPath = (
  view: GraphView,
  from: string,
  to: string,
  blocked?: Set<string>,
): string[] | null => {
  if (blocked?.has(from) || blocked?.has(to)) return null;
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of view.edges) {
    if (blocked?.has(e.source) || blocked?.has(e.target)) continue;
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const next of adj.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const trail: string[] = [];
  let cur: string | null = to;
  while (cur != null) {
    trail.push(cur);
    cur = prev.get(cur) ?? null;
  }
  return trail.reverse();
};
