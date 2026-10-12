// Gate for the /water hub registry (docs/plans/water-hub-v1.md T3).
// Every failure it catches is silent at build time and loud on the page: a dead
// link, a missing scene (white screen), a repeated accent, a ?param the
// destination drops, a whole-corpus tile landing on one parliament's slice, a
// #fragment the destination never renders, a tile promising an unbuilt dataset.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WATER_BANDS,
  WATER_HUB_COPY,
  WATER_PATHS,
  WATER_TILES,
} from "./waterRegistry";
import { WATER_SCENES } from "./waterScenes";
import { WATER_KPI_TO } from "./waterHubFigures";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { WATER_SECTOR_EIKS } from "@/lib/vikReferenceData";

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
  ...WATER_TILES.map((t) => ({ id: t.id, to: t.to })),
  ...Object.entries(WATER_KPI_TO).map(([id, to]) => ({ id: `kpi:${id}`, to })),
];

const params = (to: string) =>
  new URLSearchParams(to.split("#")[0].split("?")[1] ?? "");

/** Each sub-page's source, for the #fragment check. */
const PAGE_SOURCE: Record<string, string[]> = {
  [WATER_PATHS.operators]: ["src/screens/water/WaterOperatorsScreen.tsx"],
  [WATER_PATHS.procurement]: ["src/screens/water/WaterProcurementScreen.tsx"],
  [WATER_PATHS.services]: ["src/screens/water/WaterServicesScreen.tsx"],
};

/** Sub-pages whose figures follow ?pscope. services and funds are „без
 *  период" and must NOT carry it — it would read as a filter they ignore. */
const SCOPED = [
  WATER_PATHS.operators,
  WATER_PATHS.procurement,
  WATER_PATHS.floods,
];

describe("the water hub registry", () => {
  it("has four tiles in every band", () => {
    for (const b of WATER_BANDS) expect(b.tiles.length).toBe(4);
  });

  it("gives every tile a scene, and no scene without a tile", () => {
    const ids = new Set(WATER_TILES.map((t) => t.id));
    for (const t of WATER_TILES)
      expect(WATER_SCENES[t.id], `no scene for ${t.id}`).toBeTypeOf("function");
    for (const id of Object.keys(WATER_SCENES))
      expect(ids.has(id), `scene ${id} has no tile`).toBe(true);
  });

  it("names every copy key it uses, in both languages", () => {
    for (const b of WATER_BANDS) {
      for (const k of [
        b.labelKey,
        b.descKey,
        ...b.tiles.flatMap((t) => [t.titleKey, t.descKey]),
      ]) {
        expect(WATER_HUB_COPY[k]?.bg, k).toBeTruthy();
        expect(WATER_HUB_COPY[k]?.en, k).toBeTruthy();
      }
    }
  });

  it("uses unique ids and each accent once", () => {
    const ids = WATER_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const accents = WATER_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("points every link at a REGISTERED route", () => {
    const routed = routedPaths();
    for (const l of LINKS) {
      const bare = l.to.slice(1).split(/[?#]/)[0];
      expect(isRouted(routed, bare), `${l.id} → unrouted /${bare}`).toBe(true);
    }
  });

  it("routes the hub and its sub-pages as LITERALS, and every sub-page is linked", () => {
    const routed = routedPaths();
    for (const p of Object.values(WATER_PATHS))
      expect(routed.has(p.slice(1)), p).toBe(true);
    const linked = new Set(LINKS.map((l) => l.to.split(/[?#]/)[0]));
    for (const p of Object.values(WATER_PATHS).filter(
      (p) => p !== WATER_PATHS.hub,
    ))
      expect(linked.has(p), `${p} is not reachable from the hub`).toBe(true);
  });

  it("forces ?pscope=all on every scoped destination, and only there", () => {
    for (const l of LINKS) {
      const p = l.to.split(/[?#]/)[0];
      const scoped =
        p.startsWith("/procurement/") ||
        p.startsWith("/awarder/") ||
        (SCOPED as string[]).includes(p);
      if (scoped)
        expect(params(l.to).get("pscope"), `${l.id} lacks ?pscope=all`).toBe(
          "all",
        );
      else expect(params(l.to).get("pscope"), `${l.id}`).toBeNull();
    }
  });

  it("emits only ?sector values the browse packs resolve", () => {
    for (const l of LINKS) {
      const sector = params(l.to).get("sector");
      if (sector) expect(SECTOR_BROWSE_PACKS[sector], l.id).toBeTruthy();
    }
  });

  it("the water browse pack opens onto the hub's count basis (G1)", () => {
    const pack = SECTOR_BROWSE_PACKS.water;
    expect(pack.excludeConsortiumMembers).toBe(true);
    expect([...pack.eiks].sort()).toEqual([...WATER_SECTOR_EIKS].sort());
  });

  it("links only #fragments the destination renders", () => {
    for (const l of LINKS) {
      const hash = l.to.split("#")[1];
      if (!hash) continue;
      const files = PAGE_SOURCE[l.to.split(/[?#]/)[0]];
      expect(files, `${l.id}: no source registered for its page`).toBeTruthy();
      const src = files.map(read).join("\n");
      expect(src, `${l.id}: #${hash} is not rendered`).toContain(
        `id="${hash}"`,
      );
    }
  });

  it("gives no tile the same destination as a band cell", () => {
    const kpi = new Set<string>(Object.values(WATER_KPI_TO));
    const clash = WATER_TILES.filter((t) => kpi.has(t.to)).map((t) => t.id);
    // Those tiles must be descriptor-only — WATER_BAND_TILES lists them.
    expect(clash.sort()).toEqual(["competition", "funds", "rationing"]);
  });

  it("promises no dataset that is not built (plan §5)", () => {
    const copy = JSON.stringify(WATER_HUB_COPY).toLowerCase();
    expect(copy).not.toMatch(
      /язовир|reservoir|загуби|water loss|тарифи|tariff|риск от наводн|flood risk/,
    );
  });
});
