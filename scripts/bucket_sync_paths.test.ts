// Guards the bucket-exclusion invariants for the scoped-sync tool (persons-pg-retirement-v1
// T1.5). The exclusion set lives in THREE hand-maintained places — package.json's
// `bucket:sync` and `bucket:sync:dry` -x regexes, and isExcluded() here — so this pins that
// they agree on the retired officials families, that the guard is correctly scoped (spares
// the still-served index.json / declarations), and that a parent-scoped directory sync can't
// re-upload a retired child (FINDING-001).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { isExcluded, childExcludeRegexes } from "./bucket_sync_paths";

const pkg = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    ),
    "utf8",
  ),
).scripts as Record<string, string>;

const RETIRED = [
  "officials/municipal/by_obshtina/",
  "officials/municipal/search_index",
];

describe("bucket exclusion lockstep (package.json ↔ isExcluded)", () => {
  // opencalls/ is PG-served (open_calls, migration 142). The committed
  // data/opencalls/<source>.json is the loader's SOURCE and the archive of what was open
  // when — uploading it would mint a second, staleable copy on a path nothing reads.
  it("excludes opencalls/ in both the -x regexes and isExcluded()", () => {
    expect(pkg["bucket:sync"]).toContain("^opencalls/.*");
    expect(pkg["bucket:sync:dry"]).toContain("^opencalls/.*");
    expect(isExcluded("opencalls")).toBeTruthy();
    expect(isExcluded("opencalls/isun.json")).toBeTruthy();
  });

  // council/ is PG-served (migrations 160/161) — /api/db/council-overview, -muni
  // and -resolution. Every reader moved off the bucket in council-hub-v1 tiers
  // 5-7 (the My-Area tile, the alerts builder, both AI tools). The tree stays on
  // disk and in git as the loader's input; what must not happen is a second
  // copy on a path nothing reads. council/ is TOP-LEVEL, so isExcluded refuses
  // it as a direct argument and no CHILD_EXCLUDES twin is needed — unlike
  // budget/municipal_fiscal, whose parent is still served.
  it("excludes council/ in both the -x regexes and isExcluded()", () => {
    expect(pkg["bucket:sync"]).toContain("^council/.*");
    expect(pkg["bucket:sync:dry"]).toContain("^council/.*");
    expect(isExcluded("council")).toBeTruthy();
    expect(isExcluded("council/index.json")).toBeTruthy();
    expect(
      isExcluded("council/PER32/2026/PER32-2026-prot1-r1.json"),
    ).toBeTruthy();
    expect(isExcluded("council/votes/SOF.json")).toBeTruthy();
  });

  it("both bucket:sync and bucket:sync:dry -x regexes exclude the officials families", () => {
    for (const frag of RETIRED) {
      expect(pkg["bucket:sync"]).toContain(frag);
      expect(pkg["bucket:sync:dry"]).toContain(frag);
    }
  });

  it("the two -x regexes are byte-identical (they must never drift)", () => {
    const xOf = (s: string) => s.match(/-x '([^']*)'/)?.[1];
    expect(xOf(pkg["bucket:sync"])).toBe(xOf(pkg["bucket:sync:dry"]));
  });
});

describe("isExcluded", () => {
  it("refuses the retired families", () => {
    expect(isExcluded("officials/municipal/by_obshtina")).toBeTruthy();
    expect(
      isExcluded("officials/municipal/by_obshtina/BGS04.json"),
    ).toBeTruthy();
    expect(isExcluded("officials/municipal/search_index.json")).toBeTruthy();
  });

  it("spares the still-served / load-source siblings", () => {
    expect(isExcluded("officials/municipal/index.json")).toBeNull();
    expect(isExcluded("officials/municipal/declarations/x.json")).toBeNull();
    expect(isExcluded("officials")).toBeNull();
    expect(isExcluded("officials/municipal")).toBeNull();
  });
});

