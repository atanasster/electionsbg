// The /subsidies head's band — every case is a defect the captions exist to prevent.

import { describe, it, expect } from "vitest";
import {
  subsidiesHubKpis,
  subsidiesHubEvidence,
  promotedTiles,
  SUBSIDIES_BAND_TILES,
} from "./subsidiesHubFigures";
import type { AgriHubStats } from "@/data/agri/useAgriHubStats";
import {
  AGRI_STATS_FIXTURE as S,
  AGRI_STATS_ALL_FIXTURE as ALL,
  AGRI_TOP_RECIPIENTS_FIXTURE as TOP,
  AGRI_TOP_RECIPIENTS_2016_FIXTURE as TOP_2016,
} from "./subsidiesHubStats.fixture";
import type { AgriTopRecipient } from "@/data/agri/types";
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

describe("subsidiesHubEvidence", () => {
  const WINDOW = "финансова 2025 г.";
  const evidence = (
    rows: readonly AgriTopRecipient[] | undefined = TOP,
    noEikPct: number | null = 49.3,
    lang: "bg" | "en" = "bg",
  ) =>
    subsidiesHubEvidence(
      rows,
      noEikPct,
      WINDOW,
      lang === "bg" ? "bg" : "en",
      lang === "bg",
      tFor(lang === "bg" ? bgCorpus : enCorpus),
    );

  it("ranks the largest recipients, each row to its own farm page", () => {
    const e = evidence()!;
    expect(e.rows).toHaveLength(5);
    expect(e.rows[0].label).toBe("Златия Агро ЕООД");
    expect(nbsp(e.rows[0].value)).toBe("€7,9 млн.");
    for (const r of e.rows) expect(String(r.to)).toMatch(/^\/farm\/\d+$/);
    // Keyed on ЕИК — two companies can share a name.
    expect(new Set(e.rows.map((r) => r.id)).size).toBe(5);
    // Descending, or it is not a ranking.
    const amounts = TOP.map((r) => r.totalEur);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it("NEVER renders a row's year span beside its money", () => {
    // ⚠️ `totalEur` follows the scope; `firstYear`/`lastYear`/`yearCount` do not. Златия
    // Агро is €7.9m on the 2025 payload and €38.57m on `all`, with 2015-2025 / 8 on BOTH —
    // so a row pairing the two reads „€7.9m over eight years", wrong by ~5×.
    const rendered = evidence()!
      .rows.map((r) => `${r.label} ${r.value}`)
      .join(" ");
    for (const token of ["2015", "2025", "8 г", "years"])
      expect(rendered, `the aside leaked the un-scoped ${token}`).not.toContain(
        token,
      );
  });

  it("discloses that only the traceable half is ranked", () => {
    // ⚠️⚠️ THE POINT OF THE CAPTION. 49,3% of the money is on rows with no ЕИК and cannot be
    // attributed to a recipient at all — those beneficiaries are absent from this ranking by
    // construction, not by size. „Най-големи получатели" without that is a claim about the
    // whole corpus made from half of it.
    const e = evidence()!;
    expect(e.basis).toContain(WINDOW);
    expect(e.basis).toContain("49,3%");
    expect(e.basis).toMatch(/само получателите с ЕИК/);
    expect(e.basis).toMatch(/не се приписват на никого/);
    expect(evidence(TOP, 49.3, "en")!.basis).toMatch(
      /only recipients with an EIK are ranked/,
    );
  });

  it("REFUSES the list when it cannot state what it leaves out", () => {
    expect(evidence(TOP, null)).toBeUndefined();
    expect(evidence([], 49.3)).toBeUndefined();
    // ⚠️ Direct, not through `evidence` — a default parameter fires on an EXPLICIT
    // `undefined` too, so `evidence(undefined, …)` would silently become `evidence(TOP, …)`
    // and this assertion would test the opposite of its name.
    expect(
      subsidiesHubEvidence(undefined, 49.3, WINDOW, "bg", true, tFor(bgCorpus)),
    ).toBeUndefined();
    // Non-vacuity: the same call DOES build a list from real rows.
    expect(
      subsidiesHubEvidence(TOP, 49.3, WINDOW, "bg", true, tFor(bgCorpus)),
    ).toBeTruthy();
  });

  it("shares no value with the band", () => {
    const bandValues = new Set(build().map((k) => nbsp(k.value)));
    for (const r of evidence()!.rows)
      expect(bandValues.has(nbsp(r.value))).toBe(false);
  });

  it("says municipalities and state bodies are in the ranking", () => {
    // ⚠️⚠️ WITHOUT THIS THE HEAD ASSERTS SOMETHING THAT DID NOT HAPPEN. On ?pscope=y:2016
    // the five loudest names under „Най-големи получатели" are ALL town halls, beneath a
    // deck saying „кой получава публичните пари за ЗЕМЕДЕЛИЕ" — so the page reads „Община
    // Сатовча получи €6,4 млн. земеделски субсидии". The money is real Rural Development
    // Programme money; the sentence a reader assembles is not. Asserted on the 2016 rows
    // because the default-scope fixture is the one shape where the list looks like farms.
    const e = evidence(TOP_2016)!;
    expect(e.rows.every((r) => r.label.toLowerCase().includes("общин"))).toBe(
      true,
    );
    expect(e.basis).toMatch(/общини и държавни органи/);
    expect(evidence(TOP_2016, 31.8, "en")!.basis).toMatch(
      /municipalities and state bodies/,
    );
  });

  it("offers a way to the full list", () => {
    // The action is the aside's only route past five rows, and nothing asserted it.
    const e = evidence()!;
    expect(String(e.action?.to)).toBe("/subsidies/recipients");
    expect(e.action?.label).toBe(bgCorpus.subsidies_evidence_action);
    expect(e.heading).toBe(bgCorpus.subsidies_evidence_heading);
  });

  it("caps the list at five, however many the payload carries", () => {
    // ⚠️ The payload holds SIXTY rows. `toHaveLength(5)` against a 5-row fixture cannot
    // tell `rows.slice(0, 5)` from a bare `rows` — measured, deleting the cap shipped a
    // 60-row aside with every unit gate green.
    const many = [...TOP, ...TOP_2016, ...TOP, ...TOP_2016];
    expect(many.length).toBeGreaterThan(5);
    expect(evidence(many)!.rows).toHaveLength(5);
  });
});
