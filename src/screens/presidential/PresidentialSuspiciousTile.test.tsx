// What this tile must never draw — and the one state where it must draw PROSE instead of names.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatInt, formatPct } from "@/lib/currency";
import { PresidentialSuspiciousTile } from "./PresidentialSuspiciousTile";
import type {
  PresidentialSuspicious,
  SuspiciousCategoryPayload,
} from "@/data/presidential/useSuspiciousSettlements";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const category = (
  over: Partial<SuspiciousCategoryPayload> = {},
): SuspiciousCategoryPayload => ({
  count: 12,
  threshold: 80,
  nationalPct: 49.42,
  measurableSettlements: 2341,
  flaggedShare: 0.005,
  discriminating: true,
  // ⚠ A ROW THE PRODUCER CAN ACTUALLY EMIT — see the hook test's note. S23/S24/S25 carry the
  // bare numbers „23"/„24"/„25" in `regions.json`, Sofia is outside the ЕКАТТЕ join, and the
  // settlement prefix is concatenated with no space.
  top: [
    {
      ekatte: "65231",
      oblast: "HKV",
      settlement: "с.Сърница",
      settlement_en: "Sarnitsa",
      region_name: "Хасково",
      region_name_en: "Haskovo",
      value: 94.88,
    },
  ],
  votesAffected: 812,
  ...over,
});

const suspicious = (
  over: Partial<PresidentialSuspicious> = {},
): PresidentialSuspicious => ({
  cycle: "2021_11_14_pvr",
  round: 1,
  basis: "БЪЛГАРСКАТА ОГРАДА",
  basisEn: "THE ENGLISH CAVEAT",
  coverage: {
    settlements: 4921,
    sections: 11132,
    sectionsWithoutEkatte: 1355,
    votesWithoutEkatte: 502133,
  },
  concentrated: category(),
  invalidBallots: category({
    threshold: 10,
    nationalPct: 0.44,
    top: [],
    count: 0,
  }),
  additionalVoters: category({
    threshold: 10,
    nationalPct: 1.2,
    top: [],
    count: 0,
  }),
  ...over,
});

// ⚠ `Hint` IS A RADIX TOOLTIP AND RADIX THROWS WITHOUT ITS PROVIDER — a mount without it
// reports missing scaffolding as a broken tile.
const mount = (s: PresidentialSuspicious) =>
  render(
    <TooltipProvider>
      <PresidentialSuspiciousTile suspicious={s} />
    </TooltipProvider>,
  );

/** ⚠ `formatInt` SEPARATES WITH A NON-BREAKING SPACE and Testing Library's default normalizer
 *  turns it into an ordinary one, so a raw `.includes` of a formatted number never matches at
 *  six digits and always matches at four. Both sides go through this. */
const norm = (s: string) => s.replace(/\s+/g, " ");

beforeEach(async () => {
  await i18n.changeLanguage("bg");
});