describe("the retired MP↔company shard families (mp-tr-edges-pg-v1)", () => {
  const RETIRED_SHARDS = [
    "parliament/mp-management",
    "parliament/companies-by-ekatte",
    "parliament/companies-by-obshtina",
  ];

  // THREE places in lockstep, not two. isExcluded guards a top-level argument; CHILD_EXCLUDES
  // guards a scoped `bucket:sync:paths -- parliament` (which still runs, for photos/); the -x
  // regex guards the full `bucket:sync`. Any one missing re-uploads all 1,542 files.
  it("is refused by isExcluded, at the directory and at a file inside it", () => {
    for (const dir of RETIRED_SHARDS) {
      expect(isExcluded(dir)).toBeTruthy();
      expect(isExcluded(`${dir}/anything.json`)).toBeTruthy();
    }
  });

  it("is in the -x regex of BOTH bucket:sync and bucket:sync:dry", () => {
    for (const frag of [
      "mp-management",
      "companies-by-ekatte",
      "companies-by-obshtina",
    ]) {
      expect(pkg["bucket:sync"]).toContain(frag);
      expect(pkg["bucket:sync:dry"]).toContain(frag);
    }
  });

  it("a parliament-scoped dir sync cannot re-upload them", () => {
    const rx = childExcludeRegexes("parliament");
    for (const dir of RETIRED_SHARDS) {
      const child = dir.slice("parliament/".length);
      expect(rx).toContain(`^${child}/.*`);
    }
  });

  // companies-index.json USED to be spared here, as the load source those shards were
  // derived from. It is retired and deleted itself now (Tier 5.2), so the assertions invert
  // — and they must cover all THREE places, exactly as for the shard trees above: a sync
  // that re-uploaded it would leave the bucket holding the last copy of an MP↔company
  // attribution set nothing else in the repo makes any more, with no producer able to
  // correct it and `rsync -x` excluding it from deletion as well as from upload.
  // Same three-place rule, same reason (Tier 6). Its sibling officials/derived/connections.json
  // is NOT retired, so the parent directory is still synced — which is exactly the shape that
  // makes the CHILD_EXCLUDES half load-bearing rather than belt-and-braces.
  describe("the retired officials/derived/company_links.json (Tier 6)", () => {
    const FILE = "officials/derived/company_links.json";

    it("is refused by isExcluded", () => {
      expect(isExcluded(FILE)).toBeTruthy();
    });

    it("spares its sibling, which is still served", () => {
      expect(isExcluded("officials/derived/connections.json")).toBeFalsy();
    });

    it("is in the -x regex of BOTH bucket:sync and bucket:sync:dry", () => {
      expect(pkg["bucket:sync"]).toContain("company_links");
      expect(pkg["bucket:sync:dry"]).toContain("company_links");
    });

    it("an officials-scoped dir sync cannot re-upload it", () => {
      expect(childExcludeRegexes("officials")).toContain(
        "^derived/company_links\\.json$",
      );
    });
  });

  describe("the retired companies-index.json (company-page-consolidation-v1 Tier 5.2)", () => {
    const FILE = "parliament/companies-index.json";

    it("is refused by isExcluded", () => {
      expect(isExcluded(FILE)).toBeTruthy();
    });

    it("is in the -x regex of BOTH bucket:sync and bucket:sync:dry", () => {
      expect(pkg["bucket:sync"]).toContain("companies-index");
      expect(pkg["bucket:sync:dry"]).toContain("companies-index");
    });

    it("a parliament-scoped dir sync cannot re-upload it", () => {
      // A FILE child-exclude, so the regex is the exact path rather than a `/.*` subtree.
      expect(childExcludeRegexes("parliament")).toContain(
        "^companies-index\\.json$",
      );
    });
  });

  it("spares the photos the parent is still synced for", () => {
    expect(isExcluded("parliament/photos/1.webp")).toBeFalsy();
  });
});

