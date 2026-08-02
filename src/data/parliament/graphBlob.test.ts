import { describe, it, expect } from "vitest";
import {
  blobToView,
  blobStats,
  buildMatrixLookup,
  cellKey,
  facetAxes,
  partyAxes,
  blobStrongestPairs,
  blobTopPeople,
  blobTopCompanies,
  bfsPath,
  personNodeId,
  companyNodeId,
  facetColor,
  partyColor,
  type GraphGlobalBlob,
} from "./graphBlob";

// A tiny fixture: 3 people (2 politicians of different parties + 1 executive), 2 companies. Person 1
// and 2 share company A; person 2 and 3 share company B. Person 1 never touches company B.
const blob: GraphGlobalBlob = {
  meta: { audience: "public", companyCap: 150, bridgeCompaniesTotal: 42 },
  companies: [
    { eik: "A", name: "Alpha OOD", money: 1000, officers: 2 },
    { eik: "B", name: "Beta EOOD", money: 500, officers: 2 },
  ],
  persons: [
    {
      id: 1,
      slug: "ivan",
      name: "Иван",
      facet: "politician",
      money: 900,
      degree: 1,
      party: "ГЕРБ",
      partyColor: "#00f",
    },
    {
      id: 2,
      slug: "petar",
      name: "Петър",
      facet: "politician",
      money: 800,
      degree: 2,
      party: "БСП",
      partyColor: "#f00",
    },
    {
      id: 3,
      slug: "mara",
      name: "Мара",
      facet: "executive",
      money: 700,
      degree: 1,
      party: null,
      partyColor: null,
    },
  ],
  edges: [
    { p: 1, c: "A", kind: "tr_owner" },
    { p: 2, c: "A", kind: "tr_role" },
    { p: 2, c: "B", kind: "tr_owner" },
    { p: 3, c: "B", kind: "tr_role" },
  ],
  matrix: [
    { a: "executive", b: "politician", companies: 1 },
    { a: "politician", b: "politician", companies: 1 },
  ],
  partyMatrix: [{ a: "БСП", b: "ГЕРБ", companies: 1 }],
  partyColors: { ГЕРБ: "#00f", БСП: "#f00" },
};

