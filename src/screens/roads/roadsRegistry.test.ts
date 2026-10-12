// Gate for the /sector/roads hub registry (docs/plans/roads-hub-v1.md T4).
// Every failure it catches is silent at build time and loud on the page: a dead
// link, a missing scene (white screen), a repeated accent, a ?param the
// destination drops, a whole-corpus tile landing on one parliament's slice, a
// risk grade the corpus does not have, a #fragment the destination never renders.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ROADS_BANDS,
  ROADS_HUB_COPY,
  ROADS_PATHS,
  ROADS_TILES,
} from "./roadsRegistry";
import { ROADS_SCENES } from "./roadsScenes";
import { ROADS_KPI_TO } from "./roadsHubFigures";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { ROADS_SECTOR_EIKS } from "@/lib/roadsReferenceData";

const read = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

const routedPaths = (): Set<string> =>
  new Set(
    [...read("src/routes.tsx").matchAll(/path="([^"]+)"/g)].map((m) =>
      m[1].replace(/^\//, ""),
    ),
  );

const isRouted = (routed: Set<string>, bare: string) =>
  routed.has(bare) ||
  [...routed].some(
    (r) =>
      r.includes(":") &&
      new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`).test(bare),
  );

/** Every link the hub emits — tiles AND band cells. */
const LINKS: { id: string; to: string }[] = [
  ...ROADS_TILES.map((t) => ({ id: t.id, to: t.to })),
  ...Object.entries(ROADS_KPI_TO).map(([id, to]) => ({ id: `kpi:${id}`, to })),
];

const params = (to: string) =>
  new URLSearchParams(to.split("#")[0].split("?")[1] ?? "");

describe("the roads hub registry", () => {
  it("has four tiles in every band", () => {
    for (const b of ROADS_BANDS) expect(b.tiles.length).toBe(4);
  });

  it("gives every tile a scene, and no scene without a tile", () => {
    const ids = new Set(ROADS_TILES.map((t) => t.id));
    for (const t of ROADS_TILES)
      expect(ROADS_SCENES[t.id], `no scene for ${t.id}`).toBeTypeOf("function");
    for (const id of Object.keys(ROADS_SCENES))
      expect(ids.has(id), `scene ${id} has no tile`).toBe(true);
  });

  it("names every copy key it uses", () => {
    for (const b of ROADS_BANDS) {
      expect(ROADS_HUB_COPY[b.labelKey]).toBeTruthy();
      expect(ROADS_HUB_COPY[b.descKey]).toBeTruthy();
      for (const t of b.tiles) {
        expect(ROADS_HUB_COPY[t.titleKey], t.titleKey).toBeTruthy();
        expect(ROADS_HUB_COPY[t.descKey], t.descKey).toBeTruthy();
      }
    }
  });

  it("uses unique ids and each accent once", () => {
    const ids = ROADS_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const accents = ROADS_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("points every link at a REGISTERED route", () => {
    const routed = routedPaths();
    for (const l of LINKS) {
      const bare = l.to.slice(1).split(/[?#]/)[0];
      expect(isRouted(routed, bare), `${l.id} → unrouted /${bare}`).toBe(true);
    }
  });

  it("routes the hub and its sub-pages as LITERALS, never a splat", () => {
    const routed = routedPaths();
    for (const p of Object.values(ROADS_PATHS))
      expect(routed.has(p.slice(1)), p).toBe(true);
  });

  it("forces ?pscope=all on every scoped destination", () => {
    // The hub is whole-corpus; these pages default to the selected parliament.
    for (const l of LINKS) {
      const p = l.to.split(/[?#]/)[0];
      const scoped =
        p.startsWith("/procurement/") ||
        p.startsWith("/sector/roads/") ||
        p.startsWith("/awarder/");
      if (scoped)
        expect(params(l.to).get("pscope"), `${l.id} lacks ?pscope=all`).toBe(
          "all",
        );
    }
  });

  it("emits only ?sector values the browse packs resolve", () => {
    for (const l of LINKS) {
      const sector = params(l.to).get("sector");
      if (sector) expect(SECTOR_BROWSE_PACKS[sector], l.id).toBeTruthy();
    }
  });

  it("the roads browse pack opens onto the hub's count basis", () => {
    // The hub counts ex-member rows (the engine skips consortium members); the
    // ?sector=roads browser must too. roads_hub_figures.data.test.ts runs the
    // engine with this filter set and compares the count to the blob.
    const pack = SECTOR_BROWSE_PACKS.roads;
    expect(pack.excludeConsortiumMembers).toBe(true);
    expect([...pack.eiks].sort()).toEqual([...ROADS_SECTOR_EIKS].sort());
  });

  it("emits only risk grades the roads corpus has (no F)", () => {
    for (const l of LINKS) {
      const grade = params(l.to).get("grade");
      if (!grade) continue;
      for (const g of grade.split(","))
        expect(["A", "B", "C", "D", "E"], `${l.id}: grade ${g}`).toContain(g);
    }
  });

  it("links only #fragments the procurement page renders", () => {
    const page = [
      read("src/screens/roads/RoadsProcurementScreen.tsx"),
      read("src/screens/components/procurement/roads/RoadAnnexOptionsTile.tsx"),
    ].join("\n");
    for (const l of LINKS) {
      const hash = l.to.split("#")[1];
      if (!hash) continue;
      expect(l.to.startsWith(ROADS_PATHS.procurement), l.id).toBe(true);
      expect(page, `#${hash} is not rendered`).toContain(`id="${hash}"`);
    }
  });

  it("gives no tile the same destination as a band cell", () => {
    const kpi = new Set<string>(Object.values(ROADS_KPI_TO));
    const clash = ROADS_TILES.filter((t) => kpi.has(t.to)).map((t) => t.id);
    // Those tiles must be descriptor-only — ROADS_BAND_TILES lists them.
    expect(clash.sort()).toEqual(["competition", "contractors"]);
  });
});
