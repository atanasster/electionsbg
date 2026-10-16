// Gate for the /sector/transport hub registry (docs/plans/transport-hub-v1.md T3).
// Every failure it catches is silent at build time and loud on the page: a dead
// link, a missing scene (white screen), a repeated accent, a ?param the
// destination drops, a whole-corpus tile landing on one parliament's slice, a
// #fragment the destination never renders (C6), a ?mode the page rejects.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  TRANSPORT_BANDS,
  TRANSPORT_HUB_COPY,
  TRANSPORT_PATHS,
  TRANSPORT_TILES,
} from "./transportRegistry";
import { TRANSPORT_SCENES } from "./transportScenes";
import { TRANSPORT_BAND_TILES, TRANSPORT_KPI_TO } from "./transportHubFigures";
import { parseTransportMode } from "./transportMode";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import { TRANSPORT_SECTOR_EIKS } from "@/lib/transportReferenceData";

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
  ...TRANSPORT_TILES.map((t) => ({ id: t.id, to: t.to })),
  ...Object.entries(TRANSPORT_KPI_TO).map(([id, to]) => ({
    id: `kpi:${id}`,
    to,
  })),
];

const params = (to: string) =>
  new URLSearchParams(to.split("#")[0].split("?")[1] ?? "");

/** Each sub-page's source, for the #fragment check. */
const PAGE_SOURCE: Record<string, string> = {
  [TRANSPORT_PATHS.network]: "src/screens/transport/TransportNetworkScreen.tsx",
  [TRANSPORT_PATHS.procurement]:
    "src/screens/transport/TransportProcurementScreen.tsx",
  [TRANSPORT_PATHS.bodies]: "src/screens/transport/TransportBodiesScreen.tsx",
  [TRANSPORT_PATHS.money]: "src/screens/transport/TransportMoneyScreen.tsx",
};

/** Sub-pages whose figures follow ?pscope. /money is „без период" and must NOT
 *  carry it — it would read as a filter it does not apply. */
const SCOPED: string[] = [
  TRANSPORT_PATHS.network,
  TRANSPORT_PATHS.procurement,
  TRANSPORT_PATHS.bodies,
];

/** The plan's §3 fragment set, and ONLY it (C6). */
const PLAN_FRAGMENTS: Record<string, string[]> = {
  [TRANSPORT_PATHS.network]: ["map"],
  [TRANSPORT_PATHS.procurement]: [
    "spine",
    "modes",
    "categories",
    "competition",
    "contractors",
    "top-contracts",
    "direct",
    "risk",
  ],
  [TRANSPORT_PATHS.bodies]: ["map"],
  [TRANSPORT_PATHS.money]: [
    "budget",
    "subsidy",
    "funds",
    "peers",
    "road-safety",
  ],
};

describe("the transport hub registry", () => {
  it("has four tiles in every band", () => {
    expect(TRANSPORT_BANDS).toHaveLength(3);
    for (const b of TRANSPORT_BANDS) expect(b.tiles.length).toBe(4);
  });

  it("gives every tile a scene, and no scene without a tile", () => {
    const ids = new Set(TRANSPORT_TILES.map((t) => t.id));
    for (const t of TRANSPORT_TILES)
      expect(TRANSPORT_SCENES[t.id], `no scene for ${t.id}`).toBeTypeOf(
        "function",
      );
    for (const id of Object.keys(TRANSPORT_SCENES))
      expect(ids.has(id), `scene ${id} has no tile`).toBe(true);
  });

  it("names every copy key it uses, in both languages", () => {
    for (const b of TRANSPORT_BANDS) {
      for (const k of [
        b.labelKey,
        b.descKey,
        ...b.tiles.flatMap((t) => [t.titleKey, t.descKey]),
      ]) {
        expect(TRANSPORT_HUB_COPY[k]?.bg, k).toBeTruthy();
        expect(TRANSPORT_HUB_COPY[k]?.en, k).toBeTruthy();
      }
    }
  });

  it("uses unique ids and each accent once", () => {
    const ids = TRANSPORT_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const accents = TRANSPORT_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("routes the hub and its sub-pages as LITERALS ahead of sector/:id", () => {
    const src = read("src/routes.tsx");
    const routed = routedPaths();
    const generic = src.indexOf('path="sector/:id"');
    expect(generic).toBeGreaterThan(-1);
    for (const p of Object.values(TRANSPORT_PATHS)) {
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
    for (const p of Object.values(TRANSPORT_PATHS).filter(
      (p) => p !== TRANSPORT_PATHS.hub,
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

  it("emits only ?mode values the destination accepts", () => {
    let seen = 0;
    for (const l of LINKS) {
      const mode = params(l.to).get("mode");
      if (mode == null) continue;
      seen++;
      expect(parseTransportMode(mode), `${l.id}: ?mode=${mode}`).toBe(mode);
      expect(l.to.split(/[?#]/)[0], l.id).toBe(TRANSPORT_PATHS.network);
    }
    expect(seen).toBe(3);
  });

  it("emits only ?sector values the browse packs resolve", () => {
    for (const l of LINKS) {
      const sector = params(l.to).get("sector");
      if (sector) expect(SECTOR_BROWSE_PACKS[sector], l.id).toBeTruthy();
    }
  });

  it("the transport browse pack opens onto the hub's count basis (B4)", () => {
    const pack = SECTOR_BROWSE_PACKS.transport;
    expect(pack.excludeConsortiumMembers).toBe(true);
    expect([...pack.eiks].sort()).toEqual([...TRANSPORT_SECTOR_EIKS].sort());
  });

  it("links only #fragments the destination renders, from the plan's set", () => {
    for (const l of LINKS) {
      const hash = l.to.split("#")[1];
      if (!hash) continue;
      const page = l.to.split(/[?#]/)[0];
      const file = PAGE_SOURCE[page];
      expect(file, `${l.id}: no source registered for its page`).toBeTruthy();
      expect(read(file), `${l.id}: #${hash} is not rendered`).toContain(
        `id="${hash}"`,
      );
      expect(
        PLAN_FRAGMENTS[page],
        `${l.id}: #${hash} is not a §3 id`,
      ).toContain(hash);
    }
  });

  it("renders every §3 fragment on its sub-page", () => {
    for (const [page, ids] of Object.entries(PLAN_FRAGMENTS))
      for (const id of ids)
        expect(read(PAGE_SOURCE[page]), `${page}#${id}`).toContain(
          `id="${id}"`,
        );
  });

  it("retires the pack's old fragment ids (C6)", () => {
    const sources = Object.values(PAGE_SOURCE).map(read).join("\n");
    for (const old of [
      "mode-split",
      "rail-subsidy",
      "eu-funds",
      "transport-budget",
      "transport-eu-peers",
      "function",
    ])
      expect(sources, old).not.toContain(`id="${old}"`);
  });

  it("gives no tile the same destination as a band cell", () => {
    const kpi = new Set<string>(Object.values(TRANSPORT_KPI_TO));
    const clash = TRANSPORT_TILES.filter((t) => kpi.has(t.to)).map((t) => t.id);
    // Those tiles must be descriptor-only — TRANSPORT_BAND_TILES lists them.
    expect(clash.sort()).toEqual([...TRANSPORT_BAND_TILES].sort());
  });
});
