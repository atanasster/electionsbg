// The ONE order in which `:cloud` commands run on a publish.
//
// A handler lists WHICH cloud commands its datasets need; it does not get to
// say WHEN. Two handlers in one run each bring a partial list, and the merged
// manifest must still satisfy every "loader B reads what loader A wrote" rule
// in CLAUDE.md — so the order lives here, once, and the manifest is sorted by
// it. A command absent from this list fails the registry coverage test.
//
// Entries are the command with the `pnpm run ` prefix removed. Every cloud
// command is a package script, so its database URL is pinned in package.json.

export const CLOUD_ORDER: readonly string[] = [
  // dimensions every later loader joins
  "db:load:place-dim:pg:cloud",

  // procurement corpus, then what is derived from it
  "db:load:pg:cloud",
  "db:load:tenders:pg:cloud",
  "db:load:awarder-seats:pg:cloud",
  "proc:verify-seats:cloud",
  "db:load:annexes:pg:cloud",
  "db:load:procurement-scopes:pg:cloud",
  "db:load:nzok-hospital:pg:cloud",
  "db:load:nzok-hospital-map:pg:cloud",
  "db:load:water-operator-map:pg:cloud",
  "db:load:mvr-directorate-map:pg:cloud",
  "db:load:transport-project-map:pg:cloud",
  "db:load:transport-facility-map:pg:cloud",
  "db:load:cprs:pg:cloud",
  "db:load:ted:pg:cloud",
  "db:load:adfi:pg:cloud",
  "db:load:aop-experts:pg:cloud",
  "kzk:appeals:cloud",
  "db:load:kzk-decisions:pg:cloud",
  "kzk:rejoin:cloud --apply",

  // funds, subsidies, NGO money
  "db:load:funds:pg:cloud --full",
  "db:load:funds-fit:pg:cloud",
  "db:load:clean-delivery:pg:cloud",
  "db:load:agri:pg:cloud",
  "db:load:ngo-funding:pg:cloud",
  "db:load:ngo-board-links:cloud",

  // budget (place-dim first; the hub cache last)
  "db:load:municipal-fiscal:pg:cloud",
  "db:load:budget:pg:cloud",
  "db:load:budget-muni:pg:cloud",
  "db:load:budget-hub:pg:cloud",
  "db:load:budget-named:pg:cloud", // reads only its own tables
  "db:load:budget-decrees:pg:cloud", // reads only its own tables

  // vaccines (place-dim first — every oblast resolves through it)
  "db:load:vaccines:pg:cloud",

  // independent families
  "db:load:admin-services:pg:cloud",
  "db:load:admin-service-requests:pg:cloud",
  "db:load:schools:pg:cloud",
  "db:load:excise-warehouses:pg:cloud",
  "db:load:open-calls:pg:cloud",
  "db:load:zdoi:pg:cloud", // reads only its own tables; no ordering dependency
  "db:load:election-national:pg:cloud",
  "db:load:mp-roster:pg:cloud",
  "db:load:rollcall:pg:cloud",
  "db:load:rollcall-derived:pg:cloud",
  "db:load:nzok-drug-quarterly:pg:cloud",
  "db:load:nzok-drug-prices:pg:cloud",
  "db:load:nzok-financials:pg:cloud",
  "db:load:nzok-activities:pg:cloud",
  "db:load:nzok-tariffs:pg:cloud",

  // judiciary: the roster before the dimension built from it
  "db:load:judiciary-payloads:pg:cloud",
  "db:load:court-load:pg:cloud",
  "db:load:magistrates:pg:cloud",
  "db:load:magistrate-filing-assets:pg:cloud",
  "db:load:judicial-bodies:pg:cloud",

  // Commerce Registry
  "db:load:tr:pg:cloud",
  "db:load:cr-nkid:pg:cloud",
  // ships local company_founded; refreshes the risk-indexes payload itself,
  // and the risk-cache rebuild below must see its dates.
  "db:load:company-founded:pg:cloud",
  "db:refresh:risk:cloud",
  "db:load:tr-name-fold-people:pg:cloud",
  // the comdos.bg ДС corpus the resolver attaches the ДС facet from
  "db:load:ds:pg:cloud",

  // the person chain: declarations phase 1 → resolve → phase 2 → dependents
  "db:load:declarations:pg:cloud",
  "db:resolve:persons:cloud",
  "db:load:declarations:pg:cloud --resolve",
  "db:load:company-politicians:pg:cloud",
  "db:load:employer-links:pg:cloud",
  "db:load:grant-links:pg:cloud",
  "db:load:official-candidate-links:pg:cloud",
  "db:load:person-elections:pg:cloud",
  "db:load:council:pg:cloud",
  "db:load:persons-browse:pg:cloud",
  "db:load:person-search:pg:cloud",

  // Interreg → graph (127's only applier) → the place crosswalk that
  // denormalizes 127
  "db:load:interreg:pg:cloud",
  "db:load:graph:pg:cloud",
  "db:load:agri-hub-stats:pg:cloud",
  "db:load:tr-company-place:pg:cloud",

  // minted from the serving database, after everything it reads
  "person:slugs:cloud",
  "data:local-person-refresh:cloud",

  "prices:ingest:cloud",
  // Post-steps: the price hub after its corpus; the alerts feed last, since
  // it reads across every family above.
  "prices:payloads:cloud",
  "myarea:alerts:cloud",
];

const RANK = new Map(CLOUD_ORDER.map((c, i) => [c, i]));

/** The CLOUD_ORDER slot of a full command line, or null when it has none.
 *
 *  A slot that carries arguments (`… --resolve`, `… --full`) is a distinct
 *  step and is matched exactly. Otherwise arguments are run-time scope
 *  (`kzk:appeals:cloud --year 2026`) and the bare script name decides. */
export const cloudSlot = (command: string): string | null => {
  const m = command.match(/^pnpm run (.+)$/);
  if (!m) return null;
  if (RANK.has(m[1])) return m[1];
  const script = m[1].split(/\s+/)[0];
  return RANK.has(script) ? script : null;
};

const cloudRank = (command: string): number => {
  const slot = cloudSlot(command);
  return slot === null
    ? Number.MAX_SAFE_INTEGER
    : (RANK.get(slot) ?? Number.MAX_SAFE_INTEGER);
};

/** Dedupe, then sort into publish order. Unknown commands keep their relative
 *  order at the END — never silently dropped, and the coverage test is what
 *  stops a registry entry from being unknown in the first place. */
export const orderCloud = (commands: readonly string[]): string[] =>
  [...new Set(commands)]
    .map((c, i) => ({ c, i, r: cloudRank(c) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