describe("isExcluded — parliament PG-served families (T2.1b/T2.3/T2.4)", () => {
  it("refuses the retired parliament shard trees + roster", () => {
    for (const p of [
      "parliament/profiles/2258.json",
      "parliament/index.json",
      "parliament/declarations/5100.json",
      "parliament/mp-assets/5100.json",
      "parliament/avatars.json",
      "parliament/assets-rankings.json",
      "parliament/assets-rankings-top.json",
      "parliament/mp-cars.json",
      "parliament/car-makes.json",
    ])
      expect(isExcluded(p)).toBeTruthy();
  });

  it("spares the .webp photos + still-served parliament siblings", () => {
    expect(isExcluded("parliament/photos/5100.webp")).toBeNull();
    expect(isExcluded("parliament/connections.json")).toBeNull();
    expect(isExcluded("parliament/votes/index.json")).toBeNull();
  });

  it("a parliament-scoped dir sync can't re-upload the retired children", () => {
    const rx = childExcludeRegexes("parliament");
    const hit = (p: string) => rx.some((r) => new RegExp(r).test(p));
    expect(hit("profiles/2258.json")).toBe(true);
    expect(hit("index.json")).toBe(true);
    expect(hit("declarations/5100.json")).toBe(true);
    expect(hit("mp-assets/5100.json")).toBe(true);
    // company-connections/ was refused as a DIRECT argument but had no child
    // exclude, so `bucket:sync:paths -- parliament` (the natural way to push
    // photos/ + votes/) uploaded all ~16.8k per-EIK shards to the bucket. The
    // reader was the AI chat's `companyConnections` tool, NOT the /company/:eik
    // page — an earlier version of this comment said the page, which is the same
    // src/-only grep that made the tree look readerless in the first place.
    //
    // ⚠️ Both this and the direct-argument guard below outlive their producer:
    // `build_company_connections.ts` was deleted 2026-08-16, and the natural
    // inference — „nothing writes the tree, so the guards are dead config" — is
    // backwards. Deleting a builder does not delete 19,232 gitignored files it
    // already wrote; they sit on every machine that ever ran a TR refresh with
    // nothing to refresh or remove them. Drop these guards and the next
    // parliament-scoped sync republishes a dead snapshot.
    expect(hit("company-connections/000014441.json")).toBe(true);
    // …but never the photos that stay on the bucket.
    expect(hit("photos/5100.webp")).toBe(false);
  });

  it("refuses company-connections as a direct argument too", () => {
    expect(isExcluded("parliament/company-connections")).toBeTruthy();
    expect(
      isExcluded("parliament/company-connections/000014441.json"),
    ).toBeTruthy();
  });
});

describe("childExcludeRegexes (FINDING-001: parent-scoped dir sync)", () => {
  const matchesAny = (regexes: string[], relPath: string): boolean =>
    regexes.some((r) => new RegExp(r).test(relPath));

  it("excludes the retired children when the officials parent is synced", () => {
    const rx = childExcludeRegexes("officials/municipal");
    expect(matchesAny(rx, "by_obshtina/BGS04.json")).toBe(true);
    expect(matchesAny(rx, "search_index.json")).toBe(true);
    // …but never the still-served siblings under the same parent.
    expect(matchesAny(rx, "index.json")).toBe(false);
    expect(matchesAny(rx, "declarations/x.json")).toBe(false);
  });

  it("re-anchors relative to a grandparent sync", () => {
    const rx = childExcludeRegexes("officials");
    expect(matchesAny(rx, "municipal/by_obshtina/BGS04.json")).toBe(true);
    expect(matchesAny(rx, "municipal/search_index.json")).toBe(true);
    expect(matchesAny(rx, "municipal/index.json")).toBe(false);
  });

  it("is officials-anchored — never touches the bucket-served parliament search_index", () => {
    // The whole point of not using a blanket `search_index.json` pattern.
    expect(childExcludeRegexes("parliament/votes/derived")).toEqual([]);
    expect(childExcludeRegexes("prices")).toEqual([]);
  });
});

