// The /subsidies head's band — every case is a defect the captions exist to prevent.

import { describe, it, expect } from "vitest";
import {
  subsidiesHubKpis,
  promotedTiles,
  SUBSIDIES_BAND_TILES,
} from "./subsidiesHubFigures";
import type { AgriHubStats } from "@/data/agri/useAgriHubStats";
import {
  AGRI_STATS_FIXTURE as S,
  AGRI_STATS_ALL_FIXTURE as ALL,
} from "./subsidiesHubStats.fixture";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

const tFor =
  (corpus: Record<string, string>) =>
  (key: string, opts?: Record<string, unknown>): string =>
    (corpus[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) =>
      String(opts?.[name] ?? ""),
    );

/** `Intl` compact output separates the unit with a NON-BREAKING space, so an assertion
 *  typed with an ordinary one fails on two strings that print identically. */
const nbsp = (v: string) => v.replace(/[\u202f\u00a0]/g, " ");

const build = (stats: AgriHubStats | null = S, lang: "bg" | "en" = "bg") =>
  subsidiesHubKpis(
    stats,
    AGRI_FINANCIAL_YEARS,
    lang === "bg" ? "bg" : "en",
    lang === "bg",
    tFor(lang === "bg" ? bgCorpus : enCorpus),
  );

/** ⚠️ Not through `build` — a default parameter fires on an EXPLICIT `undefined` too, so
 *  `build(undefined)` would silently become `build(S)` and assert the opposite of its name. */
const buildRaw = (stats: AgriHubStats | null | undefined) =>
  subsidiesHubKpis(stats, AGRI_FINANCIAL_YEARS, "bg", true, tFor(bgCorpus));

describe("subsidiesHubKpis", () => {
  it("renders four cells, each with a basis and its own destination", () => {
    const k = build();
    expect(k).toHaveLength(4);
    for (const c of k) expect(c.basis.trim().length).toBeGreaterThan(0);
    expect(new Set(k.map((c) => String(c.to))).size).toBe(4);
    for (const c of k) expect(String(c.to)).toMatch(/^\/subsidies\//);
  });

  it("names the SCOPE on every cell — the figures move 7× with it", () => {
    // €1.59bn on the default year against €11.04bn all-time, 8,396 firms against 16,701.
    // A caption lagging its figure is the difference between a true statement and one
    // eight times too small.
    const year = build();
    expect(nbsp(year[0].value)).toBe("€1,6 млрд.");
    for (const c of year) expect(c.basis).toMatch(/финансова 2025 г\./);

    const all = build(ALL);
    expect(nbsp(all[0].value)).toBe("€11 млрд.");
    for (const c of all) expect(c.basis).not.toMatch(/финансова 2025/);
  });

  it("counts the `all` window's YEARS, and never implies the missing three", () => {
    // ⚠️ ДФЗ published nothing for 2018-2020, so the corpus is EIGHT financial years across
    // an eleven-year span. „2015–2025" alone claims three years of coverage that do not
    // exist, so the count leads and the span follows it.
    const basis = build(ALL)[0].basis;
    expect(basis).toMatch(/8 финансови години/);
    expect(basis).toContain("2015");
    expect(basis).toContain("2025");
    // The bare span, with no count in front of it, is the caption this forbids.
    expect(basis).not.toMatch(/^2015\s*[–-]\s*2025/);
    expect(AGRI_FINANCIAL_YEARS).toHaveLength(8);
    expect(AGRI_FINANCIAL_YEARS).not.toContain(2019);
  });

  it("declares the two percentages' DIFFERENT denominators", () => {
    // 49,3% is of ALL money; 14,8% is of money to companies only. Side by side under a bare
    // „%", the smaller reads as the milder fact when they are not measured against the same
    // thing at all.
    const [, , noEik, top100] = build();
    expect(noEik.value).toBe("49,3%");
    expect(top100.value).toBe("14,8%");
    expect(noEik.basis).toMatch(/дял от всички изплатени/);
    expect(top100.basis).toMatch(/дял от парите към фирми/);
    expect(noEik.basis).not.toEqual(top100.basis);
  });

  it("calls the count FIRMS, not recipients", () => {
    // `entityCountExPayer` counts entities carrying an ЕИК. ~61k beneficiaries have none —
    // they are the third cell's subject — so „получатели" would silently annex them.
    const firms = build()[1];
    expect(firms.label).toBe(bgCorpus.subsidies_kpi_firms);
    expect(firms.label).not.toMatch(/получател/i);
    expect(firms.basis).toMatch(/с ЕИК/);
    // …and it excludes the paying agency, which appears in the corpus as a recipient.
    expect(firms.basis).toMatch(/без ДФЗ/);
  });

  it("names the source once, in the eyebrow — not in every basis", () => {
    // Composed into a caption the window used to read „… без ДФЗ · финансова 2025 г. · ДФЗ".
    for (const c of build())
      expect((c.basis.match(/ДФЗ/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("withholds a cell whose figure the blob does not carry", () => {
    for (const k of [
      "totalEur",
      "entityCountExPayer",
      "noEikPctOfTotalEur",
      "top100PctOfEntityEur",
    ])
      expect(
        build({ ...S, [k]: null } as AgriHubStats),
        `${k} missing should drop its cell`,
      ).toHaveLength(3);
  });

  it("blanks a tile ONLY when the band really carried its figure", () => {
    expect(promotedTiles(build())).toEqual(
      new Set(["recipients", "untraceable", "concentration"]),
    );
    // A blob short of one figure leaves that tile its metric rather than deleting it.
    const partial = { ...S, noEikPctOfTotalEur: null } as AgriHubStats;
    expect(promotedTiles(build(partial)).has("untraceable")).toBe(false);
    expect(promotedTiles([])).toEqual(new Set());
    // The paid cell displaces NO tile — `totalEur` is on none of them, so it is pure gain.
    expect(SUBSIDIES_BAND_TILES).toHaveLength(3);
  });

  it("formats for the reader's locale", () => {
    // `${49.3}%` renders „49.3%" whatever the page language is — the slip a template
    // literal makes silently, which this file's sibling `tileMetric` documents too.
    expect(build()[2].value).toBe("49,3%");
    expect(build(S, "en")[2].value).toBe("49.3%");
  });

  it("returns nothing before the blob arrives", () => {
    expect(buildRaw(undefined)).toEqual([]);
    expect(buildRaw(null)).toEqual([]);
    expect(buildRaw(S).length).toBeGreaterThan(0);
  });
});
