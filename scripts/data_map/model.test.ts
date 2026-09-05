// Invariants over the data-map model and the committed manifest.
//
// Until 2026-08-31 there was no test here at all, and the gap was not
// theoretical: `["src:keep_eu", "ds:funds"]` asserted for months that the
// Interreg corpus is part of ИСУН — a merge the serving layer exists to
// prevent — and `validate()` accepted it, because it is tier-valid
// (src: → ds:) and validate() only checks tiers. The correction lived in a
// comment, which is exactly what a comment cannot enforce.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  TOURS,
  DATASETS,
  EDGES,
  SOURCE_GROUPS,
  FEATURES,
  UNCLAIMED,
  LINKS,
} from "./model";
import type { DatasetDef } from "./model";
import { validateDatasetServing, validateLinks } from "./build_manifest";
import { assertCommitted } from "../lib/assert_committed";

const ROOT = path.resolve(import.meta.dirname, "../..");

// BEFORE the module-scope parse below, deliberately. `data/data_map.json` is committed and
// CI does a full checkout, so its absence is a broken working copy — but a bare
// `readFileSync` at module scope throws during COLLECTION, which vitest reports as a suite
// error naming no fix. Registering the assertion first turns that into one named failing
// test that says `git checkout -- data/data_map.json`.
assertCommitted("data/data_map.json");

const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
) as {
  nodes: { id: string; kind: string }[];
  edges: { id: string; from: string; to: string }[];
  links?: {
    a: string;
    b: string;
    kind: string;
    key?: string;
    overlap?: number;
  }[];
};

const pair = (e: { from: string; to: string }) => `${e.from} -> ${e.to}`;
const manifestPairs = new Set(manifest.edges.map(pair));

