// The /data hub's crawlable half.
//
// This repo has NO SSR: the prerender writes a hand-authored `bodyHtml` string
// into a hidden #ssg-content div and never renders the React tree. So the
// DataMapDirectory component's links reach a crawler only after a client-side
// fetch of a 233 KB manifest — which is to say, not at all. Measured before
// this builder existed: dist/data/index.html carried 37 hrefs and ZERO
// containing `node=ds:`, on the page whose whole purpose is to be the map of
// what the project holds.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDataDirectory } from "./routes";

const ROOT = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
) as { nodes: { id: string; kind: string }[] };
const datasets = manifest.nodes.filter((n) => n.kind === "dataset");

describe("buildDataDirectory", () => {
  it("emits one crawlable link per dataset, in both languages", () => {
    for (const lang of ["bg", "en"] as const) {
      const html = buildDataDirectory(lang);
      const hrefs = html.match(/node=ds/g) ?? [];
      expect(hrefs.length, `${lang}`).toBe(datasets.length);
      expect(hrefs.length).toBeGreaterThan(30);
    }
  });

  it("points EN links at the /en prefix", () => {
    // The EN mirror is a different URL space; a directory of BG links on the EN
    // page would send every crawler hop to the wrong locale.
    expect(buildDataDirectory("en")).toContain("/en/data?node=ds");
    expect(buildDataDirectory("bg")).not.toContain("/en/data?node=ds");
  });

  it("URL-encodes the node id", () => {
    // `ds:funds` in a query string needs its colon encoded, or the href is
    // ambiguous — and these are the only links on the page a crawler follows
    // into the map.
    const html = buildDataDirectory("bg");
    expect(html).toContain("node=ds%3A");
    expect(html).not.toContain("node=ds:");
  });
});
