// The chain-aware deploy resolver (docs/plans/cloud-deploy-speed-v1.md §v2.2 / §v2-d).
//
// Given the set of base datasets that changed this publish, compute the MINIMAL,
// ORDERED set of loaders to run — so a publish that only touched prices does not
// drag the whole person chain along, and a contracts change runs the money tail
// (graph → tr-company-place → persons-browse → person-search) exactly once, in
// dependency order.
//
// SCOPE — a PURE FUNCTION over the v2-c registry (derivedRegistry.ts). Nothing here
// executes a loader or edits one; the resolver returns a plan the orchestrator's
// Step-8 emission (v2-e) will consume. It solves the FAN-OUT problem (run only the
// loaders whose outputs actually went stale). It does NOT solve the DOUBLE-REFRESH
// problem (a shared cache rebuilt by two selected loaders is still rebuilt twice) —
// that needs per-loader suppression, which is invasive and belongs to v2-e.
//
// The registry is the single source of truth: `inputs` drive the cascade, and
// `rebuiltBy[0]` is the PRIMARY (canonical) loader for an object — the one chosen to
// cover it when no loader that rebuilds it is already running for another reason.

import { DERIVED_OBJECTS, type DerivedObject } from "./derivedRegistry";

/** Base dataset → the loader that reloads it, and the cascade's entry points.
 *  Most entries are physical source tables; a few (e.g. `person_wealth_year` (090),
 *  `company_politicians` (008)) are themselves DERIVED but are modelled here as
 *  leaves — nothing in `DERIVED_OBJECTS` rebuilds them, so the resolver enters the
 *  declaration / TR sub-graphs at these nodes rather than cascading further up.
 *  A changed base table with NO entry here has no automated loader (e.g.
 *  `kzk_appeals`, whose only writer is the manual kzk_appeals.ts --apply crawl); the
 *  resolver still cascades its downstream objects, it just cannot emit a base load
 *  for it — reported in `unmappedChanges` so the caller knows a manual step is owed. */
export const BASE_LOADERS: Record<string, string> = {
  contracts: "db:load:pg",
  tenders: "db:load:tenders:pg",
  awarder_seats: "db:load:awarder-seats:pg",
  place_dim: "db:load:place-dim:pg",
  tr_companies: "db:load:tr:pg",
  tr_officers: "db:load:tr:pg",
  tr_person_roles: "db:load:tr:pg",
  company_politicians: "db:load:tr:pg",
  company_nkid: "db:load:cr-nkid:pg",
  person_role: "db:resolve:persons",
  person_wealth_year: "db:load:declarations:pg",
  official_candidate_link: "db:load:official-candidate-links:pg",
  judicial_body: "db:load:judicial-bodies:pg",
  agri_subsidies: "db:load:agri:pg",
  agri_payloads: "db:load:agri:pg",
  fund_beneficiaries: "db:load:funds:pg",
  fund_projects: "db:load:funds:pg",
  fund_payloads: "db:load:funds:pg",
  interreg_partners: "db:load:interreg:pg",
  interreg_operations: "db:load:interreg:pg",
  kzk_decisions: "db:load:kzk-decisions:pg",
  budget_admin_node: "db:load:budget:pg",
  budget_muni_transfer: "db:load:budget-muni:pg",
  ngo_funding: "db:load:ngo-funding:pg",
  // kzk_appeals — manual crawl (kzk_appeals.ts --apply), no automated base loader.
};

export interface DeployPlan {
  /** derived objects that went stale and need rebuilding, in no particular order */
  objects: string[];
  /** the loaders to run, in dependency order — each at most once */
  loaders: string[];
  /** changed base datasets with no automated loader (a manual step is owed) */
  unmappedChanges: string[];
  /** true if the object graph had a cycle the topo-sort could not fully order
   *  (the remaining loaders are appended in stable order; today's registry is
   *  acyclic, so this is a guard, not an expected state) */
  cyclic: boolean;
}

// The base tables a loader reloads TOGETHER (reverse of BASE_LOADERS). A loader
// reloads all of these in one run, so a change to any one is a change to all — used
// both to expand the dirty seed and to spot an "unrelated-heavy" base load.
const CO_LOADED: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [t, l] of Object.entries(BASE_LOADERS)) {
    const arr = m.get(l) ?? [];
    arr.push(t);
    m.set(l, arr);
  }
  return m;
})();

/**
 * Resolve the minimal ordered loader set for a set of changed base datasets.
 *
 * @param changed base table names that were reloaded this publish (e.g.
 *   `["contracts"]`, `["tr_companies"]`). Order and duplicates do not matter — the
 *   plan is normalised to be invariant to both.
 * @param objects the derived-object registry (defaulted; injectable for testing —
 *   e.g. a synthetic cyclic fixture).
 */
