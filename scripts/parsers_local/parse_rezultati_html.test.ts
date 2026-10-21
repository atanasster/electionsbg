// ЦИК's 2026-10-18 partial-election pages moved the race type out of the section
// heading („Обобщени данни от гласуването Рудник") onto the owning tab. The parser
// stopped matching any heading, fell back to "first mayor table = municipal mayor",
// and published 12 village races as município mayoralties. These pages are the
// real captures from that cycle plus one from 2026-06-14 (the legacy heading),
// so a fix for one shape cannot silently break the other.

import fs from "fs";
import path from "path";
import { load } from "cheerio";
import { describe, it, expect } from "vitest";
import { parseRezultatiHtml, sectionHeadingText } from "./parse_rezultati_html";

const FIXTURES = path.join(__dirname, "../../tests/fixtures/local_elections");
const read = (f: string) => fs.readFileSync(path.join(FIXTURES, f), "utf8");
const parse = (f: string) =>
  parseRezultatiHtml(read(f), {
    oikCode: f.match(/_(\d{4})\.html$/)![1],
    round: 1,
    canonical: undefined,
  });

describe("parseRezultatiHtml — race type", () => {
  it("reads a tab-labelled кметство race as a village race, not the municipal mayor", () => {
    const p = parse("chmi_2026_10_18_0313.html");
    expect(p.mayor).toHaveLength(0);
    expect(p.kmetstva.map((k) => k.kmetstvoName)).toEqual(["Рудник"]);
    expect(p.kmetstva[0].candidates.length).toBeGreaterThan(0);
  });

  it("separates the municipal race from the village race on one page", () => {
    const p = parse("chmi_2026_10_18_0426.html");
    expect(p.mayor.length).toBeGreaterThan(0);
    expect(p.kmetstva.map((k) => k.kmetstvoName)).toEqual(["Масларево"]);
    // the two tables must not be merged into one race
    const villageNames = new Set(
      p.kmetstva[0].candidates.map((c) => c.candidateName),
    );
    expect(p.mayor.some((m) => villageNames.has(m.candidateName))).toBe(false);
  });

  it("still parses the legacy heading shape", () => {
    const p = parse("chmi_2026_06_14_0313.html");
    expect(p.mayor).toHaveLength(0);
    expect(p.kmetstva.map((k) => k.kmetstvoName)).toEqual(["Гроздьово"]);
  });
});

describe("sectionHeadingText", () => {
  it("rebuilds the legacy form from the owning tab", () => {
    const $ = load(read("chmi_2026_10_18_0426.html"));
    const headings = $("h3")
      .map((_, el) => sectionHeadingText($, el))
      .get()
      .filter((h) => h.startsWith("Обобщени"));
    expect(headings).toEqual([
      "Обобщени данни от избор на кмет на община",
      "Обобщени данни от избор на кмет на кметство Масларево",
    ]);
  });

  it("leaves a legacy heading unchanged", () => {
    const $ = load(read("chmi_2026_06_14_0313.html"));
    const h = $("h3")
      .map((_, el) => sectionHeadingText($, el))
      .get()
      .find((t) => t.startsWith("Обобщени"));
    expect(h).toBe("Обобщени данни от избор на кмет на кметство Гроздьово");
  });
});
