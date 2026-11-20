// Gate for the /sector/health hub registry (docs/plans/health-hub-v1.md T3).
// Every failure it catches is silent at build time and loud on the page: a dead
// link, a missing scene, a repeated accent, a whole-corpus tile landing on one
// parliament's slice, a #fragment the destination never renders, a ?universe the
// procurement page drops.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HEALTH_BANDS,
  HEALTH_FRAGMENTS,
  HEALTH_HUB_COPY,
  HEALTH_PATHS,
  HEALTH_TILES,
} from "./healthRegistry";
import { HEALTH_SCENES } from "./healthScenes";
import { HEALTH_BAND_TILES, HEALTH_KPI_TO } from "./healthHubFigures";
import { parseUniverse } from "./healthSectorData";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { HEALTH_UNIVERSES } from "@/lib/healthReferenceData";
import { HEALTH_UNIVERSE_PARAMS } from "@/lib/healthPaths";

const read = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

const routedPaths = (): Set<string> =>
  new Set(
    [...read("src/routes.tsx").matchAll(/path="([^"]+)"/g)].map((m) =>
      m[1].replace(/^\//, ""),
    ),
  );

/** Every link the hub emits — tiles AND band cells. */
const LINKS: { id: string; to: string }[] = [
  ...HEALTH_TILES.map((t) => ({ id: t.id, to: t.to })),
  ...Object.entries(HEALTH_KPI_TO).map(([id, to]) => ({ id: `kpi:${id}`, to })),
];

const params = (to: string) =>
  new URLSearchParams(to.split("#")[0].split("?")[1] ?? "");

const PAGE_SOURCE: Record<string, string> = {
  [HEALTH_PATHS.hospitals]: "src/screens/health/HealthHospitalsScreen.tsx",
  [HEALTH_PATHS.drugs]: "src/screens/health/HealthDrugsScreen.tsx",
  [HEALTH_PATHS.procurement]: "src/screens/health/HealthProcurementScreen.tsx",
  [HEALTH_PATHS.money]: "src/screens/health/HealthMoneyScreen.tsx",
};

/** Only /procurement carries a ScopeControl; the other three are „без период"
 *  and must NOT carry ?pscope. */
const SCOPED: string[] = [HEALTH_PATHS.procurement];

describe("the health hub registry", () => {
  it("has four tiles in every band", () => {
    expect(HEALTH_BANDS).toHaveLength(3);
    for (const b of HEALTH_BANDS) expect(b.tiles.length).toBe(4);
  });

  it("gives every tile a scene, and no scene without a tile", () => {
    const ids = new Set(HEALTH_TILES.map((t) => t.id));
    for (const t of HEALTH_TILES)
      expect(HEALTH_SCENES[t.id], `no scene for ${t.id}`).toBeTypeOf(
        "function",
      );
    for (const id of Object.keys(HEALTH_SCENES))
      expect(ids.has(id), `scene ${id} has no tile`).toBe(true);
  });

  it("names every copy key it uses, in both languages", () => {
    for (const b of HEALTH_BANDS)
      for (const k of [
        b.labelKey,
        b.descKey,
        ...b.tiles.flatMap((t) => [t.titleKey, t.descKey]),
      ]) {
        expect(HEALTH_HUB_COPY[k]?.bg, k).toBeTruthy();
        expect(HEALTH_HUB_COPY[k]?.en, k).toBeTruthy();
      }
  });

  it("uses unique ids and each accent once", () => {
    const ids = HEALTH_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const accents = HEALTH_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("routes the hub and its sub-pages as LITERALS ahead of sector/:id", () => {
    const src = read("src/routes.tsx");
    const routed = routedPaths();
    const generic = src.indexOf('path="sector/:id"');
    expect(generic).toBeGreaterThan(-1);
    for (const p of Object.values(HEALTH_PATHS)) {
      expect(routed.has(p.slice(1)), p).toBe(true);
      expect(src.indexOf(`path="${p.slice(1)}"`), p).toBeLessThan(generic);
    }
  });

  it("points every link at a registered route, and every sub-page is linked", () => {
    const routed = routedPaths();
    for (const l of LINKS) {
      const bare = l.to.slice(1).split(/[?#]/)[0];
      expect(routed.has(bare), `${l.id} → unrouted /${bare}`).toBe(true);
    }
    const linked = new Set(LINKS.map((l) => l.to.split(/[?#]/)[0]));
    for (const p of Object.values(HEALTH_PATHS).filter(
      (p) => p !== HEALTH_PATHS.hub,
    ))
      expect(linked.has(p), `${p} is not reachable from the hub`).toBe(true);
  });

  it("forces ?pscope=all on every scoped destination, and only there", () => {
    for (const l of LINKS) {
      const p = l.to.split(/[?#]/)[0];
      const scoped =
        p.startsWith("/procurement/") ||
        p.startsWith("/awarder/") ||
        SCOPED.includes(p);
      if (scoped)
        expect(params(l.to).get("pscope"), `${l.id} lacks ?pscope=all`).toBe(
          "all",
        );
      else expect(params(l.to).get("pscope"), l.id).toBeNull();
    }
  });

  it("emits only ?universe values the procurement page accepts", () => {
    for (const l of LINKS) {
      const u = params(l.to).get("universe");
      if (u == null) continue;
      expect(parseUniverse(u), `${l.id}: ?universe=${u}`).toBe(u);
      expect(l.to.split(/[?#]/)[0], l.id).toBe(HEALTH_PATHS.procurement);
    }
  });

  it("keeps the import-free universe list equal to the register's", () => {
    expect([...HEALTH_UNIVERSE_PARAMS].sort()).toEqual(
      [...HEALTH_UNIVERSES].sort(),
    );
    expect(parseUniverse("nonsense")).toBeNull();
    expect(parseUniverse(null)).toBeNull();
    for (const u of HEALTH_UNIVERSES) expect(parseUniverse(u)).toBe(u);
  });

  it("emits only ?sector values the browse packs resolve", () => {
    for (const l of LINKS) {
      const sector = params(l.to).get("sector");
      if (sector) expect(SECTOR_BROWSE_PACKS[sector], l.id).toBeTruthy();
    }
  });

  it("links only #fragments the destination renders, from the plan's set", () => {
    let seen = 0;
    for (const l of LINKS) {
      const hash = l.to.split("#")[1];
      if (!hash) continue;
      const page = l.to.split(/[?#]/)[0];
      const file = PAGE_SOURCE[page];
      expect(file, `${l.id}: no source for ${page}`).toBeTruthy();
      seen++;
      expect(read(file), `${l.id}: #${hash} is not rendered`).toContain(
        `id="${hash}"`,
      );
      expect(
        HEALTH_FRAGMENTS[page as keyof typeof HEALTH_FRAGMENTS] as
          | readonly string[]
          | undefined,
        `${l.id}: #${hash} is not a §3 id`,
      ).toContain(hash);
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("renders every §3 fragment on its sub-page", () => {
    for (const [page, ids] of Object.entries(HEALTH_FRAGMENTS))
      for (const id of ids)
        expect(read(PAGE_SOURCE[page]), `${page}#${id}`).toContain(
          `id="${id}"`,
        );
  });

  it("gives no tile the same destination as a band cell", () => {
    const kpi = new Set<string>(Object.values(HEALTH_KPI_TO));
    const clash = HEALTH_TILES.filter((t) => kpi.has(t.to)).map((t) => t.id);
    expect(clash.sort()).toEqual([...HEALTH_BAND_TILES].sort());
  });
});
