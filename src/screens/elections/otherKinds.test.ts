// The scope row's cross-kind model: exhaustive over the union, with copy that exists.
//
// ⚠ THE TYPE COVERS THE DESTINATIONS AND CANNOT COVER THE COPY. A `Record<ElectionsHubKind,
// string>` makes a missing label KEY a compile error; nothing in the type system says that key
// is in either corpus, and `t()` renders a missing key as its own raw ASCII identifier at a
// 200 — in the global scope row, on every page of this hub. That is the half this file holds.
import { describe, expect, it } from "vitest";
import {
  OTHER_KIND_LABEL,
  OTHER_KIND_ORDER,
  otherKindLinks,
} from "./otherKinds";
import { CYCLE_SURFACE, type ElectionsHubKind } from "./electionsHubCycle";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

const KINDS = Object.keys(CYCLE_SURFACE) as ElectionsHubKind[];

describe("the cross-kind scope links", () => {
  it("answer every kind the hub can resolve", () => {
    // ⚠ DERIVED FROM `CYCLE_SURFACE`, not restated. A hand-written list here would have to be
    // updated in step with the union — which is precisely the drift this asserts against.
    expect([...KINDS].sort()).toEqual([...OTHER_KIND_ORDER].sort());
    for (const k of KINDS) expect(OTHER_KIND_LABEL[k], k).toBeTruthy();
  });

  it.each([
    ["bg", bgCorpus],
    ["en", enCorpus],
  ])("%s carries copy for every one", (_lang, corpus) => {
    const missing = KINDS.filter(
      (k) => !(corpus[OTHER_KIND_LABEL[k]] ?? "").trim(),
    );
    expect(missing, `missing copy: ${missing.join(", ")}`).toEqual([]);
  });

  it("never offers the kind the reader is already on", () => {
    for (const current of KINDS) {
      const links = otherKindLinks({
        current,
        localCycle: "2023_10_29_mi",
        presidentialCycle: "2021_11_14_pvr",
      });
      expect(
        links.map((l) => l.kind),
        current,
      ).not.toContain(current);
      // …and offers all the others, so „filtered" cannot degrade into „empty".
      expect(links).toHaveLength(KINDS.length - 1);
    }
  });

  it("builds every destination through the surface map, with the cycle it was given", () => {
    // ⚠ THE CYCLE IS THE CALLER'S, NOT A LATEST. The screen resolves it from the date the
    // reader is standing on; a builder that ignored the argument would look identical on the
    // page whenever that date happens to be the newest one.
    const links = otherKindLinks({
      current: "parliamentary",
      localCycle: "2019_10_27_mi",
      presidentialCycle: "2016_11_06_pvr",
    });
    const to = Object.fromEntries(links.map((l) => [l.kind, l.to]));
    expect(to.local).toBe(CYCLE_SURFACE.local.href("2019_10_27_mi"));
    expect(to.presidential).toBe(
      CYCLE_SURFACE.presidential.href("2016_11_06_pvr"),
    );
    // Parliamentary is the catalogue's landing page and carries no cycle — see the module
    // header for why that asymmetry is deliberate.
    const fromLocal = otherKindLinks({
      current: "local",
      localCycle: "2019_10_27_mi",
      presidentialCycle: "2016_11_06_pvr",
    });
    expect(fromLocal.find((l) => l.kind === "parliamentary")?.to).toBe(
      "/parliamentary",
    );
  });

  it("keeps the declared display order", () => {
    const links = otherKindLinks({
      current: "presidential",
      localCycle: "2023_10_29_mi",
      presidentialCycle: "2021_11_14_pvr",
    });
    expect(links.map((l) => l.kind)).toEqual(["parliamentary", "local"]);
  });
});
