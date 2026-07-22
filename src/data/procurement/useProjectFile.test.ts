import { describe, it, expect } from "vitest";
import {
  parseProjectSpec,
  filterCuratedIndex,
  curatedForkHref,
  type ProjectFileSpec,
} from "./useProjectFile";

describe("parseProjectSpec — untrusted ?q= parsing (§4.1)", () => {
  it("accepts a valid spec", () => {
    const raw = JSON.stringify({
      search: [{ terms: "западна дъга", distinctive: ["дъга"] }],
    });
    const s = parseProjectSpec(raw);
    expect(s?.search[0].terms).toBe("западна дъга");
  });

  it("rejects null / bad JSON / non-object", () => {
    expect(parseProjectSpec(null)).toBeNull();
    expect(parseProjectSpec("{not json")).toBeNull();
    expect(parseProjectSpec("42")).toBeNull();
    expect(parseProjectSpec('"a string"')).toBeNull();
  });

  it("rejects a missing or empty search", () => {
    expect(parseProjectSpec(JSON.stringify({}))).toBeNull();
    expect(parseProjectSpec(JSON.stringify({ search: [] }))).toBeNull();
  });

  it("rejects a thread with non-string / empty terms", () => {
    expect(
      parseProjectSpec(JSON.stringify({ search: [{ terms: 5 }] })),
    ).toBeNull();
    expect(
      parseProjectSpec(JSON.stringify({ search: [{ terms: "" }] })),
    ).toBeNull();
    expect(parseProjectSpec(JSON.stringify({ search: [{}] }))).toBeNull();
  });

  it("bounds the include/exclude id-lists (breadth guard)", () => {
    const bigKeys = Array.from({ length: 5000 }, (_, i) => `k${i}`);
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        includes: { contractKeys: bigKeys },
      }),
    );
    expect(s?.includes?.contractKeys?.length).toBeLessThanOrEqual(500);
  });

  it("string-filters + bounds includes.fundContractNumbers (§4.2.3b)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        includes: { fundContractNumbers: [123, "BG16", null, "BG-RRP"] },
      }),
    );
    // non-strings dropped, strings kept
    expect(s?.includes?.fundContractNumbers).toEqual(["BG16", "BG-RRP"]);
    const big = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        includes: {
          fundContractNumbers: Array.from({ length: 5000 }, (_, i) => `f${i}`),
        },
      }),
    );
    expect(big?.includes?.fundContractNumbers?.length).toBeLessThanOrEqual(500);
  });

  it("keeps a valid euFinancing split and coerces its source (§4.2.3b)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        euFinancing: {
          "BG16FFPR003-1.001-0062": {
            euEur: 1789521.58,
            nationalEur: 766937.83,
            source: "ИСУН",
            sourceUrl: "https://2020.eufunds.bg/x",
          },
        },
      }),
    );
    const split = s?.euFinancing?.["BG16FFPR003-1.001-0062"];
    expect(split?.euEur).toBe(1789521.58);
    expect(split?.nationalEur).toBe(766937.83);
    expect(split?.source).toBe("ИСУН");
  });

  it("drops euFinancing entries with no finite figure + a non-object map", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        euFinancing: {
          bad: { euEur: "NaN", nationalEur: null },
          neg: { euEur: -5, nationalEur: -1 },
          ok: { euEur: 10, nationalEur: 0 },
        },
      }),
    );
    // bad (non-numeric) + neg (both negative) dropped; a one-sided real figure kept.
    expect(s?.euFinancing?.bad).toBeUndefined();
    expect(s?.euFinancing?.neg).toBeUndefined();
    expect(s?.euFinancing?.ok).toEqual({ euEur: 10, nationalEur: 0 });
    // A non-object euFinancing must not throw, just vanish.
    const s2 = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], euFinancing: 5 }),
    );
    expect(s2?.euFinancing).toBeUndefined();
  });

  it("caps the number of search threads", () => {
    const many = Array.from({ length: 100 }, () => ({ terms: "x" }));
    const s = parseProjectSpec(JSON.stringify({ search: many }));
    expect(s?.search.length).toBeLessThanOrEqual(20);
  });

  it("preserves multiple threads and their per-thread buyerEik (union recall)", () => {
    // The Hemus dossier ships two buyer-scoped threads (АПИ + НКСИП); both must
    // survive parsing intact so each recalls against its own buyer.
    const s = parseProjectSpec(
      JSON.stringify({
        search: [
          { terms: "хемус", distinctive: ["хемус"], buyerEik: ["000695089"] },
          { terms: "хемус", distinctive: ["хемус"], buyerEik: ["202062287"] },
        ],
      }),
    );
    expect(s?.search).toHaveLength(2);
    expect(s?.search[0].buyerEik).toEqual(["000695089"]);
    expect(s?.search[1].buyerEik).toEqual(["202062287"]);
  });

  it("shape-checks + bounds the untrusted claims[] (§4.2.6b)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        claims: [
          { text: "валидно", verdict: "confirms" },
          { text: "лош вердикт", verdict: "hacked" }, // verdict dropped
          { text: 5 }, // non-string text → dropped
          {}, // no text → dropped
        ],
      }),
    );
    expect(s?.claims).toHaveLength(2);
    expect(s?.claims?.[0].verdict).toBe("confirms");
    expect(s?.claims?.[1].verdict).toBeUndefined();
  });

  it("drops claims[] entirely when none are well-formed", () => {
    const s = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], claims: [{}, { text: 1 }] }),
    );
    expect(s?.claims).toBeUndefined();
  });

  it("caps claims[] at 20", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `c${i}` }));
    const s = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], claims: many }),
    );
    expect(s?.claims?.length).toBeLessThanOrEqual(20);
  });

  it("shape-checks the untrusted advance (§0g.3)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        advance: {
          pctDeclared: 35,
          amountEur: "lots", // non-number → dropped
          physicalProgressNote: { bg: "35% платено, нищо построено", en: {} },
          source: {}, // non-string → dropped
        },
      }),
    );
    expect(s?.advance?.pctDeclared).toBe(35);
    expect(s?.advance?.amountEur).toBeUndefined();
    expect(s?.advance?.physicalProgressNote?.bg).toBe(
      "35% платено, нищо построено",
    );
    expect(s?.advance?.physicalProgressNote?.en).toBeUndefined();
    expect(s?.advance?.source).toBeUndefined();
  });

  it("drops an advance carrying no figure or note", () => {
    const s = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], advance: { source: "x" } }),
    );
    expect(s?.advance).toBeUndefined();
  });

  it("keeps a note-only and an amount-only advance", () => {
    const noteOnly = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        advance: { physicalProgressNote: { bg: "нищо построено" } },
      }),
    );
    expect(noteOnly?.advance?.physicalProgressNote?.bg).toBe("нищо построено");
    const amtOnly = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        advance: { amountEur: 1000 },
      }),
    );
    expect(amtOnly?.advance?.amountEur).toBe(1000);
  });

  it("drops out-of-band advance figures (pct 0–100, amount ≥ 0)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        advance: {
          pctDeclared: -500,
          amountEur: -1,
          physicalProgressNote: { bg: "note" },
        },
      }),
    );
    expect(s?.advance?.pctDeclared).toBeUndefined();
    expect(s?.advance?.amountEur).toBeUndefined();
    // kept only because of the note
    expect(s?.advance?.physicalProgressNote?.bg).toBe("note");
  });

  it("shape-checks knownSubcontractors[] + bounds inhouseAwarderEiks (§0g.2)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        inhouseAwarderEiks: ["831646048", 5], // non-string dropped
        knownSubcontractors: [
          { name: "Нивел строй", eik: "111", amountEur: 413000000 },
          { name: "Bad", amountEur: "lots", source: {} }, // amountEur/source coerced
          { eik: "222" }, // no name → dropped
        ],
      }),
    );
    expect(s?.inhouseAwarderEiks).toEqual(["831646048"]);
    expect(s?.knownSubcontractors).toHaveLength(2);
    expect(s?.knownSubcontractors?.[0].amountEur).toBe(413000000);
    expect(s?.knownSubcontractors?.[1].amountEur).toBeUndefined();
    expect(s?.knownSubcontractors?.[1].source).toBeUndefined();
  });

  it("neutralizes non-string claim fields from untrusted ?q= (no React-child crash)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        claims: [
          {
            text: "ok",
            byWhom: {},
            saidAt: [],
            ourNumber: {},
            sourceUrl: 5,
            note: { bg: {} },
          },
        ],
      }),
    );
    const c = s?.claims?.[0];
    expect(c?.byWhom).toBeUndefined();
    expect(c?.saidAt).toBeUndefined();
    expect(c?.ourNumber).toBeUndefined();
    expect(c?.sourceUrl).toBeUndefined();
    expect(c?.note).toBeUndefined();
  });

  it("keeps a well-formed geo.line and drops invalid points (§10 P3, Tier D)", () => {
    const s = parseProjectSpec(
      JSON.stringify({
        search: [{ terms: "x" }],
        geo: {
          line: [
            [42.7, 23.3],
            [43.0, 24.1],
            [999, 0], // out-of-range lat → dropped
            [42, "x"], // non-number → dropped
            [43.4, 25.9],
          ],
        },
      }),
    );
    expect(s?.geo?.line).toEqual([
      [42.7, 23.3],
      [43.0, 24.1],
      [43.4, 25.9],
    ]);
  });

  it("drops geo entirely when fewer than 2 valid points remain", () => {
    expect(
      parseProjectSpec(
        JSON.stringify({
          search: [{ terms: "x" }],
          geo: {
            line: [
              [42.7, 23.3],
              [999, 999],
            ],
          },
        }),
      )?.geo,
    ).toBeUndefined();
    // Non-array line → dropped.
    expect(
      parseProjectSpec(
        JSON.stringify({ search: [{ terms: "x" }], geo: { line: "nope" } }),
      )?.geo,
    ).toBeUndefined();
  });

  it("bounds a huge geo.line so a hostile ?q= can't blow up the map", () => {
    const many = Array.from({ length: 9000 }, () => [42.7, 23.3]);
    const s = parseProjectSpec(
      JSON.stringify({ search: [{ terms: "x" }], geo: { line: many } }),
    );
    expect(s?.geo?.line.length).toBeLessThanOrEqual(4000);
  });
});

