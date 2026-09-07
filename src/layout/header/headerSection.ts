// Which top-level world a pathname belongs to — the header's active-dropdown
// tint rule, and nothing else.
//
// ⚠️ IMPORT-FREE ON PURPOSE. Header.tsx is a static import of the entry chunk
// (src/entryGraph.test.ts), so anything this module reaches is downloaded by
// every page before it can paint. Keep it string comparisons only — never take
// a path constant from a route or sector registry. `MenuItem` below is a
// TYPE-only import, which erases at compile time and adds no edge.
//
// It lives outside Header.tsx so the gate can execute the REAL rule instead of
// a copy: src/layout/header/electionsMenu.test.ts used to restate the prefix
// lists, and the copy rotted — its GOVERNANCE array held four entries against
// the component's ~25, so it asserted /my-area was Governance while the
// component tinted Elections on it, and asserted /votes was Elections while the
// component tinted Governance.

/**
 * Pathname prefixes that mark a page as "in" the Governance world.
 *
 * Membership is decided by what the PAGE says it is — a governance breadcrumb
 * ("Управление › …") or a parent link into another prefix in this list — not by
 * which menu happens to name it. A detail page whose only route home is a
 * governance page belongs here even when no menu entry points at it.
 */
export const GOVERNANCE_PREFIXES = [
  "/governance",
  // The possessive geolocate ENTRY funnel: it resolves a reader into
  // /governance/:id, so it is the Governance world's front door.
  "/my-area",
  "/parliament",
  "/votes",
  "/budget",
  "/procurement",
  "/tenders",
  "/connections",
  "/mp",
  "/mp-",
  "/company",
  "/companies",
  "/awarder",
  "/judiciary",
  "/court",
  "/council",
  "/pensions",
  "/pension-fund",
  // The person layer — the browser, one person's profile, the officials
  // rankings and the declaration registers. All render "Управление › …";
  // /candidate is deliberately NOT here, since that is the same human reached
  // from an election result, and /following is NEUTRAL (see below).
  "/persons",
  "/person",
  "/officials",
  "/declarations",
  // Sector dashboards — their breadcrumb reads "Управление › … › Сектори", so the
  // top-nav must tint управление too (they used to fall through to elections).
  // "/sector" is the generic /sector/:id route; the rest are the bespoke ones.
  "/sector",
  "/water",
  "/culture",
  "/defense",
  "/education",
  "/school",
  "/customs",
  // НЗОК: a reimbursed molecule and one of its procedures. Both link home to
  // /awarder/<НЗОК>.
  "/molecule",
  "/procedure",
  "/subsidies",
  "/farm",
  "/funds",
  "/governments",
  "/indicators",
  "/demographics",
  "/observations",
];

// ⚠ THERE IS NO LOCAL WORLD ANY MORE (Phase 3 item 6). `/local/**` and `/sverka` used to be a
// fourth top-level section with its own dropdown; the two election menus are now one, so those
// paths fall through to the Elections negative default below — which is what tints the merged
// menu when a reader is on a local result. Removing the constant rather than leaving it unused
// is deliberate: a prefix list nothing reads is a rule that looks enforced and is not.

// The Consumption (cost-of-living) world: the /consumption place tiers, one
// product's page, plus the standalone /prices explorer, which is the same КЗП
// basket data reframed.
export const CONSUMPTION_PREFIXES = ["/consumption", "/product", "/prices"];

/**
 * Routes no top-level section owns — every menu stays untinted.
 *
 * NEUTRAL IS A THIRD ANSWER, not an absence: Elections is the negative default
 * below, so a route merely LEFT OUT of the three worlds is tinted Elections, not
 * left alone. Anything genuinely global has to be named here to escape it.
 *
 * ⚠️ Matching `"/"` here is exactly the old `pathname !== "/"` clause and nothing
 * wider — `isInSection` needs either equality or a following slash, and no real
 * pathname starts `//`. It was a hardcoded comparison until /following needed the
 * same treatment; one mechanism beats two.
 *
 * - `/` is the global home.
 * - `/following` is the header's own watchlist — reachable from every page via
 *   <FollowingHeaderLink>, so it belongs to whichever world the reader came from.
 *   It lists people and links to /person, which is why Governance is tempting;
 *   tinting a section the reader did not navigate into is the reason it does not.
 */
