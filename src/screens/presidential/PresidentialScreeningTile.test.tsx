// What this tile must never draw without, and the one state where it must draw prose.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatPct } from "@/lib/currency";
import { PresidentialScreeningTile } from "./PresidentialScreeningTile";
import type { PresidentialScreening } from "@/data/presidential/useScreening";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const screening = (
  over: Partial<PresidentialScreening> = {},
): PresidentialScreening => ({
  cycle: "2001_11_11_pvr",
  round: 1,
  basis: "БЪЛГАРСКАТА ОГРАДА",
  basisEn: "THE ENGLISH CAVEAT",
  coverage: {
    sections: 12057,
    scored: 11330,
    bothSignals: 11330,
    unscored: 727,
    flaggedDistrictOverlap: 0,
  },
  cuts: { elevated: 20, high: 40, critical: 60 },
  bands: [
    { band: "low", count: 11250, share: 0.9929 },
    { band: "elevated", count: 62, share: 0.0055 },
    { band: "high", count: 18, share: 0.0016 },
    { band: "critical", count: 0, share: 0 },
  ],
  elevatedShare: 0.0071,
  discriminating: true,
  top: [
    {
      code: "160100001",
      oblast: "PDV",
      placeName: "гр.Пробен",
      score: 52.3,
      band: "high",
      signalsAvailable: 2,
      components: [
        { id: "invalidBallots", rawPct: 21.4, normalized: 0.71 },
        { id: "additionalVoters", rawPct: 10.1, normalized: 0.34 },
      ],
    },
  ],
  ...over,
});

const mount = (s: PresidentialScreening) =>
  render(
    <TooltipProvider>
      <PresidentialScreeningTile screening={s} />
    </TooltipProvider>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
});

describe("PresidentialScreeningTile", () => {
  it("renders the caveat from the artifact, ABOVE the section list", () => {
    mount(screening());
    const caveat = screen.getByText("БЪЛГАРСКАТА ОГРАДА");
    const row = screen.getByText("160100001");
    expect(
      caveat.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the ENGLISH caveat on the English page", async () => {
    await i18n.changeLanguage("en");
    mount(screening());
    expect(screen.getByText("THE ENGLISH CAVEAT")).toBeTruthy();
    expect(screen.queryByText("БЪЛГАРСКАТА ОГРАДА")).toBeNull();
  });

  it("prints the cut points from the artifact, so a band means a number", () => {
    mount(screening());
    expect(screen.getByText(/20.*40.*60/)).toBeTruthy();
  });

  it("names NO section when the screen does not discriminate, and says why", () => {
    // ⚠⚠ THE CORE RULE. 2011 round 1 puts 18.1% of the country at elevated-or-above; twenty
    // stations drawn from that are an arbitrary pick presented as a finding.
    mount(
      screening({
        elevatedShare: 0.1603,
        discriminating: false,
        top: [],
        bands: [
          { band: "low", count: 9076, share: 0.8397 },
          { band: "elevated", count: 1119, share: 0.1035 },
          { band: "high", count: 605, share: 0.056 },
          { band: "critical", count: 9, share: 0.0008 },
        ],
      }),
    );
    expect(screen.queryByText("160100001")).toBeNull();
    // ⚠ THE PRODUCER'S OWN FIGURE. The tile used to recompute this from the band counts, which
    // is the only reason a 100×-too-small `bands[].share` did not also corrupt this sentence —
    // so the fixture states it and the assertion reads it back through the formatter.
    expect(
      screen.getByText((text) => text.includes(formatPct(0.1603, "bg", 1))),
    ).toBeTruthy();
  });

  it("warns when most rows carry ONE signal", () => {
    // ⚠ 2021 counted on machines, so the score there is the added-voters ratio alone.
    mount(
      screening({
        coverage: {
          sections: 12488,
          scored: 10967,
          bothSignals: 1722,
          unscored: 1521,
          flaggedDistrictOverlap: 0,
        },
      }),
    );
    expect(
      screen.getByText(bgCorpus.presidential_screen_one_signal),
    ).toBeTruthy();
  });

  it("stays quiet about one-signal rows when both signals are the norm", () => {
    // The mutation check for the test above.
    mount(screening());
    expect(
      screen.queryByText(bgCorpus.presidential_screen_one_signal),
    ).toBeNull();
  });

  it("names the two signals it did NOT compute", () => {
    // ⚠ A SCREENING CAPTIONED „procedural" that silently ran two of four would overstate what
    // it looked at.
    mount(screening());
    expect(
      screen.getByText(bgCorpus.presidential_screen_missing_signals),
    ).toBeTruthy();
  });

  it("names an impossible ratio instead of printing it", () => {
    // ⚠⚠ „Дописани 425%" IS NOT A RATIO — it says the protocol does not add up, which is a
    // different and stronger claim about a named station.
    mount(
      screening({
        top: [
          {
            ...screening().top[0],
            components: [
              {
                id: "additionalVoters",
                rawPct: 425.4,
                normalized: 1,
                implausible: true,
              },
            ],
          },
        ],
      }),
    );
    expect(
      screen.getByText(new RegExp(bgCorpus.presidential_screen_implausible)),
    ).toBeTruthy();
    expect(screen.queryByText(/425/)).toBeNull();
  });

  it("states how many named sections lie in a flagged district", () => {
    // ⚠ THE CONFOUND, MEASURED. A municipality-level correlation attached to a section-level
    // list is unfalsifiable prose until this number sits beside it.
    mount(
      screening({
        coverage: { ...screening().coverage, flaggedDistrictOverlap: 3 },
      }),
    );
    const line = screen.getByText((text) =>
      text.includes("квартала, посочени в пресата"),
    );
    // Both halves: how many of the listed sections, and out of how many.
    expect(line.textContent).toContain("3");
    // …out of the number of sections actually listed, which the fixture makes one.
    expect(line.textContent).toContain("изброените 1 секции");
  });

  it("says NOTHING about the overlap when it was not measured", () => {
    mount(
      screening({
        coverage: { ...screening().coverage, flaggedDistrictOverlap: null },
      }),
    );
    expect(
      document.body.textContent?.includes("квартала, посочени в пресата"),
    ).toBe(false);
  });

  it("falls back past an empty place name and past the _unplaced sentinel", () => {
    mount(
      screening({
        top: [{ ...screening().top[0], placeName: "  ", oblast: "" }],
      }),
    );
    expect(
      screen.getByText(bgCorpus.presidential_screen_place_unknown),
    ).toBeTruthy();
  });

  it("renders NOTHING when nothing could be scored", () => {
    const { container } = mount(
      screening({
        coverage: {
          sections: 12057,
          scored: 0,
          bothSignals: 0,
          unscored: 12057,
          flaggedDistrictOverlap: 0,
        },
        top: [],
        bands: [
          { band: "low", count: 0, share: 0 },
          { band: "elevated", count: 0, share: 0 },
          { band: "high", count: 0, share: 0 },
          { band: "critical", count: 0, share: 0 },
        ],
      }),
    );
    expect(container.textContent).toBe("");
  });
});