describe("PresidentialSuspiciousTile", () => {
  it("renders the red-flag caveat from the artifact, ABOVE the lists", () => {
    // ⚠⚠ THE TILE NAMES VILLAGES. A reader who stops at the first row must already have read
    // that none of the three thresholds proves wrongdoing — and the sentence comes from the
    // DATA, so a producer wording change reaches the reader with the list.
    mount(suspicious());
    const caveat = screen.getByText("БЪЛГАРСКАТА ОГРАДА");
    expect(caveat).toBeTruthy();
    const name = screen.getByText("с.Сърница, Хасково");
    expect(
      caveat.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the ENGLISH caveat on the English page", async () => {
    // Not the Bulgarian one, and not nothing: an EN reader would otherwise get named places
    // with no qualification at all.
    await i18n.changeLanguage("en");
    mount(suspicious());
    expect(screen.getByText("THE ENGLISH CAVEAT")).toBeTruthy();
    expect(screen.queryByText("БЪЛГАРСКАТА ОГРАДА")).toBeNull();
    expect(screen.getByText("Sarnitsa, Haskovo")).toBeTruthy();
  });

  it("prints the threshold AND the national rate together", () => {
    // ⚠ „≥80%" is not a fact about a place until a reader knows what the country did. The two
    // numbers share one line so neither can be read alone.
    mount(suspicious());
    // ⚠ THE EXPECTED STRINGS COME FROM THE REPO'S OWN FORMATTERS, never from a literal: the
    // Bulgarian corpus groups from five digits and drops a trailing decimal zero, so „2 341"
    // and „80,0%" are both wrong here and a literal would assert the locale rather than the
    // co-location this test is about.
    const line = screen.getByText(
      (text) =>
        norm(text).includes(norm(formatPct(0.8, "bg", 1))) &&
        norm(text).includes(norm(formatInt(2341, "bg"))) &&
        norm(text).includes(norm(formatPct(0.4942, "bg", 1))),
    );
    expect(line).toBeTruthy();
  });

  it("names NOTHING when the flag does not discriminate, and says why", () => {
    // ⚠⚠ THE CORE RULE. On 2006's runoff the concentration flag caught 2,537 settlements, 205
    // of them at exactly 100% — any three names would have been an arbitrary pick presented as
    // a finding. The producer sends no names in that state; this asserts the tile agrees.
    mount(
      suspicious({
        concentrated: category({
          discriminating: false,
          flaggedShare: 0.596,
          top: [],
          count: 1394,
        }),
      }),
    );
    expect(screen.queryByText("с.Сърница, Хасково")).toBeNull();
    // ⚠ THE FORMATTER, NOT A LITERAL — same rule as the two tests above. `flaggedShare` is the
    // one field stored as a FRACTION, so this also pins that the tile does not divide it twice.
    expect(
      screen.getByText((text) =>
        norm(text).includes(norm(formatPct(0.596, "bg", 1))),
      ),
    ).toBeTruthy();
  });

  it("states the coverage — София is outside every figure on it", () => {
    // ⚠ THE SECTIONS WITH NO ЕКАТТЕ ARE HALF A MILLION VOTES. A count captioned as national
    // without that line is a claim about a country the analysis never measured.
    mount(suspicious());
    const line = screen.getByText(
      (text) =>
        norm(text).includes(norm(formatInt(4921, "bg"))) &&
        norm(text).includes(norm(formatInt(1355, "bg"))) &&
        norm(text).includes(norm(formatInt(502133, "bg"))),
    );
    expect(line).toBeTruthy();
  });

  it("renders NOTHING when no rule could be computed", () => {
    // ⚠⚠ THREE ZEROS OVER „measurable for 0 settlements" reads as „nothing was wrong here"
    // when the truth is that nothing could be checked.
    const { container } = mount(
      suspicious({
        concentrated: category({ count: 0, measurableSettlements: 0, top: [] }),
        invalidBallots: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
        additionalVoters: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
      }),
    );
    expect(container.textContent).toBe("");
  });

  it("falls back to the Bulgarian name on /en when the catalogue has no English one", async () => {
    // All 56 top-rows in the committed corpus carry both English names, so this path is dead on
    // current data — and fires the first time the settlements catalogue lacks one.
    await i18n.changeLanguage("en");
    mount(
      suspicious({
        concentrated: category({
          top: [
            {
              ekatte: "65231",
              oblast: "HKV",
              settlement: "с.Сърница",
              region_name: "Хасково",
              value: 94.88,
            },
          ],
        }),
      }),
    );
    expect(screen.getByText("с.Сърница, Хасково")).toBeTruthy();
  });

  it("falls back to the bare ЕКАТТЕ when a row carries no name at all", () => {
    // ⚠ NEVER A BLANK LINE. An unnamed row in a list of flagged settlements reads as one more
    // place to a reader counting them — the reason the guard requires `ekatte`.
    mount(
      suspicious({
        concentrated: category({
          top: [{ ekatte: "65231", oblast: "HKV", value: 94.88 }],
        }),
      }),
    );
    expect(screen.getByText("65231")).toBeTruthy();
  });

  it("says NOTHING CROSSED THE THRESHOLD rather than leaving the column blank", () => {
    // ⚠ „Nothing was flagged" and „the list did not load" must not render identically, and a
    // blank gap under a number reads as the second — the opposite of the message. The fixture's
    // other two columns are already in this state, which is why it went unasserted.
    mount(suspicious({ concentrated: category({ count: 0, top: [] }) }));
    expect(
      screen.getAllByText(bgCorpus.dashboard_suspicious_none).length,
    ).toBeGreaterThan(0);
  });

  it("gives a truncated place name a `title`, so it stays recoverable", () => {
    // ⚠ 27-CHARACTER LABELS ARE ORDINARY HERE („с.Мало Малово, София област") and the column is
    // ~139px at `sm`. On a tile whose entire content is WHICH places were flagged, a name a
    // reader can neither finish nor hover to recover defeats the tile.
    mount(suspicious());
    expect(screen.getByText("с.Сърница, Хасково").getAttribute("title")).toBe(
      "с.Сърница, Хасково",
    );
  });

  it("names each column's list, so three lists of villages are not unlabelled", () => {
    mount(suspicious());
    expect(
      screen.getByRole("list", {
        name: bgCorpus.dashboard_suspicious_concentrated,
      }),
    ).toBeTruthy();
  });

  it("shares the parliamentary column titles, so one phenomenon has one name", () => {
    mount(suspicious());
    expect(
      screen.getByText(bgCorpus.dashboard_suspicious_concentrated),
    ).toBeTruthy();
    expect(
      screen.getByText(bgCorpus.dashboard_suspicious_invalid),
    ).toBeTruthy();
    expect(
      screen.getByText(bgCorpus.dashboard_suspicious_additional),
    ).toBeTruthy();
  });
});