describe("data-map model", () => {
  it("keeps Interreg a separate dataset from ИСУН EU funds", () => {
    // The two corpora are disjoint by construction: Interreg is managed on
    // Jems, fund_projects holds zero Interreg rows, and the totals measure
    // different things (a contract's own value vs one partner's budget). An
    // edge into ds:funds claims a merge that funds_fit_basis() ships a basis
    // declaration to prevent.
    const keepEu = EDGES.filter(([from]) => from === "src:keep_eu");
    expect(keepEu).toEqual([["src:keep_eu", "ds:interreg"]]);
    expect(DATASETS.map((d) => d.id)).toContain("interreg");
  });

  it("gives every dataset node a source and at least one consumer", () => {
    // A dataset with no incoming edge has no provenance; one with no outgoing
    // edge renders as an orphan and tells a reader nothing uses it. ds:interreg
    // was briefly the latter, between being added and its consumers being
    // traced.
    //
    // Consumers are counted from the BUILT manifest, not from EDGES: a dataset
    // whose only reader is the AI assistant (ds:security, ds:transport today)
    // reaches f:ai through an edge the build derives from AI_PATH_RULES, and it
    // is legitimately consumed. Asserting on EDGES alone would call those two
    // orphans and force a hand-written duplicate of a derived edge.
    const ins = new Set(manifest.edges.map((e) => e.to));
    const outs = new Set(manifest.edges.map((e) => e.from));
    const missing = DATASETS.flatMap((d) => {
      const id = `ds:${d.id}`;
      return [
        ...(ins.has(id) ? [] : [`${id} has no source edge`]),
        ...(outs.has(id) ? [] : [`${id} has no consumer edge`]),
      ];
    });
    expect(missing).toEqual([]);
  });

  it("declares no edge twice and no edge to an unknown node", () => {
    const known = new Set([
      ...SOURCE_GROUPS.map((g) => `src:${g.id}`),
      ...DATASETS.map((d) => `ds:${d.id}`),
      ...FEATURES.map((f) => `f:${f.id}`),
    ]);
    const unknown = EDGES.flatMap(([from, to]) =>
      [from, to].filter((n) => !known.has(n)),
    );
    expect(unknown).toEqual([]);

    const seen = new Set<string>();
    const dupes = EDGES.filter(([from, to]) => {
      const k = `${from} -> ${to}`;
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
    expect(dupes).toEqual([]);
  });
});

describe("SOURCE_GROUPS[].url", () => {
  it("is a well-formed absolute URL", () => {
    // /data/sources renders `new URL(node.url)` for every tile with no
    // ErrorBoundary anywhere in src/ — a bare domain, a relative path, or a
    // typo'd scheme would throw during render and blank all 46 tiles at
    // once. Catch it here, at the layer this repo's own DDL/model validation
    // already lives (build_manifest.ts's `fail(...)` checks), rather than at
    // every render site.
    const malformed = SOURCE_GROUPS.filter((g) => {
      try {
        new URL(g.url);
        return false;
      } catch {
        return true;
      }
    }).map((g) => g.id);
    expect(malformed).toEqual([]);
  });
});

describe("SOURCE_GROUPS[].issue", () => {
  it("has non-empty bilingual label and note wherever present", () => {
    const empty = SOURCE_GROUPS.flatMap((g) => {
      if (!g.issue) return [];
      return (["label", "note"] as const).flatMap((field) =>
        (["bg", "en"] as const)
          .filter((lang) => !g.issue![field][lang].trim())
          .map((lang) => `${g.id}.issue.${field}.${lang}`),
      );
    });
    expect(empty).toEqual([]);
  });

  it("keeps the label short enough to read as a chip caption", () => {
    const TOO_LONG = 30;
    const offenders = SOURCE_GROUPS.filter(
      (g) =>
        g.issue &&
        (g.issue.label.bg.length > TOO_LONG ||
          g.issue.label.en.length > TOO_LONG),
    ).map((g) => g.id);
    expect(offenders).toEqual([]);
  });
});

describe("committed manifest", () => {
  // data/data_map.json is committed AND regenerated by `prebuild`, so a commit
  // that edits model.ts without running `npm run data:map` ships a stale
  // artifact to the bucket while every local build silently rewrites it — the
  // drift then surfaces as churn in an unrelated diff instead of as a failure.
  it("contains every model-declared edge", () => {
    const missing = EDGES.map(([from, to]) => `${from} -> ${to}`).filter(
      (k) => !manifestPairs.has(k),
    );
    expect(missing).toEqual([]);
  });

  it("contains every model-declared node, and no unknown one", () => {
    const declared = new Set([
      ...SOURCE_GROUPS.map((g) => `src:${g.id}`),
      ...DATASETS.map((d) => `ds:${d.id}`),
      ...FEATURES.map((f) => `f:${f.id}`),
    ]);
    const built = new Set(manifest.nodes.map((n) => n.id));
    expect([...declared].filter((d) => !built.has(d))).toEqual([]);
    // f:ai is synthesised by the build rather than declared in FEATURES.
    expect([...built].filter((b) => !declared.has(b) && b !== "f:ai")).toEqual(
      [],
    );
  });

  it("carries no lateral dataset->dataset edge in the lineage array", () => {
    // Lateral links (plan T1) ride a separate `links` array and are never ELK
    // inputs; a ds:->ds: edge here would shatter the dataset tier's layout.
    const lateral = manifest.edges.filter(
      (e) => e.from.startsWith("ds:") && e.to.startsWith("ds:"),
    );
    expect(lateral).toEqual([]);
  });
});

describe("dataset serving contract", () => {
  // Rules 1-4 of plan §1b.2. `serving` exists because `path` used to mean three
  // incompatible things at once, and three nodes advertised data/ trees that
  // bucket sync deliberately never uploads.
  const base = {
    label: { bg: "x", en: "x" },
    detail: { bg: "x", en: "x" },
    desc: { bg: "x", en: "x" },
    tags: ["fiscal"],
  };
  const check = (d: Partial<DatasetDef>): string | null => {
    let msg: string | null = null;
    validateDatasetServing([{ id: "t", ...base, ...d } as DatasetDef], (m) => {
      msg = m;
      throw new Error(m);
    });
    return msg;
  };
  const err = (d: Partial<DatasetDef>): string => {
    try {
      check(d);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected a validation failure, got none");
  };

  it("accepts the real model", () => {
    expect(() => validateDatasetServing()).not.toThrow();
  });

  it("rule 1 — bucket needs a path and may not own relations", () => {
    expect(err({ serving: "bucket" })).toMatch(/requires a path/);
    expect(
      err({ serving: "bucket", path: "data/x/", tables: ["contracts"] }),
    ).toMatch(/must not declare tables/);
  });

  it("rule 2 — pg needs tables and may not advertise a path", () => {
    expect(err({ serving: "pg" })).toMatch(/requires tables\[\]/);
    expect(
      err({ serving: "pg", path: "data/funds/", tables: ["fund_projects"] }),
    ).toMatch(/must not carry a path/);
  });

  it("rule 3 — both may not name a bucket-excluded path", () => {
    // data/funds/ IS excluded (it is a Cloud SQL load source), so declaring it
    // as served is the exact error this rule exists to catch.
    expect(
      err({ serving: "both", path: "data/funds/", tables: ["fund_projects"] }),
    ).toMatch(/bucket sync excludes it/);
    // a genuinely served tree is fine
    expect(() =>
      check({ serving: "both", path: "data/water/", tables: ["contracts"] }),
    ).not.toThrow();
  });

  it("rule 4 — a relation is owned by exactly one dataset", () => {
    let msg = "";
    expect(() =>
      validateDatasetServing(
        [
          { id: "a", ...base, serving: "pg", tables: ["contracts"] },
          { id: "b", ...base, serving: "pg", tables: ["contracts"] },
        ] as DatasetDef[],
        (m) => {
          msg = m;
          throw new Error(m);
        },
      ),
    ).toThrow();
    expect(msg).toMatch(/claimed by two datasets/);
  });

  it("every pg/both dataset names only real, non-duplicated relations", () => {
    const seen = new Set<string>();
    for (const d of DATASETS) {
      if (d.serving === "bucket") continue;
      for (const t of d.tables ?? []) {
        expect(seen.has(t), `${t} claimed twice`).toBe(false);
        seen.add(t);
      }
    }
    // 218 relations are claimed today. A floor of 40 would let four fifths of
    // the triage be deleted silently; this tracks the real number loosely
    // enough to survive an ordinary corpus change.
    expect(seen.size).toBeGreaterThan(200);
  });
});

describe("build_manifest is import-safe", () => {
  // model.test.ts imports validateDatasetServing from build_manifest.ts. Before
  // the entry-point guard, that import ran main() — laying out the graph and
  // writing data/data_map.json — so `npm run test:unit` silently repaired a
  // stale committed manifest mid-run: the drift test above would fail once and
  // pass on re-run, with the artifact quietly modified. Measured: a manifest
  // doctored down to 174 edges came back as 178 after one test run.
  //
  // A static check, because the failure is an import side effect: by the time a
  // runtime assertion could observe it, the write has already happened.
  it("only builds when run as a script", () => {
    const src = readFileSync(
      path.join(ROOT, "scripts/data_map/build_manifest.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /if \(import\.meta\.url === pathToFileURL\(process\.argv\[1\][^)]*\)\.href\) \{\s*\n\s*main\(\)/,
    );
    // and nowhere an unguarded top-level call
    expect(src).not.toMatch(/^main\(\)/m);
  });

  it("leaves the committed manifest untouched when imported", () => {
    // The import at the top of this file has already happened; if the guard
    // regressed, the manifest on disk would differ from what we read at module
    // scope.
    const now = JSON.parse(
      readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
    ) as { edges: unknown[] };
    expect(now.edges.length).toBe(manifest.edges.length);
  });
});

describe("relation coverage (rule 5)", () => {
  // The gate itself needs Postgres and runs in build_manifest.ts. These assert
  // the parts that hold without a database.
  it("never both claims and excuses the same relation", () => {
    const claimed = new Set(DATASETS.flatMap((d) => d.tables ?? []));
    const both = Object.keys(UNCLAIMED).filter((r) => claimed.has(r));
    expect(both).toEqual([]);
  });

  it("gives every unclaimed relation a real reason", () => {
    // "" or "todo" would turn the escape hatch into a silent allow-list.
    const weak = Object.entries(UNCLAIMED).filter(
      ([, why]) =>
        why.trim().length < 12 || /^(todo|tbd|n\/a)$/i.test(why.trim()),
    );
    expect(weak).toEqual([]);
  });

  it("keeps the health corpus on the map", () => {
    // ds:health did not exist until the coverage gate found 15 НЗОК relations
    // owned by nobody — its watchers sat in the 23-source src:ministries group,
    // whose dataset edges are Pensions, Budget, Municipal fiscal, Macro and
    // Local government. Regressing it would re-hide the whole health pack.
    const health = DATASETS.find((d) => d.id === "health");
    expect(health).toBeDefined();
    expect(health!.tables ?? []).toContain("nzok_hospital_payments");
    expect(
      EDGES.filter(([from]) => from === "ds:health").length,
    ).toBeGreaterThan(0);
  });
});

describe("dataset paths name trees that exist", () => {
  // Both prior exceptions to the data/ rule pointed at nothing: `ls public/20*`
  // is empty and the repo holds zero .geojson files, while the readers fetch
  // /maps/regions/{code}.json and /{election}/sections/…. DataMapPanel renders
  // `path` to readers, so a dead path is a visible false statement.
  it("every declared path is under data/ and resolves on disk", () => {
    const missing = DATASETS.filter((d) => d.path).flatMap((d) => {
      const p = d.path!;
      if (!p.startsWith("data/")) return [`${d.id}: ${p} is not under data/`];
      // Resolve the part above any {template} segment.
      const base = p.replace(/\{[^}]*\}.*$/, "").replace(/\/$/, "");
      if (!base || base === "data") return [];
      return existsSync(path.join(ROOT, base))
        ? []
        : [`${d.id}: ${p} does not exist`];
    });
    expect(missing).toEqual([]);
  });
});

describe("lateral links", () => {
  const manifestLinks: {
    a: string;
    b: string;
    kind: string;
    key?: string;
    overlap?: number;
  }[] = manifest.links ?? [];

  it("stores every pair sorted, once", () => {
    // Sorted endpoints are what stop the same pair being declared twice in
    // opposite directions and rendering as two edges.
    const seen = new Set<string>();
    for (const l of LINKS) {
      expect(l.a < l.b, `${l.a} ↔ ${l.b} is not sorted`).toBe(true);
      const k = `${l.a}|${l.b}|${l.key ?? "boundary"}`;
      expect(seen.has(k), `duplicate ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("keeps boundary links keyless", () => {
    // ds:interreg ↔ ds:funds is real and is NOT a join: Jems and ИСУН share no
    // rows. Giving it a key — or an overlap of 0 — would state the opposite of
    // what the link means.
    const boundary = LINKS.filter((l) => l.kind === "boundary");
    expect(boundary.length).toBeGreaterThan(0);
    for (const l of boundary) {
      expect(l.key).toBeUndefined();
      expect(l.measure).toBeUndefined();
    }
  });

  it("names only datasets that exist", () => {
    const ids = new Set(DATASETS.map((d) => d.id));
    const unknown = LINKS.flatMap((l) => [l.a, l.b].filter((x) => !ids.has(x)));
    expect(unknown).toEqual([]);
  });

  it("reaches the manifest with a measured overlap", () => {
    expect(manifestLinks.length).toBe(LINKS.length);
    const joins = manifestLinks.filter((l) => l.kind === "join");
    const unmeasured = joins.filter((l) => typeof l.overlap !== "number");
    expect(unmeasured).toEqual([]);
    // Every measured overlap is non-zero: the build fails on either zero, and
    // a link silently carrying 0 would render as "these datasets share
    // nothing" about a join we declared on purpose.
    expect(joins.filter((l) => (l.overlap ?? 0) <= 0)).toEqual([]);
  });

  it("keeps enough links to be a corpus map", () => {
    // Without a floor, 16 of the 17 joins could be deleted and every other
    // assertion here would still pass.
    expect(LINKS.filter((l) => l.kind !== "boundary").length).toBeGreaterThan(
      14,
    );
    expect(new Set(LINKS.map((l) => l.key)).size).toBeGreaterThan(3);
  });

  it("has an overlap on every committed join link", () => {
    // The no-database build carries values forward from this file. If that path
    // ever regresses, the committed manifest ships with them stripped — and
    // bucket:sync publishes it. This is what would catch that.
    const joins = manifestLinks.filter((l) => l.kind === "join");
    expect(joins.filter((l) => typeof l.overlap !== "number")).toEqual([]);
  });

  it("scopes any link into person_role", () => {
    // Unscoped, person_role holds a row per candidate and per declarant, so the
    // join measures "does this person exist" and returns exactly 100%. The map
    // would have published "29,711 candidates also hold company roles" — a true
    // count and a false sentence. Truth, scoped to registry roles: 7,340.
    const unscoped = LINKS.filter(
      (l) =>
        l.measure?.right?.startsWith("person_role.") && !l.measure.rightWhere,
    ).map((l) => `${l.a} ↔ ${l.b}`);
    expect(unscoped).toEqual([]);
  });

  it("never lets a lateral link into the ELK edge list", () => {
    // The layout reason: 15 of these in the layout graph split the dataset
    // tier into five columns and double the width.
    const lateralPairs = new Set(LINKS.map((l) => `ds:${l.a}|ds:${l.b}`));
    const leaked = manifest.edges.filter(
      (e) =>
        lateralPairs.has(`${e.from}|${e.to}`) ||
        lateralPairs.has(`${e.to}|${e.from}`),
    );
    expect(leaked).toEqual([]);
  });
});

describe("validateLinks", () => {
  // Its five arms had no test at all; each is pinned by the shape it rejects.
  const base = { note: { bg: "x", en: "x" } };
  const err = (link: Record<string, unknown>): string => {
    try {
      validateLinks([{ ...base, ...link } as never], (m: string) => {
        throw new Error(m);
      });
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected a validation failure, got none");
  };

  it("accepts the real link set", () => {
    expect(() => validateLinks()).not.toThrow();
  });

  it("rejects an unknown dataset", () => {
    expect(err({ a: "aaa", b: "zzz", key: "eik" })).toMatch(/unknown dataset/);
  });

  it("rejects an unsorted pair", () => {
    // Sorted endpoints are what stop one relationship being declared twice in
    // opposite directions and drawn as two links.
    expect(err({ a: "procurement", b: "funds", key: "eik" })).toMatch(
      /must be sorted/,
    );
  });

  it("rejects a self-link", () => {
    expect(err({ a: "funds", b: "funds", key: "eik" })).toMatch(/self-link/);
  });

  it("rejects a join with no key", () => {
    expect(err({ a: "funds", b: "procurement" })).toMatch(/needs a key/);
  });

  it("rejects a boundary that carries a key or a measure", () => {
    expect(
      err({ a: "funds", b: "interreg", kind: "boundary", key: "eik" }),
    ).toMatch(/must not declare a key/);
    expect(
      err({
        a: "funds",
        b: "interreg",
        kind: "boundary",
        measure: { left: "x.y", right: "z.w" },
      }),
    ).toMatch(/must not be measured/);
  });
});

describe("the lateral-links tour", () => {
  // Its prose quotes MEASURED overlaps. A corpus reload moves those, and
  // because a tour step drives the panel selection, the frozen number would
  // render on the same screen as the live one.
  const tour = TOURS.find((t) => t.id === "linked");
  const overlapOf = (a: string, b: string, key: string) => {
    const [x, y] = [a, b].sort();
    return manifestLinksById.get(`${x}|${y}|${key}`);
  };
  const manifestLinksById = new Map(
    (manifest.links ?? []).map((l) => [
      `${l.a.replace("ds:", "")}|${l.b.replace("ds:", "")}|${l.key ?? "boundary"}`,
      l.overlap,
    ]),
  );

  it("exists and walks datasets that are on the map", () => {
    expect(tour).toBeDefined();
    const ids = new Set(manifest.nodes.map((n) => n.id));
    expect(tour!.steps.filter((s) => !ids.has(s.node))).toEqual([]);
  });

  it("quotes numbers that still match the measured overlaps", () => {
    // Each pair is (link, the figure the tour states).
    //
    // ⚠ RE-PIN BOTH SIDES OR NEITHER. The numbers live in `model.ts`'s tour prose, in BOTH
    // languages, and the vacuity check below reads the English spelling out of that prose — so
    // updating this table alone turns the gate red on the second assertion instead of the
    // first, and updating only the English string leaves the Bulgarian one quoting a figure
    // nobody measured. Re-measured 2026-09-04 against the watch-run reload (9f68471bb4):
    // connections↔procurement 18,717 → 18,723 and connections↔officials 5,612 → 5,609, with
    // connections↔funds unmoved at 40,269.
    //
    // ⚠ Re-measured again 2026-09-06: connections↔procurement 18,723 → 18,729, under a
    // concurrent contracts reload. It read 18,728 and then 18,729 minutes apart while that
    // load ran and settled at 18,729 across two readings twenty seconds apart — which is the
    // only reason it is pinned rather than left: a value written mid-load is stale before it
    // is committed.
    const quoted: [string, string, string, number][] = [
      ["connections", "procurement", "eik", 18729],
      ["connections", "funds", "eik", 40269],
      ["connections", "officials", "person_id", 5609],
    ];
    const drifted = quoted
      .filter(([a, b, k, n]) => overlapOf(a, b, k) !== n)
      .map(
        ([a, b, k, n]) =>
          `${a}↔${b} (${k}): tour says ${n}, measured ${overlapOf(a, b, k)}`,
      );
    expect(drifted).toEqual([]);
    // and the prose really does contain them, so the check is not vacuous.
    //
    // ⚠ BOTH LANGUAGES. Checking only the English spelling leaves the Bulgarian one free to
    // quote a figure nobody measured — on the side most readers actually read, and on a panel
    // that renders the live number next to it. The two spellings differ only in the thousands
    // separator (a plain space in bg, a comma in en; verified as U+0020, not a non-breaking
    // space), so both are derived here rather than typed.
    const prose = JSON.stringify(tour);
    for (const [, , , n] of quoted) {
      const en = n.toLocaleString("en-US");
      expect(prose, `the English prose does not quote ${en}`).toContain(en);
      const bg = en.replace(/,/g, " ");
      expect(prose, `the Bulgarian prose does not quote ${bg}`).toContain(bg);
    }
  });
});
