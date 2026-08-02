// S5 guard — the verified-private noindex + name-match caveat on the canonical /person page.
//
// PersonDashboard renders for BOTH public figures and S4 verified private owners (082 serves
// both). Two things must key on the SAME condition — is_public_figure=false — and get it exactly
// right, because an INVERSION is invisible to a render smoke test (it still renders) and to the
// hook's own unit test (useNoindex.test.ts covers the hook, not the wiring):
//   • useNoindex(p.isPublicFigure === false) — noindex the thin, name-only-identity private page,
//     NOT the public one. `=== false` (not `!`) is fail-OPEN: an undefined field (a serving 082
//     predating the key) must NOT noindex every person.
//   • the name-match caveat card, gated on the same `p.isPublicFigure === false`.
//
// Asserted against source (a regex) rather than a full render: mounting PersonDashboard pulls in
// ~15 fetching child tiles, and the failure this guards — a flipped boolean — is a one-token edit
// a source assertion catches deterministically.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SRC = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "PersonProfileScreen.tsx",
  ),
  "utf8",
);

describe("PersonDashboard noindex + name-match caveat (S5)", () => {
  it("noindexes verified privates fail-open (=== false, never `!`)", () => {
    expect(SRC).toMatch(/useNoindex\(p\.isPublicFigure === false\)/);
    // The bare-negation form would noindex every page when the field is undefined.
    expect(SRC).not.toMatch(/useNoindex\(!p\.isPublicFigure\)/);
    // And it must not accidentally target the PUBLIC figures.
    expect(SRC).not.toMatch(/useNoindex\(p\.isPublicFigure\)/);
  });

  it("gates the name-match caveat on the same private condition", () => {
    expect(SRC).toMatch(/p\.isPublicFigure === false && \(/);
  });
});
