// Parser tests over frozen fixtures — the content block of each МК ДКИ page as
// it was served on 2026-08-19.
//
// Every assertion here is a REGRESSION, not a wish: each one names a specific
// way an earlier cut of this parser was wrong while looking like it worked. That
// is the failure mode of a scraper — it returns rows, so nothing errors, and the
// rows are short, truncated or blank in a field nobody reads until a page
// publishes them.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseDkiPage, cityFromLines, contentBlock } from "./parse";
import { DKI_PAGES } from "./sources";

const fixture = (id: string): string =>
  fs.readFileSync(path.resolve(__dirname, `__fixtures__/${id}.html`), "utf8");

const page = (id: string) => DKI_PAGES.find((p) => p.id === id)!;
const parsed = (id: string) => parseDkiPage(fixture(id), page(id));

describe("contentBlock", () => {
  it("stops at the NEXT widget, not at this widget's own class attribute", () => {
    // The bug: the boundary searched for `elementor-widget elementor-widget-`,
    // which appears in the content widget's OWN attributes — so the block was
    // cut a few hundred bytes in and the music page yielded 2 of its 9
    // institutes. Every page still parsed, which is why it went unnoticed.
    const block = contentBlock(fixture("music_dance"));
    expect(block).toContain("СИМФОНИЕТА");
    expect(block).not.toContain("chrome after the content");
  });

  it("refuses a page with no content widget rather than parsing the nav", () => {
    expect(() =>
      parseDkiPage("<html><body>nope</body></html>", page("theatre")),
    ).toThrow(/no theme-post-content widget/);
  });
});

describe("parseDkiPage", () => {
  it.each([
    ["music_dance", 9],
    ["theatre", 38],
    ["art_schools", 23],
  ])("%s parses to %i institutes", (id, n) => {
    expect(parsed(id as string)).toHaveLength(n as number);
  });

  it("gives every institute a director and a seat", () => {
    for (const p of DKI_PAGES)
      for (const e of parsed(p.id)) {
        expect(e.director, `${p.id}: ${e.name}`).toBeTruthy();
        expect(e.city, `${p.id}: ${e.name}`).toBeTruthy();
      }
  });

  it("reads all four director spellings", () => {
    // „Директор – ИМЕ" (music), „ИМЕ, директор" (theatre), „ИМЕ – Директор" and
    // „ИМЕ, и. д. директор" (acting) — plus МК's „Директора – ИМЕ" typo. Fitting
    // the regex to one page's first entry matched most rows and dropped the rest.
    const byName = (id: string, needle: string) =>
      parsed(id).find((e) => e.name.includes(needle));
    expect(byName("music_dance", "ОПЕРА – РУСЕ")?.director).toBe(
      "Пламен Бейков",
    );
    expect(byName("theatre", "ИВАН ВАЗОВ")?.director).toBe("ВАСИЛ ВАСИЛЕВ");
    expect(byName("theatre", "ПРОДУЦЕНТСКИ ЦЕНТЪР")?.director).toBe(
      "ДАНИЕЛА ДИМОВА",
    );
    expect(byName("theatre", "РАЗГРАД")?.director).toBe("СТЕФАНИ ЛЕЧЕВА");
    expect(byName("art_schools", "ПАНЧО ВЛАДИГЕРОВ")?.director).toBe(
      "Димитър Маджаров",
    );
  });

  it("does not read a phone number as a director", () => {
    // The театър page has „Директор – 939 40 11" in the exact shape of a name
    // line, and the music page runs a box-office number into one director's
    // name („Огнян Драганов Билетна каса: 0887 …").
    const mlt = parsed("theatre").find((e) => e.name.includes("НИКОЛАЙ БИНЕВ"));
    expect(mlt?.director).toBe("МИХАИЛ БАЙКОВ");
    const sz = parsed("music_dance").find((e) =>
      e.name.includes("СТАРА ЗАГОРА"),
    );
    expect(sz?.director).toBe("Огнян Драганов");
  });

  it("joins a name МК wrapped over two lines", () => {
    // „МУЗИКАЛНО-ДРАМАТИЧЕН ТЕАТЪР" / „«КОНСТАНТИН КИСИМОВ» – ВЕЛИКО ТЪРНОВО".
    // Taking line 0 published an unnamed „Музикално-драматичен театър" that
    // matches no buyer in either corpus.
    const vt = parsed("music_dance").find((e) => e.name.includes("КИСИМОВ"));
    expect(vt?.name).toBe(
      "МУЗИКАЛНО-ДРАМАТИЧЕН ТЕАТЪР “КОНСТАНТИН КИСИМОВ” – ВЕЛИКО ТЪРНОВО",
    );
    expect(vt?.city).toBe("Велико Търново");
  });

  it("strips the numbering off the schools list", () => {
    for (const e of parsed("art_schools"))
      expect(
        e.name,
        "a leading number defeats every downstream match",
      ).not.toMatch(/^\d/);
  });

  it("keeps the town in the name but never the postcode", () => {
    const lovech = parsed("theatre").find((e) => e.name.includes("ЛОВЕЧ"));
    // „Драматичен театър – Ловеч" IS the body's name; three theatres collide
    // into one if the town is stripped. The postcode never belongs.
    expect(lovech?.name).toBe("ДРАМАТИЧЕН ТЕАТЪР – ЛОВЕЧ");
    for (const p of DKI_PAGES)
      for (const e of parsed(p.id)) expect(e.name).not.toMatch(/\b\d{4}\b/);
  });

  it("labels a seat read off the title as an inference", () => {
    // Nine theatres carry a bare postcode („8000; ул. …") and are reachable only
    // through their own name. That is a guess and it is marked as one, so a map
    // can tell evidence from inference instead of finding out later.
    const burgas = parsed("theatre").find(
      (e) => e.name === "КУКЛЕН ТЕАТЪР – БУРГАС",
    );
    expect(burgas?.city).toBe("БУРГАС");
    expect(burgas?.cityBasis).toBe("name");
    const sofia = parsed("theatre").find((e) => e.name.includes("ИВАН ВАЗОВ"));
    expect(sofia?.cityBasis).toBe("postcode");
  });
});