export const NEUTRAL_PREFIXES = ["/", "/following"];

export const isInSection = (pathname: string, prefixes: string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export type HeaderSection = {
  inElections: boolean;
  inGovernance: boolean;
  inConsumption: boolean;
};

/**
 * ⚠️ ELECTIONS IS THE NEGATIVE DEFAULT, and it is narrowed by exclusion rather
 * than the whole test being inverted. It catches ~40 deep routes (/municipality,
 * /settlement, /sections, /section, /candidate, /elections/:date, /sofia,
 * /reports, /polls, /articles …) without listing them, so rewriting it as a
 * positive prefix list would silently de-highlight whichever one the list forgot.
 * What does NOT belong to Elections is therefore stated — as one of the three
 * other worlds, or as NEUTRAL_PREFIXES.
 *
 * ⚠️ TRANSIENT UNTIL THE ROOT CUTOVER: `/` still RENDERS the election dashboard, so
 * this leaves the Elections menu untinted on an election page. Correct only because
 * the route move and the cutover ship as one release — if the cutover is rolled
 * back, roll this back with it.
 */
export const headerSection = (pathname: string): HeaderSection => {
  const inGovernance = isInSection(pathname, GOVERNANCE_PREFIXES);
  const inConsumption = isInSection(pathname, CONSUMPTION_PREFIXES);
  return {
    inGovernance,
    inConsumption,
    inElections:
      !isInSection(pathname, NEUTRAL_PREFIXES) &&
      !inGovernance &&
      !inConsumption,
  };
};

/** The Elections tint on its own — the negative default above. */
export const inElections = (pathname: string): boolean =>
  headerSection(pathname).inElections;

/**
 * Deal a dropdown's section groups onto its columns so both end up about as tall.
 *
 * ⚠ IT COUNTS ROWS, NOT GROUPS. A group costs its leaves plus its own heading, so splitting
 * five groups 3/2 by count puts Управление's 6+4+3 beside its 8+4 and looks balanced while
 * being two rows out. Greedy min-fill is enough at three to five groups.
 *
 * ⚠ DECLARATION ORDER IS PRESERVED, AND THAT COSTS SOME BALANCE ON PURPOSE. The textbook
 * improvement is to assign largest-group-first (LPT), which levels Потребление's 7-vs-10
 * split to 9-vs-8 — and moves „Пари и разходи", the first section Управление declares, into
 * the RIGHT column. A menu whose first section is not top-left is worse than a menu with
 * some slack at the bottom of one column.
 *
 * ⚠ IT REPLACED A 2-COLUMN CSS GRID, whose real defect was not balance but HOLES: a grid
 * aligns rows, so a 6-leaf group beside an 8-leaf one left two empty rows in the middle of
 * the shorter column — under „Държавни сектори" on Управление, under „Промоции" on
 * Потребление. Stacked flex columns cannot do that; any slack falls at the bottom.
 *
 * @param groups - The `group: true` items, in the order the menu declares them.
 * @param columns - How many columns to fill.
 * @returns One array of groups per column, each in declaration order. Empty columns are
 *   dropped, so a menu with fewer groups than columns renders no stray gap.
 */
export const balanceGroups = <T extends { subMenu?: unknown[] }>(
  groups: T[],
  columns = 2,
): T[][] => {
  const cols: T[][] = Array.from({ length: columns }, () => []);
  const rows = new Array<number>(columns).fill(0);
  for (const group of groups) {
    const target = rows.indexOf(Math.min(...rows));
    cols[target].push(group);
    rows[target] += (group.subMenu?.length ?? 0) + 1;
  }
  return cols.filter((c) => c.length > 0);
};