describe("filterCuratedIndex — the curated-flagship gallery guard (Phase 3)", () => {
  it("keeps a well-formed entry (slug + title)", () => {
    const out = filterCuratedIndex([{ slug: "hemus", title: { bg: "Хемус" } }]);
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("hemus");
  });
  it("drops entries missing a slug or a title, so the on-ramp can't crash", () => {
    const out = filterCuratedIndex([
      { slug: "", title: { bg: "x" } } as never, // empty slug
      { slug: "no-title" } as never, // no title
      { slug: "bad-title", title: null } as never, // null title
      { slug: "ok", title: { bg: "ok" } },
    ]);
    expect(out.map((f) => f.slug)).toEqual(["ok"]);
  });
  it("handles undefined / non-array input", () => {
    expect(filterCuratedIndex(undefined)).toEqual([]);
  });
});

describe("a committed curated spec validates through parseProjectSpec (Phase 3)", () => {
  it("accepts a flagship file with curated honesty fields", () => {
    const curated = {
      title: { bg: "Магистрала „Хемус“" },
      thesis: { bg: "…" },
      search: [
        { terms: "хемус", distinctive: ["хемус"], buyerEik: ["000695089"] },
      ],
      inhouseAwarderEiks: ["831646048"],
      verifiedAt: "2026-07-21",
    };
    const s = parseProjectSpec(JSON.stringify(curated));
    expect(s).not.toBeNull();
    expect(s?.inhouseAwarderEiks).toEqual(["831646048"]);
    expect(s?.verifiedAt).toBe("2026-07-21");
  });
});

