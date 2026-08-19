// Gate for the /culture hub registry.
//
// The defects it catches are all silent at build time and loud on the page:
//
//   DEAD LINK      — a tile aimed at a route that is not registered. No type
//                    system catches it; the reader gets the SPA's not-found.
//                    The plan sketched three tiles (/culture/procurement,
//                    /culture/funds, /culture/institutions) whose pages do not
//                    exist yet, which is exactly this failure written down.
//   MISSING SCENE  — `CULTURE_SCENES[id]` undefined renders `undefined` as a
//                    component and white-screens the whole hub.
//   REPEATED ACCENT— all bands render together, so a repeat reads as „these two
//                    are the same kind of thing".
//   BAD PARAM      — a `?sector`/`?role`/`?grade` value the destination drops on
//                    read. `?facet=cultural_institute` was in the first draft and
//                    would have landed the reader on an unfiltered /persons.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CULTURE_BANDS,
  CULTURE_TILES,
  CULTURE_HUB_COPY,
} from "./cultureRegistry";

import { CULTURE_SCENES } from "./cultureScenes";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";

const read = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

/** Every `path="…"` registered under the SPA router. */
const routedPaths = (): Set<string> => {
  const src = read("src/routes.tsx");
  return new Set(
    [...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1].replace(/^\//, "")),
  );
};

describe("the culture hub registry", () => {
  it("has at least one band and no empty band", () => {
    expect(CULTURE_BANDS.length).toBeGreaterThan(0);
    for (const b of CULTURE_BANDS) expect(b.tiles.length).toBeGreaterThan(0);
  });

  it("gives every tile a scene", () => {
    for (const t of CULTURE_TILES)
      expect(CULTURE_SCENES[t.id], `no scene for tile "${t.id}"`).toBeTypeOf(
        "function",
      );
  });

  it("defines no scene the registry does not use", () => {
    const ids = new Set(CULTURE_TILES.map((t) => t.id));
    for (const id of Object.keys(CULTURE_SCENES))
      expect(ids.has(id), `scene "${id}" belongs to no tile`).toBe(true);
  });

  it("uses each accent at most once across all bands", () => {
    const seen = new Map<string, string>();
    for (const t of CULTURE_TILES) {
      const prev = seen.get(t.accent);
      expect(prev, `tiles "${prev}" and "${t.id}" share an accent`).toBe(
        undefined,
      );
      seen.set(t.accent, t.id);
    }
  });

  it("gives every tile a unique id", () => {
    const ids = CULTURE_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every tile at a REGISTERED route", () => {
    const routed = routedPaths();
    for (const t of CULTURE_TILES) {
      expect(t.to.startsWith("/"), `${t.id}: "${t.to}" is not absolute`).toBe(
        true,
      );
      const [pathname] = t.to.slice(1).split("?");
      const bare = pathname.split("#")[0];
      const ok =
        routed.has(bare) ||
        // A `:param` route matches by shape, not by string.
        [...routed].some(
          (r) =>
            r.includes(":") &&
            new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`).test(bare),
        );
      expect(ok, `tile "${t.id}" points at unrouted path "/${bare}"`).toBe(
        true,
      );
    }
  });

  it("emits no ?sector value the browse packs cannot resolve", () => {
    for (const t of CULTURE_TILES) {
      const sector = new URLSearchParams(t.to.split("?")[1] ?? "").get(
        "sector",
      );
      if (!sector) continue;
      expect(
        SECTOR_BROWSE_PACKS[sector],
        `tile "${t.id}" emits ?sector=${sector}, which getSectorBrowsePack ` +
          `resolves to null — the destination would serve the whole corpus`,
      ).toBeTruthy();
    }
  });

  it("emits only risk grades the culture corpus actually has", () => {
    // A–F exist corpus-wide; culture reaches only D. Advertising E/F promises
    // severities the destination cannot show.
    for (const t of CULTURE_TILES) {
      const grade = new URLSearchParams(t.to.split("?")[1] ?? "").get("grade");
      if (!grade) continue;
      for (const g of grade.split(","))
        expect(
          ["A", "B", "C", "D"].includes(g),
          `tile "${t.id}" advertises grade ${g}, absent from the culture corpus`,
        ).toBe(true);
    }
  });

  it("uses ?role (not ?facet) for a person ROLE code", () => {
    // ?facet's vocabulary is the person GROUPS; a role code there is dropped on
    // read and the reader lands on an unfiltered /persons.
    const FACETS = new Set([
      "mp",
      "exec",
      "muni",
      "magistrate",
      "candidate",
      "ngo",
      "company",
      "donor",
    ]);
    for (const t of CULTURE_TILES) {
      const facet = new URLSearchParams(t.to.split("?")[1] ?? "").get("facet");
      if (facet)
        expect(
          FACETS.has(facet),
          `tile "${t.id}" emits ?facet=${facet}, which is a role code, not a facet`,
        ).toBe(true);
    }
  });

  it("has copy for every key it names", () => {
    // COPY is a Record<string, …>, so a typo'd key is invisible to TypeScript and
    // throws at render — one missing key white-screens the whole hub.
    for (const b of CULTURE_BANDS)
      for (const k of [b.labelKey, b.descKey])
        expect(CULTURE_HUB_COPY[k], `no copy for band key "${k}"`).toBeTruthy();
    for (const t of CULTURE_TILES)
      for (const k of [t.titleKey, t.descKey])
        expect(CULTURE_HUB_COPY[k], `no copy for tile key "${k}"`).toBeTruthy();
  });

  it("carries copy for nothing the registry does not name", () => {
    const named = new Set([
      ...CULTURE_BANDS.flatMap((b) => [b.labelKey, b.descKey]),
      ...CULTURE_TILES.flatMap((t) => [t.titleKey, t.descKey]),
    ]);
    for (const k of Object.keys(CULTURE_HUB_COPY))
      expect(named.has(k), `copy key "${k}" belongs to no band or tile`).toBe(
        true,
      );
  });

  it("gives every band and tile both languages", () => {
    for (const [k, v] of Object.entries(CULTURE_HUB_COPY)) {
      expect(v.bg.length, `${k}: empty bg`).toBeGreaterThan(0);
      expect(v.en.length, `${k}: empty en`).toBeGreaterThan(0);
    }
  });

  it("carries ?pscope=all on every tile quoting a whole-corpus figure", () => {
    // The browsers default to the SELECTED PARLIAMENT's window. A tile that says
    // „881 contracts since 2011" and lands on 47 has not narrowed the view — it
    // has contradicted itself, and the reader reads the tile as invented.
    for (const t of CULTURE_TILES) {
      const [, qs = ""] = t.to.split("?");
      const p = new URLSearchParams(qs);
      if (!p.has("sector")) continue;
      expect(
        p.get("pscope"),
        `tile "${t.id}" filters a procurement browser but sets no pscope — it ` +
          `will land on the parliament window while its copy quotes the corpus`,
      ).toBe("all");
    }
  });

  it("emits no fragment the destination does not define", () => {
    // A `#anchor` with no matching element scrolls nowhere; §4's other gates
    // strip the fragment before checking the path, so nothing else sees this.
    const FILE_FOR: Record<string, string> = {
      "culture/subsidies": "src/screens/culture/CultureSubsidiesScreen.tsx",
      "culture/procurement": "src/screens/culture/CultureProcurementScreen.tsx",
      "culture/funds": "src/screens/culture/CultureFundsScreen.tsx",
      "culture/institutions":
        "src/screens/culture/CultureInstitutionsScreen.tsx",
    };
    for (const t of CULTURE_TILES) {
      const [pathAndQs, hash] = t.to.split("#");
      if (!hash) continue;
      const bare = pathAndQs.slice(1).split("?")[0];
      const file = FILE_FOR[bare];
      expect(
        file,
        `tile "${t.id}" links #${hash} on /${bare}, which this gate cannot ` +
          `check — add the page to FILE_FOR`,
      ).toBeTruthy();
      expect(
        read(file).includes(`id="${hash}"`),
        `tile "${t.id}" links #${hash}, but ${file} defines no id="${hash}"`,
      ).toBe(true);
    }
  });

  it("reaches all three sub-pages, now that they exist", () => {
    // The inverse of the gate this replaces. While /culture/procurement,
    // /culture/funds and /culture/institutions did not exist, their tiles were
    // asserted ABSENT; now that they do, a hub that does not front them is a
    // module whose own pages are unreachable except by typing the URL.
    const targets = CULTURE_TILES.map((t) => t.to.split("#")[0]);
    for (const p of [
      "/culture/procurement",
      "/culture/funds",
      "/culture/institutions",
    ])
      expect(targets, `no tile fronts ${p}`).toContain(p);
  });
});
