// A hub/sector finder may be mounted ONCE per screen — the static gate for a
// defect that ships green and lands on screen-reader users.
//
// `EntitySearchTile` derives four DOM references from the `idPrefix` its caller
// hands it: `aria-controls={`${idPrefix}-results`}`,
// `aria-activedescendant={`${idPrefix}-opt-${id}`}`, and the matching `id=` on
// the listbox and on every option. Each finder component hardcodes ONE literal
// idPrefix, so a second mount of the same finder in the same tree duplicates
// every one of those ids — and `document.getElementById` semantics then resolve
// the LOWER combobox's aria-controls / aria-activedescendant to the UPPER
// listbox. A screen-reader user arrowing through the second box is told about
// options in the first.
//
// Nothing else catches it. Duplicate ids are valid TypeScript, valid JSX, valid
// React and valid to eslint; both boxes filter correctly and look right, so the
// only symptom is in the accessibility tree. /defense shipped exactly this —
// commit 46eb952d3a added a copy outside the `gdp.data` gate to fix a real
// availability bug and did not remove the copy inside it, leaving one screen of
// the eight rendering its finder twice.
//
// TWO ARMS, because the defect has two shapes and each is blind to the other:
//
//   A. INLINE — a screen that renders `<HubSearch idPrefix="x">` directly
//      (ParliamentHubScreen, CultureHubScreen, BudgetHubScreen,
//      GovernanceDeclarationsScreen). Here the literal appears twice in the
//      one file, so the check is on the literal.
//   B. EXTRACTED — a screen that mounts a finder COMPONENT which holds the
//      literal (`<DefenseSearchBox />`). Here the literal appears exactly once,
//      in a file the screen does not even contain, so arm A sees nothing. This
//      is the /defense shape.
//
// The finder set is DERIVED, never listed: any file that renders one of the
// search primitives with a literal idPrefix IS a finder, so a new one is gated
// the day it is written. A hand-kept list would only ever cover the finders
// somebody already thought of, which is the failure mode the roster audits in
// CLAUDE.md keep recording.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../scripts/lib/strip_comments";

const SRC = resolve(__dirname, "..");

/** The search primitives that turn an idPrefix into DOM ids. A file rendering
 *  one of these with a literal idPrefix is a finder definition. */
const PRIMITIVES = ["HubSearch", "SectorEntitySearch", "EntitySearchTile"];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const TSX = walk(SRC).filter(
  (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
);

/** `idPrefix="literal"` — the string form only. `idPrefix={`${x}-…`}` is a
 *  template (SectorMembersSearch keys its prefix on the sector id), so it does
 *  not pin a single id set and is not a literal-collision risk. */
const LITERAL_ID_PREFIX = /idPrefix=\{?"([^"]+)"\}?/g;

const bodyOf = (file: string) => stripComments(readFileSync(file, "utf8"));

const rendersPrimitive = (body: string) =>
  PRIMITIVES.some((p) => new RegExp(`<${p}\\b`).test(body));

/** Exported component names — `export const Foo: FC` / `export const Foo = ` /
 *  `export function Foo`. Restricted to PascalCase so helper exports are out. */
const exportedComponents = (body: string): string[] => {
  const names = new Set<string>();
  for (const m of body.matchAll(
    /export\s+(?:const|function)\s+([A-Z][A-Za-z0-9_]*)/g,
  )) {
    names.add(m[1]);
  }
  return [...names];
};

interface Finder {
  file: string;
  component: string;
  idPrefix: string;
}

const FINDERS: Finder[] = TSX.flatMap((file) => {
  const body = bodyOf(file);
  if (!rendersPrimitive(body)) return [];
  const prefixes = [...body.matchAll(LITERAL_ID_PREFIX)].map((m) => m[1]);
  if (!prefixes.length) return [];
  // A finder definition file exports exactly the component that holds the
  // prefix; an inline hub screen exports its screen. Either way the exported
  // name is what a *consumer* would render, which is what arm B counts.
  return exportedComponents(body).map((component) => ({
    file: relative(SRC, file),
    component,
    idPrefix: prefixes[0],
  }));
});

describe("hub finders render exactly once (duplicate-DOM-id gate)", () => {
  // Non-vacuity. If the primitives are renamed or the literal form changes, the
  // derivation silently finds nothing and BOTH arms below pass over an empty
  // set — a green suite asserting nothing at all.
  it("derives a non-trivial finder set", () => {
    expect(FINDERS.length).toBeGreaterThanOrEqual(10);
    // The screen this gate was written for must be in it.
    expect(FINDERS.map((f) => f.component)).toContain("DefenseSearchBox");
  });

  // ARM A — a literal idPrefix is used once per file. Catches the inline hub
  // screens, where the duplicate would be two `<HubSearch idPrefix="x">` in one
  // component. Reported in aggregate rather than per file: ~1,500 `it.each`
  // cases drown the reporter, and the useful failure names every offender at
  // once anyway.
  it("uses each literal idPrefix at most once per file", () => {
    const offenders: string[] = [];
    for (const file of TSX) {
      const seen = new Map<string, number>();
      for (const m of bodyOf(file).matchAll(LITERAL_ID_PREFIX)) {
        seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
      }
      for (const [prefix, n] of seen) {
        if (n > 1)
          offenders.push(`${relative(SRC, file)}: idPrefix "${prefix}" ×${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // ARM B — no screen mounts the same finder component twice. This is the
  // /defense shape, and the one arm A cannot see: there the literal lives in a
  // file the offending screen does not even contain.
  it("mounts each finder component at most once per file", () => {
    const offenders: string[] = [];
    for (const file of TSX) {
      const rel = relative(SRC, file);
      const body = bodyOf(file);
      for (const { component, file: def } of FINDERS) {
        // Skip the finder's own definition file: `export const X` is not a
        // render of X, and a finder rendering itself would be a different
        // (infinite) bug.
        if (rel === def) continue;
        const hits = body.match(new RegExp(`<${component}\\b`, "g")) ?? [];
        if (hits.length > 1)
          offenders.push(`${rel}: <${component} /> ×${hits.length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