describe("curatedForkHref — 'start from this example' fork (§4.4)", () => {
  // A representative curated spec carrying the full editorial surface.
  const curated: ProjectFileSpec = {
    title: { bg: "Магистрала „Хемус“", en: "Hemus motorway" },
    thesis: { bg: "теза", en: "thesis" },
    authority: "Агенция „Пътна инфраструктура“",
    sector: "roads",
    search: [
      { terms: "хемус", distinctive: ["хемус"], buyerEik: ["000695089"] },
      { terms: "хемус", distinctive: ["хемус"], buyerEik: ["202062287"] },
    ],
    nature: { abc123: "строителство" },
    includes: { contractKeys: ["k1"] },
    excludes: { tenderUnps: ["u1"] },
    inhouseAwarderEiks: ["831646048"],
    knownSubcontractors: [{ name: "Нивел строй ЕООД" }],
    verifiedAt: "2026-07-22",
    claims: [{ text: "claim", verdict: "confirms" }],
  };

  const forkedSpec = (spec: ProjectFileSpec) => {
    const q = new URL(curatedForkHref(spec), "http://x").searchParams.get("q");
    return parseProjectSpec(q);
  };

  it("carries NO editorial voice (§11) — every editorial field is stripped", () => {
    const forked = forkedSpec(curated);
    expect(forked).not.toBeNull();
    // Guard the WHOLE editorial set so a future field is stripped by default —
    // if someone adds one to the copy, this fails until they justify it.
    for (const k of [
      "thesis",
      "authority",
      "status",
      "announcedBudget",
      "benchmark",
      "advance",
      "gap",
      "recurrence",
      "verifiedAt",
      "claims",
      "inhouseAwarderEiks",
      "knownSubcontractors",
      "geo",
    ] as const) {
      expect(forked?.[k]).toBeUndefined();
    }
  });

  it("keeps the whole search (all threads + per-buyer scope), sector, nature, includes/excludes", () => {
    const forked = forkedSpec(curated);
    expect(forked?.search).toHaveLength(2);
    expect(forked?.search[0].buyerEik).toEqual(["000695089"]);
    expect(forked?.search[1].buyerEik).toEqual(["202062287"]);
    expect(forked?.sector).toBe("roads");
    expect(forked?.nature).toEqual({ abc123: "строителство" });
    expect(forked?.includes?.contractKeys).toEqual(["k1"]);
    expect(forked?.excludes?.tenderUnps).toEqual(["u1"]);
  });

  it("prefixes the title as a copy and opens the editor (&edit=1)", () => {
    const href = curatedForkHref(curated);
    expect(href).toContain("&edit=1");
    const forked = forkedSpec(curated);
    expect(forked?.title?.bg).toBe("Копие: Магистрала „Хемус“");
    expect(forked?.title?.en).toBe("Copy: Hemus motorway");
  });

  it("emits no empty title object when the source has no title", () => {
    const href = curatedForkHref({ search: [{ terms: "x" }] });
    const q = new URL(href, "http://x").searchParams.get("q");
    expect(JSON.parse(q ?? "{}").title).toBeUndefined();
  });
});
