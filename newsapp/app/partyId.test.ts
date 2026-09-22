import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PARTY_ID_SAFE, isPartyId } from "./partyId";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the party id charset", () => {
  it("admits what the build mints and refuses what reaches a path", () => {
    for (const ok of ["gerb", "p_20", "bsp-obedinena", "A1"])
      expect(isPartyId(ok)).toBe(true);
    // ⚠️ An id reaches BOTH a route and a file path.
    for (const bad of ["", "../etc", "a/b", "пп", "x".repeat(81), null, 7])
      expect(isPartyId(bad as unknown)).toBe(false);
  });

  it("is the same charset the Python writer enforces", () => {
    // ⚠️ THE MUTATION THIS CATCHES: the two sides drifting, so the build
    // writes `party/<id>.json` for an id the client refuses to link (a page
    // that exists and is unreachable) or the reverse (a dead link).
    const py = readFileSync(
      join(HERE, "..", "..", "news", "scripts", "build_app_data.py"),
      "utf-8",
    );
    const match = py.match(/PARTY_ID_SAFE = re\.compile\(r"(.+?)"\)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(PARTY_ID_SAFE.source);
  });
});
