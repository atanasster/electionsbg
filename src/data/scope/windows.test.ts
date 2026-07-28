// The scope→window mapping (src/data/scope/windows).
//
// WHAT THIS PROTECTS. Two things derive a date window from a pscope: the React hook every
// scoped view reads, and the Node loaders that PRECOMPUTE per-scope rows. They used to be
// separate implementations. If they disagree, nothing fails — a precompute keyed on one
// window is served under the other's label, so the page shows the wrong period's numbers
// with a confident heading. Now there is one function; these tests pin its behaviour,
// including the edge cases the old inline copies handled implicitly.

import { describe, it, expect } from "vitest";
import {
  allScopeWindows,
  newestFirst,
  parliamentWindow,
  scopeKeyFor,
  scopeWindowFor,
} from "./windows";

// Newest-first, like the real elections.json.
const ELECTIONS = [
  { name: "2026_04_19" },
  { name: "2024_10_27" },
  { name: "2024_06_09" },
  { name: "2023_04_02" },
];

describe("parliamentWindow", () => {
  it("runs from an election to the NEXT-NEWER one", () => {
    expect(parliamentWindow(ELECTIONS, "2024_06_09")).toEqual({
      from: "2024-06-09",
      to: "2024-10-27",
    });
  });

  it("leaves the newest election's window open-ended", () => {
    expect(parliamentWindow(ELECTIONS, "2026_04_19")).toEqual({
      from: "2026-04-19",
      to: null,
    });
  });

  it("is immune to the source being sorted oldest-first", () => {
    // The upper bound reads the PREVIOUS index. If the list order were trusted rather than
    // re-sorted, every window would invert (from > to) and silently return empty sets.
    const oldestFirst = [...ELECTIONS].reverse();
    expect(parliamentWindow(oldestFirst, "2024_06_09")).toEqual(
      parliamentWindow(ELECTIONS, "2024_06_09"),
    );
  });

  it("still bounds an election missing from the list", () => {
    // A brand-new election that has not reached elections.json yet reads "everything since
    // it" rather than collapsing to the full corpus and overstating the period.
    expect(parliamentWindow(ELECTIONS, "2027_01_01")).toEqual({
      from: "2027-01-01",
      to: null,
    });
  });
});

describe("scopeWindowFor", () => {
  it("drops the window entirely for 'all'", () => {
    expect(scopeWindowFor("all", "2024_06_09", ELECTIONS)).toEqual({
      from: null,
      to: null,
    });
  });

  it("maps y:<year> to a half-open calendar year", () => {
    // Upper bound EXCLUSIVE — a contract signed 2024-12-31 is in, 2025-01-01 is not.
    expect(scopeWindowFor("y:2024", "2026_04_19", ELECTIONS)).toEqual({
      from: "2024-01-01",
      to: "2025-01-01",
    });
  });

  it("treats the default scope as the selected parliament", () => {
    expect(scopeWindowFor("ns", "2024_06_09", ELECTIONS)).toEqual(
      parliamentWindow(ELECTIONS, "2024_06_09"),
    );
  });

  it("reproduces the hook implementation it replaced, for every scope", () => {
    // The old useScopeWindow body, verbatim, as the oracle.
    const dash = (d: string) => d.replace(/_/g, "-");
    const legacy = (scope: string, selected: string) => {
      const all = scope === "all";
      const year = scope.startsWith("y:") ? Number(scope.slice(2)) : null;
      if (year != null)
        return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
      const idx = ELECTIONS.findIndex((e) => e.name === selected);
      return {
        from: all ? null : dash(selected),
        to: all ? null : idx > 0 ? dash(ELECTIONS[idx - 1].name) : null,
      };
    };
    for (const selected of ELECTIONS.map((e) => e.name).concat("2027_01_01"))
      for (const scope of ["ns", "all", "y:2011", "y:2024", "y:2026"])
        expect({
          scope,
          selected,
          ...scopeWindowFor(scope, selected, ELECTIONS),
        }).toEqual({
          scope,
          selected,
          ...legacy(scope, selected),
        });
  });
});

describe("scopeKeyFor", () => {
  it("keys a parliament by the SELECTED election, not by the scope alone", () => {
    // 'ns' means a different window per election, so the key has to carry it.
    expect(scopeKeyFor("ns", "2024_06_09")).toBe("ns:2024_06_09");
    expect(scopeKeyFor("ns", "2026_04_19")).toBe("ns:2026_04_19");
  });

  it("ignores the selected election for scopes that do not depend on it", () => {
    expect(scopeKeyFor("all", "2024_06_09")).toBe("all");
    expect(scopeKeyFor("y:2024", "2026_04_19")).toBe("y:2024");
  });
});

describe("allScopeWindows", () => {
  const windows = allScopeWindows(ELECTIONS, 2026, 2011);

  it("covers every scope the UI can request", () => {
    // The whole point: a scope the UI can select but the loader did not precompute serves
    // an empty page. 'all' + 16 years (2011..2026) + 4 elections.
    expect(windows).toHaveLength(1 + 16 + 4);
    expect(windows.filter((w) => w.key === "all")).toHaveLength(1);
    for (const e of ELECTIONS)
      expect(windows.some((w) => w.key === `ns:${e.name}`)).toBe(true);
    for (const y of [2011, 2020, 2026])
      expect(windows.some((w) => w.key === `y:${y}`)).toBe(true);
  });

  it("agrees with scopeWindowFor on every key it emits", () => {
    // The enumeration and the single-scope lookup must not drift: the loader writes rows
    // using the former, the page looks them up using the latter.
    for (const w of windows) {
      const [scope, selected] = w.key.startsWith("ns:")
        ? ["ns", w.key.slice(3)]
        : [w.key, "2026_04_19"];
      expect({ from: w.from, to: w.to }).toEqual(
        scopeWindowFor(scope, selected, ELECTIONS),
      );
    }
  });

  it("emits unique, deterministic keys", () => {
    const keys = windows.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(allScopeWindows(ELECTIONS, 2026, 2011).map((w) => w.key)).toEqual(
      keys,
    );
  });

  it("never emits an inverted window", () => {
    for (const w of windows)
      if (w.from && w.to) expect(w.from < w.to).toBe(true);
  });
});

describe("newestFirst", () => {
  it("sorts by date descending regardless of input order", () => {
    expect(newestFirst([...ELECTIONS].reverse()).map((e) => e.name)).toEqual(
      ELECTIONS.map((e) => e.name),
    );
  });
});
