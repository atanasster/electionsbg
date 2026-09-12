import { siteLinks } from "../render/links";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDb } from "./dataClient";
import { cleanProductQuery, productPrice } from "./prices";

vi.mock("./dataClient", () => ({
  fetchData: vi.fn(),
  fetchDb: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

const ctx = { lang: "bg", election: "2026_04_19" } as const;
const lavazza = {
  slug: "mlyano-kafe-lavazza-crema-e-gusto-250gr",
  title: "МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.",
  pid: 101,
  chain_count: 4,
  current_min_eur: 6.18,
  pct_since_euro: 1.1,
};
const espresso = {
  slug: "kafe-lavazza-espresso-mlyano-250gr",
  title: "КАФЕ ЛАВАЦА ЕСПРЕСО МЛЯНО 250ГР",
  pid: 102,
  chain_count: 5,
  current_min_eur: 5.06,
  pct_since_euro: null,
};

const detail = (product = lavazza) => ({
  product: { ...product, confidence: 1 },
  chains: [
    {
      eik: "1",
      chain: "Верига 1",
      price_eur: product.current_min_eur ?? 0,
      promo_eur: null,
      stores: 3,
    },
  ],
});

describe("productPrice catalogue resolution", () => {
  it("removes conversational price wording from the product name", () => {
    expect(
      cleanProductQuery(
        "каква е цената на МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.",
      ),
    ).toBe("МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.");
  });

  it("resolves an exact normalized catalogue title immediately", async () => {
    vi.mocked(fetchDb)
      .mockResolvedValueOnce([lavazza])
      .mockResolvedValueOnce(detail());

    const env = await productPrice(
      {
        product: "каква е цената на МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.",
      },
      ctx,
    );

    expect(env.clarify).toBeUndefined();
    expect(env.title).toBe(lavazza.title);
    expect(siteLinks(env).map((l) => new URL(l.href).pathname)).toEqual([
      `/product/${lavazza.slug}`,
    ]);
    expect(fetchDb).toHaveBeenNthCalledWith(1, "price-search", {
      q: "МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.",
    });
  });

  it("offers ranked similar products when the supplied name is not exact", async () => {
    vi.mocked(fetchDb)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([espresso, lavazza]);

    const env = await productPrice(
      { product: "каква е цената на кафе лаваца 500г" },
      ctx,
    );

    expect(fetchDb).toHaveBeenNthCalledWith(2, "price-search", { q: "лаваца" });
    expect(env.clarify?.options).toHaveLength(2);
    expect(env.clarify?.options.map((option) => option.args)).toEqual([
      { product: `product-slug:${espresso.slug}` },
      { product: `product-slug:${lavazza.slug}` },
    ]);
    expect(env.clarify?.options[0].sublabel).toContain("5 вериги");
  });

  it("loads exactly the product selected by its stable slug", async () => {
    vi.mocked(fetchDb).mockResolvedValueOnce(detail(lavazza));

    const env = await productPrice(
      { product: `product-slug:${lavazza.slug}` },
      ctx,
    );

    expect(env.clarify).toBeUndefined();
    expect(env.title).toBe(lavazza.title);
    expect(siteLinks(env).map((l) => new URL(l.href).pathname)).toEqual([
      `/product/${lavazza.slug}`,
    ]);
    expect(fetchDb).toHaveBeenCalledOnce();
    expect(fetchDb).toHaveBeenCalledWith("price-product", {
      slug: lavazza.slug,
    });
  });
});