export const resolveDeploySet = (
  changed: readonly string[],
  objects: readonly DerivedObject[] = DERIVED_OBJECTS,
): DeployPlan => {
  const byName = new Map(objects.map((o) => [o.name, o] as const));
  const producersOf = (name: string): string[] => {
    const base = BASE_LOADERS[name];
    if (base) return [base];
    return byName.get(name)?.rebuiltBy ?? [];
  };

  // Normalise: dedupe + sort so the plan is invariant to the permutation (and
  // duplication) of `changed`.
  const changedInput = [...new Set(changed)].sort();

  // Expand co-loaded siblings — a loader reloads all its base tables at once, so a
  // change to one is a change to all. Without this, ["fund_beneficiaries"] would miss
  // fund_projects-derived objects even though db:load:funds:pg reloaded both.
  const changedSet = new Set(changedInput);
  for (const t of changedInput)
    for (const sib of CO_LOADED.get(BASE_LOADERS[t]) ?? []) changedSet.add(sib);

  // 1. Cascade: an object is dirty if any input is dirty; its NAME then becomes dirty
  //    too, so objects that read it (e.g. tr_company_place reads company_public_money)
  //    fire in turn. Iterate to a fixpoint.
  const dirty = new Set<string>(changedSet);
  const dirtyObjects = new Set<DerivedObject>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of objects) {
      if (dirtyObjects.has(o)) continue;
      if (o.inputs.some((t) => dirty.has(t))) {
        dirtyObjects.add(o);
        dirty.add(o.name);
        grew = true;
      }
    }
  }

  // 2. Select loaders. Base loaders for changed tables are forced. Then cover every
  //    dirty object with ONE rebuilder, avoiding an unrelated heavy reload.
  const selected = new Set<string>();
  const unmappedChanges: string[] = [];
  for (const t of changedInput) {
    const base = BASE_LOADERS[t];
    if (base) selected.add(base);
    else if (!byName.has(t)) unmappedChanges.push(t);
  }
  // A loader is "unrelated-heavy" if it is a base loader whose base tables are ALL
  // unchanged — running it just to refresh a downstream cache would reload a corpus
  // nobody touched (e.g. picking db:load:pg to cover a cache when only kzk changed).
  const unrelatedHeavy = (l: string): boolean => {
    const tables = CO_LOADED.get(l);
    return !!tables && tables.every((t) => !changedSet.has(t));
  };
  // Cover an object: reuse an already-running rebuilder; else the first rebuilder
  // that is not an unrelated-heavy base load; else the primary (rebuiltBy[0]).
  const coverFor = (o: DerivedObject): string => {
    const chosen =
      o.rebuiltBy.find((l) => selected.has(l)) ??
      o.rebuiltBy.find((l) => !unrelatedHeavy(l)) ??
      o.rebuiltBy[0];
    if (!chosen)
      throw new Error(
        `deployResolver: object "${o.name}" has no rebuiltBy loader to cover it`,
      );
    return chosen;
  };

  // chosen loader per dirty object — the one we rely on to have rebuilt it (for
  // ordering). Deterministic pass order = registry order.
  const chosenBy = new Map<DerivedObject, string>();
  const ordered = objects.filter((o) => dirtyObjects.has(o));
  for (const o of ordered) {
    const chosen = coverFor(o);
    selected.add(chosen);
    chosenBy.set(o, chosen);
  }

  // 3. Order the selected loaders. Edge Lp → Lc when a dirty object o (covered by
  //    loader Lc) reads an input produced by loader Lp — so the producer runs first.
  const edges = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();
  for (const l of selected) {
    edges.set(l, new Set());
    indeg.set(l, 0);
  }
  const addEdge = (from: string, to: string): void => {
    if (from === to || !selected.has(from) || !selected.has(to)) return;
    const set = edges.get(from)!;
    if (!set.has(to)) {
      set.add(to);
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
    }
  };
  for (const o of ordered) {
    const lc = chosenBy.get(o)!;
    for (const input of o.inputs) {
      // the loader we rely on to have produced this input, if it is in the plan
      const inputObj = byName.get(input);
      const producer =
        inputObj && dirtyObjects.has(inputObj)
          ? chosenBy.get(inputObj) // a dirty derived input: its chosen rebuilder
          : producersOf(input).find((p) => selected.has(p)); // base input's loader
      if (producer) addEdge(producer, lc);
    }
  }

  // Kahn topo-sort. `selected` insertion order (base loaders in sorted-input order,
  // then covers in registry order) is a canonical, permutation-invariant seed; `rank`
  // is that order precomputed so the tie-break is O(1) rather than an indexOf scan.
  const seed = [...selected];
  const rank = new Map(seed.map((l, i) => [l, i] as const));
  const ready = seed.filter((l) => (indeg.get(l) ?? 0) === 0);
  const loaders: string[] = [];
  const take = (l: string): void => {
    loaders.push(l);
    for (const nxt of edges.get(l) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) ready.push(nxt);
    }
  };
  while (ready.length) {
    ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
    take(ready.shift()!);
  }
  let cyclic = false;
  if (loaders.length < selected.size) {
    // a cycle left some loaders unemitted — append them in stable order and flag it
    cyclic = true;
    for (const l of seed) if (!loaders.includes(l)) loaders.push(l);
  }

  return {
    objects: ordered.map((o) => o.name),
    loaders,
    unmappedChanges,
    cyclic,
  };
};
