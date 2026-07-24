// Which person_source an official's role lands on, and the invariant that
// moving one off `official_exec` must not take their declarations with it.

import { describe, expect, it } from "vitest";
import {
  CATEGORY_PERSON_SOURCE,
  OFFICIAL_DECLARATION_SOURCES,
  personSourceForOfficial,
} from "./officialSources";

describe("personSourceForOfficial", () => {
  it("routes the dedicated categories to their own source", () => {
    expect(personSourceForOfficial("executive", "president")).toBe("president");
    expect(personSourceForOfficial("executive", "mep")).toBe("mep");
    expect(personSourceForOfficial("executive", "diplomat")).toBe("diplomat");
  });

  it("leaves every other executive category on the generic source", () => {
    for (const c of [
      "cabinet",
      "regulator",
      "state_enterprise",
      "hospital_head",
      // Semantically exact but deliberately NOT mapped: the `academic` source is
      // public_default=false, so routing rectors there would hide 97 people who
      // currently show.
      "academic",
      // `media` means media OWNERSHIP, not public-broadcaster directors.
      "media_head",
    ]) {
      expect(personSourceForOfficial("executive", c)).toBe("official_exec");
    }
  });

  it("routes the municipal tier regardless of category", () => {
    expect(personSourceForOfficial("municipal", "mayor")).toBe("official_muni");
    // A municipal row must never be diverted by a category name collision.
    expect(personSourceForOfficial("municipal", "president")).toBe(
      "official_muni",
    );
  });

  it("falls back for an unknown or absent category", () => {
    expect(personSourceForOfficial("executive", null)).toBe("official_exec");
    expect(personSourceForOfficial(null, "not_a_category")).toBe(
      "official_exec",
    );
  });
});

describe("OFFICIAL_DECLARATION_SOURCES", () => {
  // The person page joins Court-of-Audit declarations on this set. A dedicated
  // source missing from it would silently drop that person's declared wealth
  // off their profile — the failure would look like "this president filed
  // nothing", which is worse than a crash because it reads as a fact.
  it("covers every source personSourceForOfficial can return", () => {
    for (const src of Object.values(CATEGORY_PERSON_SOURCE)) {
      expect(OFFICIAL_DECLARATION_SOURCES.has(src)).toBe(true);
    }
    expect(OFFICIAL_DECLARATION_SOURCES.has("official_exec")).toBe(true);
    expect(OFFICIAL_DECLARATION_SOURCES.has("official_muni")).toBe(true);
  });

  // Sources whose ref is NOT a declaration slug must stay out, or the page
  // would fetch a shard that cannot exist.
  it("excludes sources that do not carry a declaration slug", () => {
    for (const src of ["mp", "candidate", "tr", "ngo", "magistrate", "donor"]) {
      expect(OFFICIAL_DECLARATION_SOURCES.has(src)).toBe(false);
    }
  });
});
