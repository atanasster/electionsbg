// The slug is a URL identity, so its output is a contract: changing it silently
// breaks every existing /pension-fund link and every sitemap <loc>.

import { describe, expect, it } from "vitest";
import {
  kfnFundSlug,
  kfnFundName,
  isDegenerateFundSlug,
  isCrawlableFund,
} from "./kfnFundSlug";

describe("kfnFundSlug", () => {
  it("mints the expected slug for the register's real companies", () => {
    expect(kfnFundSlug("UPF", "Doverie")).toBe("upf-doverie");
    expect(kfnFundSlug("VPFOS", "DSK-Rodina")).toBe("vpfos-dsk-rodina");
    expect(kfnFundSlug("PPF", "Allianz Bulgaria")).toBe("ppf-allianz-bulgaria");
    expect(kfnFundSlug("VPF", "Lev Ins")).toBe("vpf-lev-ins");
  });

  it("is URL-safe — no percent-encoding, no leading or trailing hyphen", () => {
    for (const [p, c] of [
      ["UPF", "CCB-Sila"],
      ["PPF", "DallBogg"],
      ["VPF", "Future"],
      ["UPF", "  spaced  "],
      ["UPF", "A/B & C"],
    ] as const) {
      const s = kfnFundSlug(p, c);
      expect(s).toBe(encodeURIComponent(s));
      expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("folds accents rather than percent-encoding them", () => {
    expect(kfnFundSlug("UPF", "Bălgaria")).toBe("upf-balgaria");
  });

  it("distinguishes the pillars of one company", () => {
    // Every management company runs a fund in three pillars, so the pillar is
    // not decoration — without it all three collapse onto one URL.
    const slugs = ["UPF", "PPF", "VPF"].map((p) => kfnFundSlug(p, "Doverie"));
    expect(new Set(slugs).size).toBe(3);
  });
});

describe("kfnFundName", () => {
  it("renders in the READER's language, not the archive's", () => {
    // fundName is whatever the source ZIP was written in, so the raw field puts
    // Cyrillic on the English page and will put Latin on the Bulgarian one
    // after the next English ingest.
    expect(kfnFundName("UPF", "Доверие", "Doverie", true)).toBe(
      "УПФ „Доверие“",
    );
    // Straight quotes on the English page — the name is a <title> and a
    // JSON-LD `name` on 31 prerendered EN pages, so the quote pair follows the
    // reader rather than the source.
    expect(kfnFundName("UPF", "Доверие", "Doverie", false)).toBe(
      'UPF "Doverie"',
    );
  });

  it("uses each language's pillar abbreviation", () => {
    // ДПФ and VPF are the same pillar written two ways.
    expect(kfnFundName("VPF", "Доверие", "Doverie", true)).toContain("ДПФ");
    expect(kfnFundName("VPF", "Доверие", "Doverie", false)).toContain("VPF");
  });

  it("falls back to the company alone for an unknown pillar", () => {
    expect(kfnFundName("XXX", "Доверие", "Doverie", true)).toBe("Доверие");
  });
});

describe("isDegenerateFundSlug", () => {
  it("catches a slug that is nothing but its pillar", () => {
    // companyOf() falls back to the raw Cyrillic fund name for an unmapped
    // company, and the slugger strips that to nothing — so two unmapped funds
    // in one pillar collide onto a single URL and blend into one trend.
    const bad = kfnFundSlug("UPF", 'УПФ "НОВ ФОНД"');
    expect(bad).toBe("upf");
    expect(isDegenerateFundSlug(bad, "UPF")).toBe(true);
  });

  it("passes a real slug", () => {
    expect(isDegenerateFundSlug(kfnFundSlug("UPF", "Doverie"), "UPF")).toBe(
      false,
    );
  });
});

describe("isCrawlableFund", () => {
  it("accepts a real fund slug", () => {
    expect(isCrawlableFund("upf-doverie", "UPF")).toBe(true);
    expect(isCrawlableFund("vpfos-dsk-rodina", "VPFOS")).toBe(true);
  });

  it("rejects the pillar-only degenerate slug", () => {
    // Two unmapped funds in one pillar would collide onto this URL and blend
    // into a single trend — the reason the prerender skips them.
    expect(isCrawlableFund(kfnFundSlug("UPF", 'УПФ "НОВ ФОНД"'), "UPF")).toBe(
      false,
    );
  });

  it("rejects a slug that is not path-safe", () => {
    expect(isCrawlableFund("", "UPF")).toBe(false);
    expect(isCrawlableFund("-upf-doverie", "UPF")).toBe(false);
    expect(isCrawlableFund("UPF-Doverie", "UPF")).toBe(false);
  });
});