// ── The retired connections artifacts (site-hygiene-v1 T6b) ──────────────────
//
// Eight families with no reader in src/, ai/, scripts/ or functions/, and three
// deliberate NON-members. The non-members are the point of this describe: two
// rounds of this work established a live reader in `ai/` that a grep over the
// other three directories reports as absent, so „retired" here is a claim that
// has been wrong twice and is pinned rather than trusted.
describe("retired connections artifacts", () => {
  const T6B_RETIRED = [
    "parliament/mp-connections/2258.json",
    "parliament/official-connections/abc.json",
    "parliament/by-id/2258.json",
    "parliament/connections-search.json",
    "parliament/connections-top-pairs.json",
    "parliament/connections-stats.json",
    "parliament/connections-party-matrix.json",
    "parliament/company-connections-stats.json",
  ];

  it("is refused by isExcluded, at the directory and at a file inside it", () => {
    for (const rel of T6B_RETIRED) {
      expect(isExcluded(rel), rel).toBeTruthy();
    }
    expect(isExcluded("parliament/mp-connections")).toBeTruthy();
    expect(isExcluded("parliament/official-connections")).toBeTruthy();
    expect(isExcluded("parliament/by-id")).toBeTruthy();
  });

  it("is in the -x regex of BOTH bucket:sync and bucket:sync:dry", () => {
    for (const arm of [
      "mp-connections",
      "official-connections",
      "by-id",
      "connections-search",
      "connections-top-pairs",
      "connections-stats",
      "connections-party-matrix",
      "company-connections-stats",
    ]) {
      expect(pkg["bucket:sync"], `bucket:sync is missing ${arm}`).toContain(
        arm,
      );
      expect(
        pkg["bucket:sync:dry"],
        `bucket:sync:dry is missing ${arm}`,
      ).toContain(arm);
    }
  });

  it("a parliament-scoped dir sync cannot re-upload them", () => {
    // isExcluded guards only a DIRECT argument; the push anyone actually runs is
    // `bucket:sync:paths -- parliament` (needed for photos/ and votes/), which
    // recurses straight past it without the CHILD_EXCLUDES twin. That is the
    // shape that put ~16.8k company-connection shards on the bucket.
    const hit = (child: string) =>
      childExcludeRegexes("parliament").some((re) =>
        new RegExp(re).test(child),
      );
    expect(hit("mp-connections/2258.json")).toBe(true);
    expect(hit("official-connections/abc.json")).toBe(true);
    expect(hit("by-id/2258.json")).toBe(true);
    expect(hit("connections-search.json")).toBe(true);
    expect(hit("connections-top-pairs.json")).toBe(true);
    expect(hit("connections-stats.json")).toBe(true);
    expect(hit("connections-party-matrix.json")).toBe(true);
    expect(hit("company-connections-stats.json")).toBe(true);
  });

  it("SPARES the three that still have readers", () => {
    // ⚠️ THE CLAUSE THAT MATTERS. Each of these was on the retirement list until
    // someone looked in `ai/`:
    //   · connections.json — a PUBLISHED dataset, offered for download on /data
    //     in both languages (scripts/prerender/routes.ts).
    //   · connections-rankings.json / -top.json — fetched by the AI chat's
    //     per-party rollup and mpConnectionsTop tools (ai/tools/people.ts).
    // Excluding any of them breaks a live surface, silently.
    expect(isExcluded("parliament/connections.json")).toBeNull();
    expect(isExcluded("parliament/connections-rankings.json")).toBeNull();
    expect(isExcluded("parliament/connections-rankings-top.json")).toBeNull();
    // …and neither is EXCLUDED BY the -x regexes. ⚠️ Asserted by RUNNING them,
    // not by substring: `not.toContain("|connections)")` was the first cut and
    // is positional — it only sees `connections` as a group's final arm, so
    // moving it anywhere else leaves the suite green while the published
    // dataset stops syncing. Same class as asserting an arm is PRESENT by
    // substring, which cannot tell the directory group from the .json group.
    const xArg = (cmd: string) => {
      const m = /rsync[^']*'([^']+)'/.exec(cmd);
      if (!m) throw new Error("could not read the -x regex out of: " + cmd);
      return new RegExp(m[1]);
    };
    for (const cmd of [pkg["bucket:sync"], pkg["bucket:sync:dry"]]) {
      const re = xArg(cmd);
      for (const rel of [
        "parliament/connections.json",
        "parliament/connections-rankings.json",
        "parliament/connections-rankings-top.json",
      ]) {
        expect(
          re.test(rel),
          `${rel} has a live reader and must NOT be excluded from sync`,
        ).toBe(false);
      }
      // …and the retired ones ARE matched, by the same executed regex — so an
      // arm moved into the wrong group fails here rather than passing on a
      // substring.
      for (const rel of [
        "parliament/mp-connections/2258.json",
        "parliament/official-connections/abc.json",
        "parliament/by-id/2258.json",
        "parliament/connections-search.json",
        "parliament/connections-top-pairs.json",
        "parliament/connections-stats.json",
        "parliament/connections-party-matrix.json",
        "parliament/company-connections-stats.json",
      ]) {
        expect(re.test(rel), `${rel} is retired and must be excluded`).toBe(
          true,
        );
      }
    }
  });
});
