// The drift gates for reportsMatrix.ts.
//
// `REPORT_TYPE_GRAINS` is the enumeration three other places must agree with,
// and each disagreement fails differently and silently:
//   • `routes.tsx` has a page the matrix lacks  → that page loses its grain
//     switcher and goes back to being unlinked;
//   • the matrix has a page `routes.tsx` lacks  → the switcher links a 404;
//   • the prerender copy map falls behind       → the page ships as an empty
//     SPA shell with no static HTML (this ALREADY happened: /reports/*/
//     wasted-votes were routed and linked for months with neither prerendered
//     HTML nor a sitemap entry, because the prerender list was hand-kept);
//   • the sitemap falls behind                  → the page is never submitted.
//
// None of that shows up in a type check, so all four are asserted here.
//
// Precedent: scripts/db/tests/procurement_payloads.data.test.ts does the same
// thing for SCOPED_MATVIEWS — declare the contract in data, gate it in a test.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  everyReportPage,
  hasGrainNav,
  REPORT_DATA_FILE,
  REPORT_GRAINS,
  REPORT_GRAIN_LABEL_KEY,
  REPORT_TYPE_GRAINS,
  parseReportPath,
  type ReportGrain,
} from "./reportsMatrix";
import { REPORT_CLUSTERS } from "../hub/reportsHubRegistry";

const repoFile = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../../..", rel), "utf8");

/** Walk routes.tsx and collect every `/reports/<grain>/<type>` leaf it declares.
 *
 *  PRECONDITION: every `</Route>` in the file is matched by a
 *  `<Route path="x">` opener written on ONE line. routes.tsx satisfies this
 *  exactly (5 openers, 5 closers — asserted below). A pathless block route
 *  (`<Route element={<Layout/>}>…</Route>`) would pop a frame this parser never
 *  pushed and silently mis-scope every subsequent leaf, so the balance check is
 *  part of the gate rather than a comment. */
const routedReports = (): Set<string> => {
  const src = repoFile("src/routes.tsx");
  const stack: string[] = [];
  const found = new Set<string>();
  for (const line of src.split("\n")) {
    if (/^\s*<\/Route>/.test(line)) {
      stack.pop();
      continue;
    }
    const parent = line.match(/^\s*<Route\s+path="([^"]+)"\s*>\s*$/);
    if (parent) {
      stack.push(parent[1]);
      continue;
    }
    const leaf = line.match(/^\s*path="([^"]+)"/);
    if (!leaf) continue;
    const type = leaf[1];
    if (stack[0] !== "reports" || !stack[1] || type.includes(":")) continue;
    found.add(`${stack[1]}/${type}`);
  }
  return found;
};

const matrixPages = (): Set<string> =>
  new Set(everyReportPage().map(({ grain, type }) => `${grain}/${type}`));

