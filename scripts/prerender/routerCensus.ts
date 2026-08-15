// The one way to ask `src/routes.tsx` "what pages does this router serve?".
//
// ⚠️ EXTRACTED BECAUSE EVERY REGEX ATTEMPT AT THIS HAS BEEN WRONG, and there
// have been three. The coverage gate's own resolver climbed ONE level of
// nesting, so it reported 41 real pages under names that are not URLs on this
// site (`municipality/recount` for `/reports/municipality/recount`) — a gate
// naming paths nobody can visit is worse than no gate, because the first reader
// who checks one finds it fine and stops trusting the rest. Two siblings still
// carry the same class of limitation and are candidates for this module:
// `src/screens/funds/fundsHubCoverage.test.ts` (a flat `matchAll`) and
// `src/screens/reports/common/reportsMatrix.test.ts` (a line-oriented walker
// whose own comment concedes it needs the opener on ONE line). Neither is wrong
// today; both are wrong the moment the router is nested differently.
//
// A depth-tracking regex does not fix it either — a `<Route>` element spans many
// lines and its `element={…}` JSX contains `/>` of its own, so the
// open/self-close discrimination is not decidable by pattern. `typescript` is
// already a dependency, and `ScriptKind.TSX` gives the nesting structurally.

import ts from "typescript";

export type RoutedPage = {
  /** Full path from the router root — `reports/municipality/recount`, never the
   *  bare `recount` segment as written in the file. */
  path: string;
  /** A `<Route path="X">` with children and no `element` is a GROUPING node, not
   *  a page: React Router renders nothing at `/X` itself. There are five today
   *  (`parliamentary`, `reports`, and the three `reports/*` grains). */
  hasElement: boolean;
  /** The element redirects rather than rendering a page, so it has no head to
   *  get wrong. */
  redirect: boolean;
  /** The `path=` attribute was not a string literal, so the full path could not
   *  be resolved statically — see `unresolvedPaths` below. */
  unresolved: boolean;
};

const attrsOf = (open: ts.JsxOpeningLikeElement) => {
  const out: Record<string, { text?: string; isStringLiteral: boolean }> = {};
  for (const a of open.attributes.properties) {
    if (!ts.isJsxAttribute(a) || !a.name) continue;
    const name = a.name.getText();
    if (!a.initializer) {
      out[name] = { isStringLiteral: false };
    } else if (ts.isStringLiteral(a.initializer)) {
      out[name] = { text: a.initializer.text, isStringLiteral: true };
    } else {
      out[name] = { text: a.initializer.getText(), isStringLiteral: false };
    }
  }
  return out;
};

/** Every `<Route>` node in the source, with its full path resolved through
 *  arbitrary nesting depth.
 *
 *  ⚠️ INDEX ROUTES ARE DELIBERATELY EXCLUDED. `<Route index element={…} />`
 *  carries no `path`, so it has no segment of its own; its URL is its parent's.
 *  There are two in `routes.tsx` — the home page (`/`) and a `<Navigate>` inside
 *  `reports` — and both are already declared or redirecting, so resolving them
 *  would add no coverage while changing every consumer's baseline. Stated rather
 *  than silently dropped: a gate named "every routed page" structurally cannot
 *  see `/`, and a future index route under a group would be invisible too. */
export const censusRoutes = (routerSrc: string): RoutedPage[] => {
  const ast = ts.createSourceFile(
    "routes.tsx",
    routerSrc,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: RoutedPage[] = [];

  const walk = (node: ts.Node, stack: string[]): void => {
    const isSelf = ts.isJsxSelfClosingElement(node);
    const isEl = ts.isJsxElement(node);
    const tag = isSelf
      ? node.tagName.getText()
      : isEl
        ? node.openingElement.tagName.getText()
        : "";
    if ((isSelf || isEl) && tag === "Route") {
      const open = isSelf ? node : node.openingElement;
      const a = attrsOf(open);
      const seg = a.path?.text;
      const el = a.element?.text ?? "";
      // The two redirect forms present in routes.tsx TODAY: the inline
      // `element={<Navigate to=… />}` and the wrapper-component form
      // (`<DataMapRedirect />`, `<MyAreaIdRedirect />`, `<DbCompanyRedirect />`,
      // `<OfficialProfileRedirect />`).
      //
      // ⚠️ NOT COMPLETE, and the gap has a live example. A component that
      // redirects from inside its OWN module is invisible here:
      // `CandidateConnectionsScreen` (routes.tsx:2490) is 17 lines that
      // unconditionally return `<Navigate>`, and it escapes only because its
      // route is parameterised and consumers drop `:` paths. Three more are in
      // the same position (`LocalRegionDashboardScreen`, `RegionGovernanceScreen`,
      // `RegionConsumptionScreen`). Route any of them at a non-parameterised
      // path and it counts as a page that needs a head.
      const redirect =
        /<\s*Navigate\b/.test(el) || /<\s*\w*Redirect\b/.test(el);
      if (seg !== undefined) {
        out.push({
          path: [...stack, seg].filter(Boolean).join("/"),
          hasElement: a.element !== undefined,
          redirect,
          unresolved: a.path?.isStringLiteral === false,
        });
      }
      if (isEl) {
        const next = seg !== undefined ? [...stack, seg] : stack;
        for (const c of node.children) walk(c, next);
      }
      return;
    }
    node.forEachChild((c) => walk(c, stack));
  };
  walk(ast, []);
  return out;
};

/** The addressable, non-parameterised PAGES — what a crawler can reach and what
 *  therefore needs its own `<title>` and canonical. Grouping nodes, redirects,
 *  the catch-all and every `:param` family are excluded. */
export const staticRoutedPages = (routerSrc: string): string[] =>
  censusRoutes(routerSrc)
    .filter((r) => r.hasElement && !r.redirect && !r.unresolved)
    .map((r) => r.path)
    .filter((p) => p && p !== "*" && !p.includes(":"))
    .filter((p, i, a) => a.indexOf(p) === i)
    .sort();

/** `path=` attributes that are not string literals, so the walk cannot resolve
 *  them. Zero today — but `ROADS_AWARDER_PATH` is already imported into
 *  `routes.tsx` and used in an `element=`, so the idiom is present in the file
 *  and a `path={SOME_CONST}` would otherwise enter the census as the literal
 *  segment `"{SOME_CONST}"` — a silent wrong answer rather than a loud one. */
export const unresolvedPaths = (routerSrc: string): string[] =>
  censusRoutes(routerSrc)
    .filter((r) => r.unresolved)
    .map((r) => r.path);
