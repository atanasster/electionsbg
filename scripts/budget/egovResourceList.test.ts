// The egov listing walk decides whether a COMMITTED corpus is complete, and every
// way it can go wrong is quiet.
//
// It was the only uncached call in the whole budget ingest — every resource, law
// document and report is read from raw_data/budget/ when present, but discovery was
// not — so a data.egov.bg 403 (the portal refuses non-Bulgarian egress, a standing
// condition rather than an incident) blocked every re-derivation, including ones
// needing no new bytes at all. Commit 0de88e2ad0 shipped a deliberate parser change
// and its own message records the consequence: "regenerating needs a budget:ingest
// run, which currently 403s at data.egov.bg". Two artifacts sat stale for a day.
//
// The fallback that fixes it must not become the next failure mode: preferring a
// stale list over a live one, or papering over a page-structure change, would turn
// "the portal moved" into a successful run with a truncated history.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cachedEgovResourceUuids, egovListingRefusal } from "./fetch_sources";

const U1 = "01d3ddd4-6637-4dca-a9f6-998d5b50fb49";
const U2 = "ba988f39-2fa2-43b4-a662-62afbce10ae8";

describe("cachedEgovResourceUuids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-cache-"));
  fs.writeFileSync(path.join(dir, `egov-${U1}.json.gz`), "");
  fs.writeFileSync(path.join(dir, `egov-${U2}.json.gz`), "");
  // Neighbours in the SAME directory that must not be counted as resources — the
  // law and report caches really do live here, and miscounting one would inflate
  // the floor check below into a false alarm that blocks every ingest.
  fs.writeFileSync(path.join(dir, "law-244982.html.gz"), "");
  fs.writeFileSync(path.join(dir, "doklad-2024.pdf"), "");
  fs.writeFileSync(path.join(dir, `egov-${U1}.json`), ""); // un-gzipped stray
  fs.writeFileSync(path.join(dir, "egov-not-a-uuid.json.gz"), "");

  it("reads every cached resource uuid and nothing else", () => {
    expect(cachedEgovResourceUuids(dir)).toEqual([U1, U2].sort());
  });

  it("is sorted, so the ingest's resource order never depends on readdir", () => {
    expect(cachedEgovResourceUuids(dir)).toEqual(
      [...cachedEgovResourceUuids(dir)].sort(),
    );
  });

  it("returns [] for an empty or absent directory rather than throwing", () => {
    // [] is what makes the fallback rethrow the original fetch error instead of
    // handing the ingest an empty resource set, which parses to "no observations"
    // and would write a corpus with no К ФП history at all.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "egov-empty-"));
    expect(cachedEgovResourceUuids(empty)).toEqual([]);
    expect(cachedEgovResourceUuids(path.join(empty, "nope"))).toEqual([]);
  });
});

describe("egovListingRefusal", () => {
  it("accepts a listing at least as large as the cache", () => {
    expect(egovListingRefusal(61, 61)).toBeNull();
    expect(egovListingRefusal(62, 61)).toBeNull();
    // The first-ever run, with nothing cached yet.
    expect(egovListingRefusal(300, 0)).toBeNull();
  });

  it("refuses an empty listing — the all-or-nothing page-structure break", () => {
    expect(egovListingRefusal(0, 61)).toMatch(/zero resource UUIDs/);
    // …including when there is no cache to compare against, so a first run
    // against a moved page fails loudly instead of writing nothing.
    expect(egovListingRefusal(0, 0)).toMatch(/zero resource UUIDs/);
  });

  it("refuses a listing SMALLER than the cache — the partial break", () => {
    // The likelier failure and the one the zero-guard cannot see: if the
    // `rpage` pagination strip stops matching, the walk collects page 1 alone —
    // about ten of ~300 monthly resources. That passes `size === 0` while
    // truncating the КФП history to a few months, and would then be preferred
    // over a cache that is strictly larger. The portal does not un-publish
    // months, so smaller-than-cache is truncation, not a retraction.
    const refusal = egovListingRefusal(10, 61);
    expect(refusal).toMatch(/refusing to truncate/);
    // The message has to tell the operator both numbers and the way out, since
    // the symptom (a short corpus) looks nothing like the cause (pagination).
    expect(refusal).toContain("10");
    expect(refusal).toContain("61");
    expect(refusal).toMatch(/--refresh-cache/);
  });

  it("refuses by ONE — the boundary is not a tolerance", () => {
    // A single dropped month is the shape a slow pagination regression takes,
    // and it is exactly what a "close enough" threshold would wave through.
    expect(egovListingRefusal(60, 61)).toMatch(/refusing to truncate/);
  });
});