describe("the anomaly-report (type × grain) matrix", () => {
  test("routes.tsx nesting is balanced (the parser's precondition)", () => {
    const src = repoFile("src/routes.tsx");
    const openers = src.match(/^\s*<Route\s+path="[^"]*"\s*>\s*$/gm) ?? [];
    const closers = src.match(/^\s*<\/Route>/gm) ?? [];
    assert.equal(
      openers.length,
      closers.length,
      "routes.tsx has a block <Route> without a single-line path opener — the report parser below would mis-scope every leaf after it",
    );
  });

  test("the parser still matches routes.tsx", () => {
    // Two-sided: a total parser failure reads as zero, but a MIS-SCOPE reads as
    // a plausible-looking larger number, which a `>= 40` floor alone would pass.
    const n = routedReports().size;
    assert.ok(
      n >= 40 && n <= 45,
      `expected ~41 routed report pages, parsed ${n} — the routes.tsx parser has drifted`,
    );
  });

  test("every routed report page is in the matrix", () => {
    const pages = matrixPages();
    const missing = [...routedReports()].filter((p) => !pages.has(p));
    assert.deepEqual(
      missing,
      [],
      `routes.tsx declares report page(s) absent from REPORT_TYPE_GRAINS — they get no grain switcher and stay unlinked: ${missing.join(", ")}`,
    );
  });

  test("every matrix entry is a routed report page", () => {
    const routed = routedReports();
    const extra = [...matrixPages()].filter((p) => !routed.has(p));
    assert.deepEqual(
      extra,
      [],
      `REPORT_TYPE_GRAINS names page(s) with no <Route> — the grain switcher would link to a 404: ${extra.join(", ")}`,
    );
  });

  test("every grain has a label key", () => {
    for (const grain of REPORT_GRAINS)
      assert.equal(
        typeof REPORT_GRAIN_LABEL_KEY[grain],
        "string",
        `no label key for grain '${grain}'`,
      );
  });

  test("every report type has a data-file name", () => {
    for (const type of Object.keys(REPORT_TYPE_GRAINS))
      assert.equal(
        typeof REPORT_DATA_FILE[type as keyof typeof REPORT_DATA_FILE],
        "string",
        `no REPORT_DATA_FILE entry for '${type}' — the sitemap gate cannot check it`,
      );
  });

  // ── the three downstream consumers ────────────────────────────────────────

  test("every matrix page has prerender copy", () => {
    // The prerender builder ENUMERATES from the matrix, so a page can no longer
    // be missing outright — but a type with no copy entry throws at build time,
    // hours into a 57k-route run. Fail here instead.
    const src = repoFile("scripts/prerender/dynamicRoutes.ts");
    const slugs = new Set(
      [...src.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    const missing = Object.keys(REPORT_TYPE_GRAINS).filter(
      (t) => !slugs.has(t),
    );
    assert.deepEqual(
      missing,
      [],
      `report type(s) with no prerender copy — buildReportRoutes throws on them: ${missing.join(", ")}`,
    );
  });

  test("every matrix page is in the sitemap", () => {
    const src = repoFile("scripts/sitemap/route_defs.ts");
    const present = new Set(
      [...src.matchAll(/reports\/(\w+)\/([\w.]+)\.json/g)].map(
        (m) => `${m[1]}/${m[2]}`,
      ),
    );
    const missing = everyReportPage()
      .map(({ grain, type }) => ({
        page: `${grain}/${type}`,
        key: `${grain}/${REPORT_DATA_FILE[type]}`,
      }))
      // problem_sections is keyed on a stats file outside the reports tree.
      .filter(({ page }) => page !== "section/problem_sections")
      .filter(({ key }) => !present.has(key))
      .map(({ page }) => page);
    assert.deepEqual(
      missing,
      [],
      `report page(s) absent from the sitemap — never submitted for indexing: ${missing.join(", ")}`,
    );
  });

  test("every report type has at least one entry point", () => {
    // The invariant this whole module exists to protect. ReportGrainNav only
    // offers sibling GRAINS, so a type whose every grain is unlinked stays
    // unreachable however good the switcher is — it needs a hub tile.
    const hubLinked = new Set(
      REPORT_CLUSTERS.flatMap((c) => c.reports).flatMap(
        (r) => r.to.match(/^\/reports\/\w+\/(.+)$/)?.[1] ?? [],
      ),
    );
    // Linked from a screen rather than the hub: WastedVoteScreen.tsx links all
    // three grains directly.
    const externallyLinked = new Set(["wasted-votes"]);
    const orphans = Object.keys(REPORT_TYPE_GRAINS).filter(
      (t) => !hubLinked.has(t) && !externallyLinked.has(t),
    );
    assert.deepEqual(
      orphans,
      [],
      `report type(s) with no entry point anywhere in the UI: ${orphans.join(", ")}`,
    );
  });

  describe("parseReportPath", () => {
    test("accepts a report leaf", () => {
      assert.deepEqual(parseReportPath("/reports/section/turnout"), {
        grain: "section" as ReportGrain,
        type: "turnout",
      });
    });

    test("rejects a grain the report does not exist at", () => {
      assert.equal(
        parseReportPath("/reports/settlement/problem_sections"),
        null,
      );
    });

    test("rejects an unknown report type", () => {
      assert.equal(parseReportPath("/reports/section/not_a_report"), null);
    });

    test("rejects the problem-section detail pages", () => {
      assert.equal(
        parseReportPath("/reports/section/problem_sections/sofia-fakulteta"),
        null,
      );
    });

    test("rejects non-report paths", () => {
      assert.equal(parseReportPath("/procurement/contracts"), null);
      assert.equal(parseReportPath("/reports"), null);
    });
  });

  describe("hasGrainNav", () => {
    test("is true for a multi-grain report leaf", () => {
      assert.equal(hasGrainNav("/reports/section/turnout"), true);
    });

    test("is false for a single-grain report", () => {
      assert.equal(hasGrainNav("/reports/section/problem_sections"), false);
      assert.equal(hasGrainNav("/reports/section/recount_zero_votes"), false);
    });

    test("is false off the report tree", () => {
      assert.equal(hasGrainNav("/risk-score"), false);
    });
  });
});
