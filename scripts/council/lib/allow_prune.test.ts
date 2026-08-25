// The `--allow-prune` argv parser.
//
// NOTE the import is `./lib/allow_prune`, NOT `./rebuild_shards`: that file
// calls `main()` at module scope, so importing it would run a real repair
// against data/council/ as a side effect of loading the test.
//
// It is tested apart from the repair tool because its one non-obvious rule is
// a SAFETY rule: `--allow-prune=` with nothing after the `=` must be the EMPTY
// set, never the bare flag. A shell that ate the value (an unset variable, a
// mistyped expansion) would otherwise silently widen a scoped override to the
// whole corpus — disarming the prune ceiling for all sixteen municipalities
// when the operator asked for one.

import { describe, expect, it } from "vitest";
import { parseAllowPrune } from "./allow_prune";

describe("parseAllowPrune", () => {
  it("is off by default", () => {
    expect(parseAllowPrune(["node", "rebuild_shards.ts"])).toBe(false);
    expect(parseAllowPrune(["--allow-shrink"])).toBe(false);
  });

  it("treats the bare flag as corpus-wide", () => {
    expect(parseAllowPrune(["--allow-prune"])).toBe(true);
    expect(parseAllowPrune(["--allow-shrink", "--allow-prune"])).toBe(true);
  });

  it("scopes to the named municipalities", () => {
    expect(parseAllowPrune(["--allow-prune=RSE01"])).toEqual(
      new Set(["RSE01"]),
    );
    expect(parseAllowPrune(["--allow-prune=RSE01,PVN01,VAR01"])).toEqual(
      new Set(["RSE01", "PVN01", "VAR01"]),
    );
    // Tolerate the spacing a copy-paste leaves behind.
    expect(parseAllowPrune(["--allow-prune=RSE01, PVN01"])).toEqual(
      new Set(["RSE01", "PVN01"]),
    );
  });

  it("an empty value is the EMPTY SET, not the bare flag", () => {
    // The safety rule. `--allow-prune=$CODES` with CODES unset must permit
    // NOTHING, so the ceiling still refuses and the operator sees why —
    // rather than silently overriding every município in the run.
    expect(parseAllowPrune(["--allow-prune="])).toEqual(new Set());
    expect(parseAllowPrune(["--allow-prune=,"])).toEqual(new Set());
    expect(parseAllowPrune(["--allow-prune=  "])).toEqual(new Set());
  });

  it("does not match a longer flag that merely starts the same way", () => {
    expect(parseAllowPrune(["--allow-pruning"])).toBe(false);
  });
});
