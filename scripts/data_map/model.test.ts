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
import { deriveAiEdges } from "./build_manifest";
import {
  TOURS,
  DATASETS,
  EDGES,
  SOURCE_GROUPS,
  FEATURES,
  UNCLAIMED,
  LINKS,
  AI_PATH_RULES,
} from "./model";
import type { DatasetDef } from "./model";
import { validateDatasetServing, validateLinks } from "./build_manifest";
import { assertCommitted } from "../lib/assert_committed";
import { formatCount, renderTourText, tourTokens } from "./tourText";
import type { Lang } from "./model";

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
  tours: { id: string; steps: { node: string; text: Lang }[] }[];
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

  it("derives an AI edge for every corpus the assistant actually reads", () => {
    // ⚠ `EDGES` IS HAND-WRITTEN; THE `ds:* → f:ai` EDGES ARE DERIVED. The manifest test below
    // compares only the declared half, so a tool that starts reading a new corpus can leave the
    // published map an edge short with every gate green — the same silent mis-attribution the
    // `pvrCycle` rule exists to prevent, one layer up.
    const derived = new Set(deriveAiEdges().edges.map(([from]) => from));
    expect(derived.has("ds:presidential")).toBe(true);
    expect(derived.size).toBeGreaterThan(20);

    // Nothing in the manifest claims an AI edge the derivation no longer produces — that is a
    // dataset the assistant stopped reading, and an edge nobody would notice going stale.
    const inManifest = manifest.edges
      .filter((e) => e.to === "f:ai")
      .map((e) => e.from);
    expect(inManifest.filter((d) => !derived.has(d))).toEqual([]);

    // ⚠ THE OTHER DIRECTION IS A RATCHET, NOT AN EQUALITY. `data/data_map.json` is regenerated
    // by `prebuild`, which needs a complete local Postgres; on a machine whose declarations
    // corpus has not been resolved it aborts on an unrelated link check, so a freshly derived
    // edge can legitimately be waiting for the next successful build. A named pending list keeps
    // that visible and still fails on the NEXT dataset to fall behind. Shrink it after a
    // rebuild; never widen it to make a red test green.
    const PENDING_MANIFEST_REBUILD = new Set(["ds:presidential"]);
    const behind = [...derived].filter(
      (d) => !inManifest.includes(d) && !PENDING_MANIFEST_REBUILD.has(d),
    );
    expect(behind).toEqual([]);
  });

  it("routes each per-cycle AI path to the corpus it actually reads", () => {
    // ⚠⚠ FIRST MATCH WINS, AND THE BUILD ONLY FAILS ON AN *UNMATCHED* PATH — never on a
    // wrongly matched one. `ai/tools/presidential.ts` reads `/${pvrCycle}/…`; had it used the
    // obvious variable name `cycle`, every presidential read would have matched the LOCAL rule
    // and the published map would have said the assistant reads the presidential corpus out of
    // the local-elections one, silently and forever. The three variable names are the only
    // discriminator between three per-cycle trees, so their ORDER is an invariant, not a
    // formatting detail.
    const routeOf = (p: string) =>
      AI_PATH_RULES.find((r) => r.pattern.test(p))?.dataset ?? "UNMATCHED";
    expect(routeOf("/{pvrCycle}/national_summary.json")).toBe("presidential");
    expect(routeOf("/{pvrCycle}/tur{round}/region_votes.json")).toBe(
      "presidential",
    );
    expect(routeOf("/{cycle}/index.json")).toBe("local");
    expect(routeOf("/{election}/national_summary.json")).toBe("elections");
    expect(routeOf("/2024_10_27/national_summary.json")).toBe("elections");
    expect(routeOf("/2024_10_27/municipalities/by/VAR.json")).toBe("elections");
    expect(routeOf("/opencalls/index.json")).toBe("opencalls");
    // …and the presidential rule precedes the local one, which is what makes the first two
    // assertions above true rather than lucky.
    const idx = (needle: string) =>
      AI_PATH_RULES.findIndex((r) => r.pattern.source.includes(needle));
    expect(idx("pvrCycle")).toBeGreaterThanOrEqual(0);
    expect(idx("pvrCycle")).toBeLessThan(idx("\\{cycle"));
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

  it("quotes every overlap through a token, rendered from the link's measured value", () => {
    // ⚠ NO NUMBER IS PINNED HERE, AND THAT IS THE FIX. The prose used to carry the overlaps as
    // literals and this test pinned the same literals, so every corpus reload that moved a join
    // by a few rows went red until somebody re-typed three numbers in two languages — eleven
    // re-pins between 2026-08-15 and 2026-10-12, none of them a defect. The source prose now
    // names the LINK (`{{overlap:<id>}}`) and build_manifest writes the measured figure in
    // (tourText.ts), so what this asserts is the invariant that survives any reload: the
    // published narration states exactly the overlap the published map carries.
    const sourceTokens = tour!.steps.flatMap((st) => [
      ...tourTokens(st.text.bg),
      ...tourTokens(st.text.en),
    ]);
    // Non-vacuous: the tour does quote measured overlaps, in both languages.
    expect(new Set(sourceTokens).size).toBeGreaterThanOrEqual(3);

    const published = manifest.tours.find((t) => t.id === "linked");
    expect(published).toBeDefined();
    const overlapById = (id: string) => {
      const [a, b, key] = id.split("|");
      return overlapOf(a, b, key);
    };
    tour!.steps.forEach((st, idx) => {
      const out = published!.steps[idx].text;
      // The committed manifest is the same render of the same source, token for token.
      expect(out).toEqual(renderTourText(st.text, overlapById));
      for (const lang of ["bg", "en"] as const) {
        expect(
          out[lang],
          `step ${idx} (${lang}) ships a raw token`,
        ).not.toMatch(/\{\{/);
        for (const id of tourTokens(st.text[lang])) {
          const n = overlapById(id);
          expect(n, `${id} has no measured overlap in the manifest`).toBeTypeOf(
            "number",
          );
          expect(out[lang]).toContain(formatCount(n!, lang));
        }
      }
    });
  });
});
