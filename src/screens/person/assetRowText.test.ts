// assetRowText — how one declared asset row reads as a line of text.
//
// The whole module exists because the row used to render `{category} {description}` and
// nothing else, which turned Мария Недина's four 2026 crypto holdings into four identical
// „Инвестиции €66 030" lines. Each case below is a shape that was actually mis-rendered.

import { describe, it, expect } from "vitest";
import {
  assetDetailText,
  assetQuantityText,
  assetRowParts,
  type DeclaredAsset,
} from "./assetRowText";

/** The number as the runtime's ICU formats it. Written this way rather than pasted,
 *  because bg-BG groups with U+00A0 rather than a space — an assertion holding the literal
 *  would be asserting a property of the ICU build, not of this module. */
const grouped = (n: number, locale = "bg-BG") =>
  n.toLocaleString(locale, { maximumFractionDigits: 8 });

const asset = (o: Partial<DeclaredAsset>): DeclaredAsset =>
  ({
    category: "investment",
    description: null,
    detail: null,
    location: null,
    municipality: null,
    areaSqm: null,
    acquiredYear: null,
    share: null,
    valueEur: null,
    holderName: null,
    isSpouse: false,
    currency: null,
    quantity: null,
    quantityUnit: null,
    isCrypto: false,
    ...o,
  }) as DeclaredAsset;

// Table 8 — the 2026 служебен cabinet. The coin IS the declared currency, so `detail`,
// `currency` and `quantityUnit` are all „Етериум" and the count is the quantity.
const ETH_TABLE8 = asset({
  category: "investment",
  detail: "Етериум",
  currency: "Етериум",
  quantity: 30,
  quantityUnit: "Етериум",
  valueEur: 66030,
  isCrypto: true,
});

// Table 9 — 2019-2025. The ticker is `detail`, the count came from `share`, and the
// declared currency is leva (the ACQUISITION PRICE's currency, not the holding's unit).
const ADA_TABLE9 = asset({
  category: "security",
  description: "крипто валута",
  detail: "ADA",
  currency: "BGN",
  quantity: 518000,
  quantityUnit: null,
  valueEur: 71937,
  isCrypto: true,
});

const BANK_EUR = asset({
  category: "bank",
  detail: "EUR",
  currency: "EUR",
  valueEur: 18016,
});

describe("assetDetailText", () => {
  it("keeps a detail that adds information", () => {
    expect(
      assetDetailText(
        asset({
          category: "vehicle",
          description: "ЛЕК АВТОМОБИЛ",
          detail: "BMW",
        }),
      ),
    ).toBe("BMW");
    expect(assetDetailText(ADA_TABLE9)).toBe("ADA");
  });

  it("suppresses a detail that merely restates a fiat currency", () => {
    // Bank and cash rows store detail = currency, so rendering it unconditionally puts
    // „Банкови сметки EUR" on every bank line in the corpus.
    expect(assetDetailText(BANK_EUR)).toBeNull();
  });

  it("suppresses the coin when the quantity already names it", () => {
    // Otherwise a table-8 row reads „Етериум · 30 Етериум".
    expect(assetDetailText(ETH_TABLE8)).toBeNull();
  });

  it("keeps a crypto detail even when it equals the declared unit's spelling", () => {
    // Same string in `detail` and `currency`, but no quantity to name the coin — so
    // suppressing here would leave the row with nothing identifying at all.
    expect(
      assetDetailText(
        asset({ detail: "Solana", currency: "Solana", isCrypto: true }),
      ),
    ).toBe("Solana");
  });
});

describe("assetQuantityText", () => {
  it("labels a bare count with the caller's word", () => {
    expect(assetQuantityText(ADA_TABLE9, "bg-BG", "бр.")).toBe(
      `${grouped(518000)} бр.`,
    );
  });

  it("uses the declared unit when there is one", () => {
    expect(assetQuantityText(ETH_TABLE8, "bg-BG", "бр.")).toBe("30 Етериум");
  });

  it("does not round a sub-unit holding to zero", () => {
    // 0.017 BTC and 0.38 ETH are real declared positions. A default 3-decimal format keeps
    // 0.017, but anything coarser publishes „0 Bitcoin" for a holding worth €998.
    const btc = asset({
      detail: "Bitcoin",
      currency: "Bitcoin",
      quantity: 0.017,
      quantityUnit: "Bitcoin",
      isCrypto: true,
    });
    expect(assetQuantityText(btc, "en-US", "units")).toBe("0.017 Bitcoin");
  });

  it("renders nothing when no quantity was declared", () => {
    expect(assetQuantityText(BANK_EUR, "bg-BG", "бр.")).toBeNull();
  });
});

describe("assetRowParts", () => {
  it("leaves no dangling separator when the description is absent", () => {
    // Crypto rows on table 8 have no description at all; the first draft rendered
    // „Инвестиции  · Етериум".
    expect(assetRowParts(ETH_TABLE8, "bg-BG", "бр.")).toBe("30 Етериум");
  });

  it("keeps the declarant's own label beside the ticker", () => {
    expect(assetRowParts(ADA_TABLE9, "bg-BG", "бр.")).toBe(
      `крипто валута · ADA · ${grouped(518000)} бр.`,
    );
  });

  it("says nothing extra about an ordinary bank row", () => {
    expect(assetRowParts(BANK_EUR, "bg-BG", "бр.")).toBe("");
  });

  it("still renders real estate as it did before", () => {
    const flat = asset({
      category: "real_estate",
      description: "АПАРТАМЕНТ",
      location: "София",
      share: "1/2",
      valueEur: 100000,
    });
    expect(assetRowParts(flat, "bg-BG", "бр.")).toBe("АПАРТАМЕНТ · София");
  });
});
