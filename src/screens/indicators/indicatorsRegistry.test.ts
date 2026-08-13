// Shape gates over the KPI registry.
//
// These are generic rather than per-entry, because the defect they exist to
// catch is one a reviewer reads straight past: a config that is internally
// consistent, typechecks, and renders a number three orders of magnitude wrong.

import { describe, it, expect } from "vitest";
import { KPI_REGISTRY, LANDING_KPI_ORDER } from "./indicatorsRegistry";

describe("KPI_REGISTRY", () => {
  it("never labels an absolute delta with a percent sign", () => {
    // `yoyChangeFor` returns `latest − prior` in the SERIES' OWN units, and both
    // renderers print `${absDelta} ${deltaSuffix}` when no `formatDelta` is
    // given. So "%" on a level series (EUR millions, an index, a count) prints
    // the raw difference with a percent sign — €1.13bn rendered as "+1133.8 %".
    // A "%" suffix is only honest when the series is itself a ratio, or when
    // `formatDelta` overrides the rendering.
    for (const entry of Object.values(KPI_REGISTRY)) {
      if (entry?.deltaSuffix === "%" && entry.formatDelta === undefined) {
        // The series must be a ratio — assert by its own formatter producing a
        // percent-shaped headline.
        expect(
          entry.format(12.3),
          `${entry.key}: deltaSuffix "%" with no formatDelta`,
        ).toMatch(/%/);
      }
    }
  });

  it("keys every entry to its own registry slot", () => {
    for (const [slot, entry] of Object.entries(KPI_REGISTRY)) {
      expect(entry?.key).toBe(slot);
    }
  });

  it("registers every key the landing grid iterates", () => {
    // `LANDING_KPI_ORDER` is the only list either consumer walks, so a key in it
    // with no registry entry renders nothing at all.
    for (const key of LANDING_KPI_ORDER) {
      expect(KPI_REGISTRY[key], `${key} is on the grid`).toBeDefined();
    }
  });

  it("keeps municipalCommitments OFF the landing grid", () => {
    // Deliberate, and easy to undo with one line. That list also mints a
    // `CabinetKpiTile` on /governments/:id, whose "term-start → term-end, signed
    // delta" framing attributes movement in 265 separately elected mayors'
    // commitment stock to a PM·FM duo — which the plan (T14.2) rules out.
    expect(KPI_REGISTRY.municipalCommitments).toBeDefined();
    expect(LANDING_KPI_ORDER).not.toContain("municipalCommitments");
  });
});
