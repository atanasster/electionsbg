// Which top-level world a pathname belongs to — the header's active-dropdown
// tint rule, and nothing else.
//
// ⚠️ IMPORT-FREE ON PURPOSE. Header.tsx is a static import of the entry chunk
// (src/entryGraph.test.ts), so anything this module reaches is downloaded by
// every page before it can paint. Keep it string comparisons only — never take
// a path constant from a route or sector registry.
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
