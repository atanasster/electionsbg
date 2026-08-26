// The UI's second-degree row cap and the route's must be the same number, and nothing else
// checks that they are.
//
// `PersonConnectionCheck` mirrors `BRIDGE_LIMIT` from `functions/db_routes.js` for one reason:
// at exactly that many rows the list MAY be truncated and has to say „Показани са първите N".
// The two live in different packages — `functions/` is a separate CommonJS package, so a
// shared import is not available — and the component's own test suite imports the component's
// copy, which makes it structurally incapable of seeing drift.
//
// Both directions are a defect and neither raises anything:
//   route raised to 50  → the UI renders 50 rows under „Показани са първите 25", a false
//                         statement about what the reader is looking at;
//   route lowered to 10 → `rows.length >= 25` never fires, so a truncated list renders as
//                         exhaustive — the exact failure the disclosure exists to prevent.
//
// This is the pattern the repo already uses for acknowledged cross-package twins that cannot
// import each other (firebase_person_rewrite.test.ts reads firebase.json the same way).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// ⚠️ NOT `fileURLToPath(import.meta.url)`. This file is collected by the `src/**` project,
// which runs under the browser runner where `import.meta.url` is an http URL — the call
// throws „The URL must be of scheme file" and the suite fails to collect at all. REPO_ROOT is
// how `src/entryGraph.test.ts`, the other static-analysis gate living under src/, resolves
// paths for exactly this reason.
import { REPO_ROOT } from "@/../scripts/lib/module_graph";
import { BRIDGE_LIMIT } from "./PersonConnectionCheck";

const ROUTE = path.join(REPO_ROOT, "functions", "db_routes.js");

describe("BRIDGE_LIMIT — the UI's cap and the route's", () => {
  it("agree, because a mirrored constant with no gate is not mirrored", () => {
    const src = readFileSync(ROUTE, "utf8");
    const m = src.match(/^const BRIDGE_LIMIT = (\d+);/m);
    expect(
      m,
      "BRIDGE_LIMIT has gone from functions/db_routes.js — the UI's copy has lost the source it mirrors, and its truncation notice now describes nothing",
    ).toBeTruthy();
    expect(Number(m![1])).toBe(BRIDGE_LIMIT);
  });

  it("the route actually PASSES it, rather than leaving the SQL default to decide", () => {
    // The clamp in 192 defaults to 25 on a NULL p_limit, so a route that stopped passing the
    // argument would still return 25 rows today — and would silently stop agreeing the moment
    // either number moved. The mirror is only meaningful if the route is what sets the cap.
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toMatch(/person_person_bridge\(\$1, \$2, \$3\)/);
    expect(src).toMatch(/BRIDGE_LIMIT,/);
  });
});
