// No SERVED artifact may name a canonical party id that
// data/canonical_parties.json does not carry.
//
// WHY. `local_coalition_overrides.ts` once named an invented id ("vmro") for a
// party that already had a real lineage (`p_51`). Nothing failed: the id was
// written into every baked artifact, `displayNameForId` missed it and the UI
// printed the raw token in grey beside the real party. Fixing the RULE then
// reached `municipalities/` and stopped, because `resolveCanonicalsForCycle`
// only walked that folder — 3,697 files kept serving the retired id for as long
// as nobody looked.
//
// Both halves of that are invisible to every other gate in this repo: the ids
// live in gitignored JSON, and no row count changes when one of them is wrong.
// So this walks what is actually served and compares it to the one table that
// defines the vocabulary.
//
// TWO TRAPS, both hit while writing it:
//
//   1. The transition matrices do NOT use `primaryCanonicalId` — their nodes
//      carry a bare `id`. A first version scanned only the former, missed
//      `transitions_*` entirely and reported a false clean.
//   2. Those node ids include pseudo-buckets that are deliberately not parties
//      (`__abstain`, `local:*` and friends). They are allowlisted by PREFIX, so
//      a new one has to be added consciously rather than silently tolerated.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA = path.join(REPO_ROOT, "data");

const canonical = JSON.parse(
  fs.readFileSync(path.join(DATA, "canonical_parties.json"), "utf-8"),
) as CanonicalPartiesIndex;
const known = new Set(canonical.parties.map((p) => p.id));

// Not parties: synthetic buckets the flow/trend artifacts use for
// non-party mass (abstentions, new voters, a place-local slate).
const PSEUDO_PREFIXES = ["__", "local:", "other", "unmatched"];
const isPseudo = (id: string) => PSEUDO_PREFIXES.some((p) => id.startsWith(p));

// The families that bake a canonical id and are fetched by the browser.
const SERVED_DIRS = [
  ...fs
    .readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /_(mi|chmi|chmi_nov)$/.test(e.name))
    .map((e) => path.join(DATA, e.name, "sections")),
  path.join(DATA, "transitions_local"),
  path.join(DATA, "transitions_prevote"),
  path.join(DATA, "local_place_trends"),
  path.join(DATA, "officials", "municipal", "by_obshtina"),
];

const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith(".json") ? [full] : [];
  });
};

// Every field across these families that holds a canonical party id. `id` is
// the transition-matrix node key; the others are the legend/roster shapes.
const ID_KEYS = new Set([
  "primaryCanonicalId",
  "partyCanonicalId",
  "canonicalId",
  "id",
  "from",
  "to",
]);

const collectIds = (node: unknown, out: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const x of node) collectIds(x, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (ID_KEYS.has(k) && typeof v === "string" && v) out.add(v);
    else collectIds(v, out);
  }
};

describe("served artifacts name only real canonical parties", () => {
  const files = SERVED_DIRS.flatMap(walk);

  it("found the served corpus", () => {
    // Floor: the whole gate is vacuous if the walk returns nothing, and these
    // trees are gitignored so a fresh clone legitimately has fewer.
    expect(files.length).toBeGreaterThan(100);
    expect(known.size).toBeGreaterThan(100);
  });

  it("no unknown canonical id appears in any served artifact", () => {
    const offenders = new Map<string, string>();
    for (const f of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
      } catch {
        continue; // shape is another gate's problem
      }
      const ids = new Set<string>();
      collectIds(parsed, ids);
      for (const id of ids) {
        // `id`/`from`/`to` are generic keys, so restrict to values that LOOK
        // like a canonical id; a section number or an EKATTE code must not be
        // reported as a missing party.
        if (isPseudo(id)) continue;
        if (!/^(p_\d+|[a-z][a-z0-9_-]{1,24})$/.test(id)) continue;
        if (known.has(id)) continue;
        if (!offenders.has(id)) offenders.set(id, path.relative(DATA, f));
      }
    }
    expect(
      [...offenders].map(([id, f]) => `${id} (first seen: ${f})`),
      "served artifacts naming a canonical id absent from canonical_parties.json — " +
        "these render as a raw token with no colour. Re-run " +
        "`npm run data -- --resolve-local-canonicals` and the flow/trend generators.",
    ).toEqual([]);
  });

  it("the retired `vmro` id is gone from every served artifact", () => {
    // The specific regression, pinned by name so the generic check above cannot
    // be weakened without this failing too.
    const hits = files.filter((f) =>
      fs.readFileSync(f, "utf-8").includes('"vmro"'),
    );
    expect(hits.slice(0, 5).map((f) => path.relative(DATA, f))).toEqual([]);
  });
});