describe("blobToView", () => {
  it("maps persons + companies to view nodes, edges person→company", () => {
    const v = blobToView(blob);
    expect(v.nodes).toHaveLength(5);
    expect(v.edges).toHaveLength(4);
    const ivan = v.nodes.find((n) => n.id === personNodeId("ivan"))!;
    expect(ivan.kind).toBe("person");
    expect(ivan.color).toBe(facetColor("politician"));
    expect(ivan.slug).toBe("ivan");
    const alpha = v.nodes.find((n) => n.id === companyNodeId("A"))!;
    expect(alpha.kind).toBe("company");
    expect(alpha.eik).toBe("A");
    // every edge endpoint resolves to a node
    const ids = new Set(v.nodes.map((n) => n.id));
    for (const e of v.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("drops edges whose endpoints are missing (defensive)", () => {
    const broken: GraphGlobalBlob = {
      ...blob,
      edges: [
        ...blob.edges,
        { p: 99, c: "A", kind: "tr_role" },
        { p: 1, c: "Z", kind: "tr_role" },
      ],
    };
    expect(blobToView(broken).edges).toHaveLength(4);
  });
});

describe("blobStats", () => {
  it("derives the hero counts", () => {
    expect(blobStats(blob)).toEqual({
      bridgeCompanies: 2,
      bridgeCompaniesTotal: 42,
      publicFigures: 3,
      edges: 4,
    });
  });
});

describe("matrix lookup", () => {
  it("cellKey is canonical (unordered)", () => {
    expect(cellKey("b", "a")).toBe(cellKey("a", "b"));
  });
  it("buildMatrixLookup resolves cells symmetrically and reports max", () => {
    const m = buildMatrixLookup(blob.matrix);
    expect(m.get("politician", "executive")).toBe(1);
    expect(m.get("executive", "politician")).toBe(1);
    expect(m.get("magistrate", "politician")).toBe(0);
    expect(m.max).toBe(1);
  });
  it("facetAxes keeps FACET_ORDER, party axes lead with busiest self-tie", () => {
    expect(facetAxes(blob)).toEqual(["politician", "executive"]);
    expect(partyAxes(blob)).toEqual(["БСП", "ГЕРБ"]);
  });
  it("partyColor resolves from the palette and falls back deterministically", () => {
    expect(partyColor(blob, "ГЕРБ")).toBe("#00f");
    expect(partyColor(blob, "НЕЗАВИСИМ")).toBe("#94a3b8"); // not in palette → fallback
    expect(partyColor(blob, null)).toBe("#94a3b8");
  });
  it("party axes lead with the busiest self-tie, not alphabetical (TEST-001)", () => {
    const b: GraphGlobalBlob = {
      ...blob,
      partyMatrix: [
        { a: "ГЕРБ", b: "ГЕРБ", companies: 5 },
        { a: "БСП", b: "БСП", companies: 1 },
        { a: "БСП", b: "ГЕРБ", companies: 2 },
      ],
    };
    // 5 > 1 puts ГЕРБ first despite А-Я order putting Б before Г.
    expect(partyAxes(b)).toEqual(["ГЕРБ", "БСП"]);
  });
});

describe("tiebreaks (TEST-002)", () => {
  // Equal money forces the secondary keys to run.
  const tie: GraphGlobalBlob = {
    ...blob,
    persons: [
      { ...blob.persons[0], id: 2, money: 100, degree: 1 },
      { ...blob.persons[1], id: 1, money: 100, degree: 3 },
    ],
    companies: [
      { eik: "B", name: null, money: 100, officers: 1 },
      { eik: "A", name: "A", money: 100, officers: 1 },
    ],
    edges: [],
    partyMatrix: [],
  };
  it("blobTopPeople breaks money ties by degree then id", () => {
    // both money 100 → higher degree (id 1, degree 3) leads; then id.
    expect(blobTopPeople(tie).map((p) => p.id)).toEqual([1, 2]);
  });
  it("blobTopCompanies breaks money ties by eik", () => {
    expect(blobTopCompanies(tie).map((c) => c.eik)).toEqual(["A", "B"]);
  });
  it("blobStrongestPairs orders by shared count, then shared money", () => {
    // person 1 & 2 share A(money 300) once; person 1 & 3 share two companies B,C.
    const b: GraphGlobalBlob = {
      ...blob,
      companies: [
        { eik: "A", name: "A", money: 300, officers: 2 },
        { eik: "B", name: "B", money: 10, officers: 2 },
        { eik: "C", name: "C", money: 10, officers: 2 },
      ],
      edges: [
        { p: 1, c: "A", kind: "tr_owner" },
        { p: 2, c: "A", kind: "tr_role" },
        { p: 1, c: "B", kind: "tr_owner" },
        { p: 3, c: "B", kind: "tr_role" },
        { p: 1, c: "C", kind: "tr_owner" },
        { p: 3, c: "C", kind: "tr_role" },
      ],
    };
    const pairs = blobStrongestPairs(b);
    // (1,3) shares 2 companies → leads over (1,2) which shares 1, despite lower money.
    expect(pairs[0].a.id).toBe(1);
    expect(pairs[0].b.id).toBe(3);
    expect(pairs[0].shared.length).toBe(2);
  });
});

describe("fallbacks (TEST-003)", () => {
  it("facetColor(null) is the neutral grey", () => {
    expect(facetColor(null)).toBe("#737373");
    expect(facetColor(undefined)).toBe("#737373");
  });
  it("a null-name company node labels by eik", () => {
    const b: GraphGlobalBlob = {
      ...blob,
      companies: [{ eik: "999", name: null, money: 0, officers: 1 }],
      edges: [],
    };
    const node = blobToView(b).nodes.find(
      (n) => n.id === companyNodeId("999"),
    )!;
    expect(node.label).toBe("999");
  });
});

describe("blobStrongestPairs", () => {
  it("derives person pairs sharing a company, with cross-party flag", () => {
    const pairs = blobStrongestPairs(blob);
    // (1,2) share A; (2,3) share B. (1,3) share nothing.
    expect(pairs).toHaveLength(2);
    const p12 = pairs.find((p) => p.a.id === 1 && p.b.id === 2)!;
    expect(p12.shared.map((c) => c.eik)).toEqual(["A"]);
    expect(p12.crossParty).toBe(true); // ГЕРБ vs БСП
    const p23 = pairs.find((p) => p.a.id === 2 && p.b.id === 3)!;
    expect(p23.crossParty).toBe(false); // person 3 has no party
    // no self-pair, no (1,3)
    expect(pairs.some((p) => p.a.id === 1 && p.b.id === 3)).toBe(false);
  });
});

describe("rankings", () => {
  it("top people by money desc, top companies by money desc", () => {
    expect(blobTopPeople(blob).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(blobTopCompanies(blob).map((c) => c.eik)).toEqual(["A", "B"]);
  });
});

describe("bfsPath", () => {
  const v = blobToView(blob);
  it("finds the person→company→person→company→person trail", () => {
    const path = bfsPath(v, personNodeId("ivan"), personNodeId("mara"));
    // ivan -A- petar -B- mara
    expect(path).toEqual([
      personNodeId("ivan"),
      companyNodeId("A"),
      personNodeId("petar"),
      companyNodeId("B"),
      personNodeId("mara"),
    ]);
  });
  it("returns [from] when from===to and null when unreachable", () => {
    expect(bfsPath(v, personNodeId("ivan"), personNodeId("ivan"))).toEqual([
      personNodeId("ivan"),
    ]);
    const isolated = blobToView({ ...blob, edges: [] });
    expect(
      bfsPath(isolated, personNodeId("ivan"), personNodeId("mara")),
    ).toBeNull();
  });
});
