// Component guard for the „Криптоактиви" block on /person/:slug.
//
// The two properties that matter are both about NOT asking for things:
//   * a person with no crypto must make no declaration-detail request at all — the mount
//     decision comes off the filing list, which the section has already fetched, and
//     ~56.8k people hold none;
//   * the block must never render an empty heading, which would assert that a person the
//     list says holds crypto holds none.
//
// Hermetic: fetch stubbed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type {
  DeclarationDetail,
  DeclarationListItem,
} from "./usePersonDeclarations";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonCryptoHoldings } from "./PersonCryptoHoldings";

const filing = (o: Partial<DeclarationListItem>): DeclarationListItem =>
  ({
    id: 1,
    tier: "exec",
    year: 2026,
    fiscalYear: null,
    periodYear: 2026,
    type: "Vacate",
    institution: "МС",
    positionTitle: null,
    filedAt: null,
    sourceUrl: "https://register.cacbg.bg/2026/x.xml",
    assetsEur: 0,
    debtsEur: 0,
    netEur: 0,
    assetCount: 0,
    stakeCount: 0,
    eventCount: 0,
    excludedAssetRows: 0,
    cryptoCount: 0,
    cryptoEur: 0,
    ...o,
  }) as DeclarationListItem;

const assetRow = (o: Record<string, unknown>) => ({
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
});

const stub = (detail: DeclarationDetail) => {
  const fn = vi.fn(async () => ({ json: async () => detail }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe("PersonCryptoHoldings", () => {
  it("makes no request and renders nothing when the filing declares no crypto", async () => {
    const fetchMock = stub(null);
    const { container } = render(
      <PersonCryptoHoldings filing={filing({ cryptoCount: 0 })} />,
    );
    expect(container).toBeEmptyDOMElement();
    // The point of carrying cryptoCount on the list payload: no round trip for the ~56.8k
    // people who hold none.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the coin and the size of the holding, not just a euro figure", async () => {
    stub({
      id: 1,
      tier: "exec",
      declarantName: "Мария Стоева Недина",
      year: 2026,
      fiscalYear: null,
      type: "Vacate",
      institution: "МС",
      positionTitle: null,
      filedAt: null,
      entryNumber: null,
      controlHash: null,
      sourceUrl: "https://register.cacbg.bg/2026/x.xml",
      assets: [
        assetRow({
          category: "bank",
          detail: "EUR",
          currency: "EUR",
          valueEur: 30048,
        }),
        assetRow({
          detail: "Етериум",
          currency: "Етериум",
          quantity: 30,
          quantityUnit: "Етериум",
          valueEur: 43470,
          isCrypto: true,
        }),
      ],
      income: [],
      stakes: [],
      events: [],
    } as unknown as DeclarationDetail);

    render(
      <PersonCryptoHoldings
        filing={filing({ cryptoCount: 1, cryptoEur: 43470 })}
      />,
    );

    // The regression this whole change exists for: before it, this row was „Инвестиции
    // €43 470" with the coin and the count nowhere on the page.
    await waitFor(() =>
      expect(screen.getByText(/30 Етериум/)).toBeInTheDocument(),
    );
    // The bank row is not crypto and must not be swept in beside it.
    expect(screen.queryByText(/30 048/)).not.toBeInTheDocument();
    // Declared, not audited — and explicitly not a market price.
    expect(screen.getByText("pp_crypto_note")).toBeInTheDocument();
  });

  it("renders no heading while the detail is still loading", async () => {
    // A heading with no rows under it would read as „this person's crypto is gone".
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const { container } = render(
      <PersonCryptoHoldings
        filing={filing({ cryptoCount: 4, cryptoEur: 95492 })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
