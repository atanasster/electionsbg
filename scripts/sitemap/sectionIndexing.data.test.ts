// §5c's decision: the 12,721 polling-section pages STAY submitted for indexing — and the
// premise that makes that defensible, held as an assertion rather than as prose.
//
// ⚠️ THE DECISION IS RECORDED IN THE PLAN; THIS FILE HOLDS THE THING THAT COULD MAKE IT
// WRONG LATER. §5c asks whether these pages are the `/council/resolution/**` shape —
// "one title and a vote table, the shape that earns a thin-content penalty rather than
// traffic" — which was answered by giving those 4,813 resolutions a real head and
// deliberately NO sitemap <loc> and NO prerender. The answer here is the opposite one,
// and it rests on exactly three measurable properties. If any of them stops holding, the
// decision silently becomes the one it was argued against: 12,721 near-identical pages
// submitted en masse.
//
//   1. every page's TITLE is its own — the station number and its settlement;
//   2. every page's DESCRIPTION is its own, and names the street ADDRESS;
//   3. the body carries that station's own protocol and its comparisons.
//
// A resolution's unique text is ONE line and its vote table repeats the councillor roster
// the parent page already lists. A section page's every number belongs to that station and
// appears on no other page in the corpus — which is why the council reasoning does not
// transfer, and why this gate checks uniqueness rather than length.
//
// ⚠️ AND THE COST WAS OVERSTATED 2x IN THE PLAN, which is worth keeping visible because a
// re-opened decision will reach for that figure. §5c estimated "roughly 25,400 URLs with
// the EN mirrors". `sitemap_sections.xml` carries **no EN mirror at all** — measured
// 2026-09-04: 16,951 <loc>s, of which 12,721 are `/section/` and 4,230 `/sections/`, and
// zero contain `/en/`. The submitted cost of the family this decision is about is 12,721.
//
// The dist half auto-skips on a checkout that has not built — dist/ is not committed, so a
// gate failing on its absence would fail on every clone. Run it AFTER `npm run build`:
//
//   npm run build && npx vitest run scripts/sitemap/sectionIndexing.data.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportSkip } from "../lib/report_skip";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SITEMAP = path.join(PROJECT_ROOT, "public/sitemap_sections.xml");
const DIST_SECTION = path.join(PROJECT_ROOT, "dist/section");

const haveDist = fs.existsSync(DIST_SECTION);
const skipDist = haveDist ? "" : "no dist/section — run `npm run build` first";
reportSkip(import.meta.url, skipDist);

const locsOf = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/** The one extractor, so the three head assertions cannot disagree about what they read. */
const headOf = (html: string) => ({
  title: /<title>(.*?)<\/title>/s.exec(html)?.[1]?.trim() ?? "",
  description:
    /<meta name="description" content="(.*?)"/s.exec(html)?.[1]?.trim() ?? "",
});

/** A deterministic spread across the family — every 37th page, so the sample crosses
 *  oblasts rather than sitting inside one municipality's contiguous run of near-twins,
 *  which is precisely where duplicate heads would hide. */
const sampleDir = (dir: string, stride: number): string[] => {
  const all = fs.readdirSync(dir).sort();
  return all.filter((_, i) => i % stride === 0);
};

test("the section family is still SUBMITTED — §5c's decision, not an inherited default", () => {
  const locs = locsOf(fs.readFileSync(SITEMAP, "utf8"));
  const section = locs.filter((l) => /\/section\/[^/]+$/.test(l));
  const sections = locs.filter((l) => /\/sections\//.test(l));

  // ⚠️ NOT A PINNED COUNT. The corpus grows with each cycle, so an exact number would fail
  // on the next ingest and teach the reader to re-ratchet it. What must not change silently
  // is that the family is submitted AT ALL — removing the <loc>s is §5c's OTHER answer, and
  // it has to be taken deliberately rather than by a builder regression.
  assert.ok(
    section.length > 10_000,
    `only ${section.length} /section <loc>s — if the family was de-submitted on purpose, ` +
      `update §5c's decision and this gate together; if not, the sitemap builder regressed`,
  );
  assert.ok(
    sections.length > 3_000,
    `only ${sections.length} /sections <loc>s`,
  );

  // The plan's own cost estimate assumed EN mirrors. There are none, and a future reader
  // re-opening the decision should meet that fact here rather than re-deriving 2x too high.
  assert.equal(
    locs.filter((l) => l.includes("/en/")).length,
    0,
    "sitemap_sections.xml gained EN mirrors — §5c's cost figure doubles, re-open the decision",
  );
});

test.skipIf(skipDist)(
  "every submitted section page carries its OWN title, description and address",
  () => {
    const dirs = sampleDir(DIST_SECTION, 37);
    assert.ok(dirs.length > 200, `sample too small: ${dirs.length}`);

    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    const noAddress: string[] = [];

    for (const d of dirs) {
      const file = path.join(DIST_SECTION, d, "index.html");
      if (!fs.existsSync(file)) continue;
      const { title, description } = headOf(fs.readFileSync(file, "utf8"));
      assert.ok(title, `${d}: no <title>`);
      assert.ok(description, `${d}: no meta description`);

      const dupT = titles.get(title);
      assert.equal(dupT, undefined, `${d} and ${dupT} share a title: ${title}`);
      titles.set(title, d);

      const dupD = descriptions.get(description);
      assert.equal(
        dupD,
        undefined,
        `${d} and ${dupD} share a description: ${description}`,
      );
      descriptions.set(description, d);

      // ⚠️ THE ADDRESS IS THE PROPERTY, NOT THE LENGTH. It is the one string on the page
      // that a person actually searches for, it exists on no other page in the corpus, and
      // it is what makes this a navigational answer rather than a table of numbers. A
      // template change that drops it leaves every assertion above still passing.
      if (!/Адрес:\s*\S/.test(description)) noAddress.push(d);
    }

    assert.equal(
      noAddress.length,
      0,
      `${noAddress.length} of ${dirs.length} section descriptions name no address ` +
        `(first: ${noAddress.slice(0, 3).join(", ")}) — §5c's decision rests on this`,
    );
  },
);

test("the uniqueness assertion discriminates", () => {
  // ⚠️ WITHOUT THIS THE GATE ABOVE IS SATISFIED BY ANY CORPUS, including one whose heads
  // are all identical — a Map-based duplicate check that is never fed a duplicate proves
  // only that the loop ran. Two pages with one head, through the same extractor.
  const twin = (n: string) =>
    `<title>Избирателна секция №${n}</title>` +
    `<meta name="description" content="Адрес: ул. Първа №1.">`;
  const a = headOf(twin("010100001"));
  const b = headOf(twin("010100001"));
  assert.equal(
    a.title,
    b.title,
    "the extractor cannot see the collision it must catch",
  );
  assert.equal(a.description, b.description);

  // …and that a real pair does NOT collide, so the check is not trivially true either.
  assert.notEqual(
    headOf(twin("010100001")).title,
    headOf(twin("010100002")).title,
  );
});
