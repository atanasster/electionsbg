// The sector config is written TWICE, and nothing used to hold the two copies
// together.
//
// SECTOR_CLUSTERS (src/screens/governance/sectorRegistry.ts) fronts a sector on
// the /governance/sectors hub and on the /procurement hub's featured block;
// SECTOR_DASHBOARDS (./sectorDashboards.ts) fronts the SAME sector on its own
// /sector/:id page. Both carry an `agency` — a Cyrillic acronym badge, identical
// in both languages — and a reader crossing from the hub to the page sees both.
//
// This gate exists because that pair silently disagreed. Widening the energy set
// to the state energy sector under the Minister of Energy (adding ДП РАО, a чл. 62
// ал. 3 ТЗ enterprise whose principal is МЕ rather than БЕХ) meant relabelling the
// badge from „БЕХ" to „МЕ" — and the registry copy was found only by grepping for
// the literal string, not by any failing test. Left alone it would have shipped
// /governance/sectors saying „БЕХ" and /sector/energy saying „МЕ" for one sector,
// which reads as two different owners rather than one relabelled set.
//
// Deliberately NOT asserted here: that every registry sector has a dashboard.
// Six of them (water/defense/culture/judiciary/pensions/education) are bespoke
// screens with no SECTOR_DASHBOARDS entry by design, so the join is an INNER one
// — this checks agreement where both sides exist, nothing more.

import { describe, it, expect } from "vitest";
import { SECTOR_CLUSTERS } from "@/screens/governance/sectorRegistry";
import { SECTOR_DASHBOARDS } from "./sectorDashboards";

const registrySectors = SECTOR_CLUSTERS.flatMap((c) => c.sectors);

describe("sector registry ↔ dashboard config", () => {
  it("agrees on the agency badge wherever both front the same sector", () => {
    const shared = registrySectors.filter((s) => SECTOR_DASHBOARDS[s.id]);

    // Without this the test is absence-equivalent: rename every dashboard id and
    // the join is empty, so nothing is compared and it passes greener than ever.
    expect(shared.length).toBeGreaterThan(5);

    const disagreements = shared
      .filter((s) => s.agency !== SECTOR_DASHBOARDS[s.id].agency)
      .map(
        (s) =>
          `${s.id}: registry "${s.agency}" vs dashboard "${SECTOR_DASHBOARDS[s.id].agency}"`,
      );
    expect(disagreements).toEqual([]);
  });

  it("keeps energy on МЕ — the principal, not the holding", () => {
    // Pinned by name because this is the one badge that is a claim about
    // OWNERSHIP rather than a label. „БЕХ" would say the sector is the holding
    // group; it is not — ДП РАО is in the set and БЕХ does not own it. See the
    // ДП РАО entry in src/lib/energyReferenceData.ts for the legal basis.
    expect(SECTOR_DASHBOARDS.energy.agency).toBe("МЕ");
    expect(registrySectors.find((s) => s.id === "energy")?.agency).toBe("МЕ");
  });

  it("keeps health on НЗОК — the money the tile actually shows", () => {
    // The other badge naming one of two members, and the reasoning runs the
    // OPPOSITE way to energy's, so pin it before someone applies that precedent
    // here. The set is МЗ + НЗОК, but this badge is not an ownership claim: the
    // hub number beside it is НЗОК's payout alone, because the headline
    // deliberately does not sum МЗ's enacted budget onto НЗОК's cash execution
    // (mixed bases, and it would double-count the state transfer). So the badge
    // names the body the metric belongs to; the title and desc carry both.
    // „МЗ" would be the principal AND two characters shorter — the width
    // argument does not resist it, which is why this test does.
    expect(SECTOR_DASHBOARDS.health.agency).toBe("НЗОК");
    expect(registrySectors.find((s) => s.id === "health")?.agency).toBe("НЗОК");
  });

  it("keeps edu on МОН — the body whose budget the tile shows", () => {
    // The third badge that names one member of a larger set, and it follows
    // health's reasoning rather than energy's. Since the 2026-08-18 audit the
    // roster is 126 bodies under THREE principals (МОН, БАН, and МЗХ for ССА),
    // so „МОН" would be an ownership claim if the badge were about ownership.
    // It is not: the hub number beside it is МОН's own enacted budget and
    // deliberately excludes the universities' and БАН's separate ПРБ budgets —
    // different bases that must not be summed. So the badge names the body the
    // METRIC belongs to, exactly as НЗОК does, and the title, description and
    // awarders footnote carry the full group.
    //
    // Energy's precedent ("relabel to the principal") must NOT be applied here:
    // there is no single principal to relabel to, and „МОН · БАН · МЗХ" is the
    // horizontal-overflow shape the health note describes.
    expect(SECTOR_DASHBOARDS.edu.agency).toBe("МОН");
    expect(registrySectors.find((s) => s.id === "edu")?.agency).toBe("МОН");
  });
});
