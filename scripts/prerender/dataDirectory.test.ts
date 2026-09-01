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
import { buildDataDirectory, buildDataLinksBody } from "./routes";

const ROOT = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
) as {
  nodes: { id: string; kind: string }[];
  links: { kind: string; key?: string; overlap?: number }[];
};
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

describe("buildDataLinksBody", () => {
  // /data/links exists BECAUSE the content is the eighteen notes rather than
  // the five key totals. A chip strip on /data compressed them into maxima and
  // dropped every caveat — including the boundary link, whose entire point is
  // one sentence.
  it("carries every link as prose, in both languages", () => {
    for (const lang of ["bg", "en"] as const) {
      const html = buildDataLinksBody(lang);
      expect((html.match(/<li>/g) ?? []).length, lang).toBe(
        manifest.links.length,
      );
      expect(html.length).toBeGreaterThan(2000);
    }
  });

  it("gives the boundary link its own section and its sentence", () => {
    // Otherwise it is an unlabelled dashed grey edge you only meet by selecting
    // one of its endpoints — and it is the strongest claim on the map.
    const html = buildDataLinksBody("bg");
    expect(html).toContain("Масиви, които не се събират");
    expect(html).toContain("никога не се събират");
  });

  it("prints an overlap for every measured join", () => {
    const html = buildDataLinksBody("bg");
    const measured = manifest.links.filter(
      (l) => l.kind === "join" && typeof l.overlap === "number",
    ).length;
    expect((html.match(/съвпадения<\/strong>/g) ?? []).length).toBe(measured);
  });

  it("carries the NOTE of every link, not just the boundary's", () => {
    // The page exists because the content is the notes. The first cut of this
    // suite string-matched only the boundary's own sentence, so dropping the
    // note from all 17 join links passed every case — 1 of 18 rows defended.
    const raw = JSON.parse(
      readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
    ) as { links: { label: { bg: string } }[] };
    const html = buildDataLinksBody("bg");
    const missing = raw.links
      .map((l) => l.label.bg)
      .filter((note) => !html.includes(note));
    expect(missing).toEqual([]);
  });

  it("carries the sparse-key denominator", () => {
    // Two links declare an `of` caveat. A bare overlap beside a corpus-sized
    // dataset name claims coverage the key does not have — dropping it passed
    // every other case here.
    const raw = JSON.parse(
      readFileSync(path.join(ROOT, "data/data_map.json"), "utf8"),
    ) as { links: { of?: { bg: string } }[] };
    const ofs = raw.links.map((l) => l.of?.bg).filter(Boolean) as string[];
    expect(ofs.length).toBeGreaterThan(0);
    const html = buildDataLinksBody("bg");
    expect(ofs.filter((o) => !html.includes(o))).toEqual([]);
  });

  it("does not give a boundary link an overlap", () => {
    // A boundary has no shared key; a count beside it would say the opposite
    // of what the section means.
    const html = buildDataLinksBody("en");
    const tail = html.slice(html.indexOf("must not be merged"));
    expect(tail).not.toMatch(/shared keys<\/strong>/);
  });
});
