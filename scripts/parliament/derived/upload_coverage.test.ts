// EVERY artifact rebuildDerived writes must also be in its --upload branch.
//
// This is the plan's §11 gate, and it is generic rather than a check on the two new files
// because the failure it prevents has no symptom. `npm run watch` re-ingests roll calls
// daily and calls rebuildDerived({ upload: true }); an artifact missing from that list is
// regenerated locally, committed, and never uploaded — so the bucket keeps serving the
// previous week's numbers while every local check is green and the file's mtime moves.
// Nothing is red, nothing is stale in git, and the page is wrong.
//
// It reads the SOURCE rather than running the writer: running it would need the 613-file
// session corpus, and the property is about what the code says, not what one run produced.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync("scripts/parliament/derived/index.ts", "utf8");
const DERIVED = "data/parliament/votes/derived";

// Anchored on the WRITE CALL, not on a bare DERIVED_DIR join. The looser form also matched
// `path.join(DERIVED_DIR, "important_votes.json")` inside the unlink that removes the
// legacy monolith — so the gate demanded an upload for a file whose whole purpose is to
// stop existing.
const writeCalls = [
  ...SRC.matchAll(
    /write(?:Json|FileSync)\(\s*path\.join\(\s*DERIVED_DIR,\s*"([^"]+)"/g,
  ),
].map((m) => m[1]);

/** Files written as path.join(DERIVED_DIR, "<name>.json"). */
const written = new Set(writeCalls.filter((n) => n.endsWith(".json")));
/** Directories written as path.join(DERIVED_DIR, "<dir>", …) — the sharded artifacts. */
const writtenTrees = new Set(writeCalls.filter((n) => !n.endsWith(".json")));

const uploadedFiles = new Set(
  [
    ...(SRC.match(/for \(const f of \[([\s\S]*?)\]\)/)?.[1] ?? "").matchAll(
      /"([^"]+\.json)"/g,
    ),
  ].map((m) => m[1]),
);
const uploadedTrees = new Set(
  [
    ...SRC.matchAll(
      /uploadTextTree\(\s*path\.join\(DERIVED_DIR,\s*"([a-z_-]+)"\)/g,
    ),
  ].map((m) => m[1]),
);

/** writeMpShards writes per-mp/ through its own module rather than a DERIVED_DIR join here,
 *  so it is the one artifact the parser cannot see. Named, not silently tolerated. */
const PARSER_BLIND = ["per-mp"];

describe("rebuildDerived --upload covers everything it writes", () => {
  test("the parser sees every artifact that actually exists on disk", (t) => {
    // GROUND TRUTH instead of a magic floor. The first version asserted `written.size >= 8`
    // and `writtenTrees.size >= 2` — satisfied by exactly today's artifacts, so a third
    // shard tree written through a non-literal path (a helper, a variable directory) would
    // be invisible to the regex, the floor would still pass at 2, and the new tree would
    // never be required to upload. That is the original silent failure, reintroduced inside
    // the gate built to stop it. derived/ is committed, so it can be the oracle.
    if (!existsSync(DERIVED)) return t.skip();
    const entries = readdirSync(DERIVED, { withFileTypes: true });
    const missedFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .filter((f) => !written.has(f));
    const missedTrees = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((d) => !writtenTrees.has(d) && !PARSER_BLIND.includes(d));
    assert.deepEqual(
      [...missedFiles, ...missedTrees],
      [],
      "the write-call regex no longer finds a writer for these — the gate below is now " +
        "checking a subset of reality",
    );
  });

  test("the upload-side regexes still match something", () => {
    // The write side is anchored on disk above; this side has no such oracle, and an
    // upload list the regex cannot read makes every artifact look missing rather than
    // present — which fails loudly, so a floor is enough here.
    assert.ok(uploadedFiles.size > 0, "found no uploaded .json files at all");
    assert.ok(uploadedTrees.size > 0, "found no uploadTextTree calls at all");
  });

  test("every written .json is uploaded", () => {
    const missing = [...written].filter((f) => !uploadedFiles.has(f));
    assert.deepEqual(
      missing,
      [],
      `written but never uploaded — prod will serve the previous run: ${missing.join(", ")}`,
    );
  });

  test("every written shard directory is uploaded", () => {
    const missing = [...writtenTrees, ...PARSER_BLIND].filter(
      (d) => !uploadedTrees.has(d),
    );
    assert.deepEqual(
      missing,
      [],
      `shard tree(s) never uploaded: ${missing.join(", ")}`,
    );
  });
});

describe("the committed hub_feed shards", () => {
  const dir = path.join(DERIVED, "hub_feed");
  const have = existsSync(dir);

  test("each is under the 12 KB budget", (t) => {
    if (!have) return t.skip();
    const over = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f, statSync(path.join(dir, f)).size] as const)
      .filter(([, size]) => size > 12_288);
    // The budget is the reason this artifact is sharded at all (§5.1). Without a ceiling it
    // regrows the moment someone raises MAX_PER_CARD or adds a field carrying titles.
    assert.deepEqual(
      over.map(([f, size]) => `${f}: ${size}B`),
      [],
    );
  });

  test("every shard the stats blob names exists, and vice versa", (t) => {
    const blob = path.join(DERIVED, "hub_stats.json");
    if (!have || !existsSync(blob)) return t.skip();
    const byNs = Object.keys(
      (
        JSON.parse(readFileSync(blob, "utf8")) as {
          byNs: Record<string, unknown>;
        }
      ).byNs,
    ).sort();
    const shards = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    // A parliament in the blob with no shard renders a hub with tiles and no rail; a shard
    // with no blob entry is dead weight in the bucket. Both are silent.
    assert.deepEqual(shards, byNs);
  });
});