describe("cityFromLines", () => {
  it("reads all three layouts the театър page mixes", () => {
    expect(cityFromLines(["ГАБРОВО 5300"])?.city).toBe("ГАБРОВО");
    expect(cityFromLines(["7000 Русе, пл. „Света троица“ №7"])?.city).toBe(
      "Русе",
    );
    expect(cityFromLines(["София -1504, ул. “Димитър Греков” № 2"])?.city).toBe(
      "София",
    );
  });

  it("does not mistake a phone number for a postcode", () => {
    // „тел.: 02/ 8119 219" contains a 4-digit run. Contact lines are skipped
    // before the scan for exactly this reason.
    expect(
      cityFromLines(["тел.: 02/ 8119 219; факс.: 02/ 987 7800"]),
    ).toBeNull();
  });
});

describe("fixtures", () => {
  it("parse to exactly what the live capture parses to", () => {
    // A fixture that has silently drifted from what the site serves turns every
    // test above into a test of the fixture.
    //
    // The comparison is on the PARSED ENTRIES, not the raw bytes: each fixture
    // carries a synthetic trailing widget marker so the boundary logic in
    // contentBlock() is exercised too, which makes a byte-for-byte tail
    // comparison fail on scaffolding rather than on drift.
    const RAW = path.resolve(__dirname, "../../../raw_data/culture/dki");
    for (const p of DKI_PAGES) {
      const raw = path.join(RAW, `${p.id}.html`);
      if (!fs.existsSync(raw)) continue; // fresh clone — nothing to compare
      const live = parseDkiPage(fs.readFileSync(raw, "utf8"), p);
      expect(
        parsed(p.id),
        `${p.id}: the fixture no longer parses to what ` +
          `raw_data/culture/dki/${p.id}.html does. If МК changed the page, re-cut ` +
          `the fixture AND re-check every assertion above — they are ` +
          `regressions, not decoration.`,
      ).toEqual(live);
    }
  });
});
