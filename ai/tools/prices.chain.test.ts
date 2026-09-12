import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDb } from "./dataClient";
import { chainProfile } from "./prices";
import { siteLinks } from "../render/links";
vi.mock("./dataClient", () => ({ fetchData: vi.fn(), fetchDb: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const ctx = { lang: "bg", election: "2026_04_19" } as const;
function setup(extra = {}) {
  vi.mocked(fetchDb).mockImplementation(async (route, args) => {
    if (route === "company") return { company: { name: "БИЛЛА БЪЛГАРИЯ" } };
    if (args?.kind === "chains")
      return {
        national: [
          { eik: "other", chain: "Other", basket: 1, comparable: false },
          { eik: "130007884", chain: "Билла", basket: 20, comparable: false },
        ],
      };
    return {
      chain: "Билла",
      asOf: "2026-09-11",
      products: [{ title: "Хляб", price: 1.29, asOf: "2026-09-11" }],
      ...extra,
    };
  });
}
describe("chainProfile", () => {
  it("answers the reported query with dated product prices and a named link", async () => {
    setup();
    const env = await chainProfile(
      { chain: "какви са цените във верига БИЛЛА" },
      ctx,
    );
    expect(env.title).toBe("Билла");
    expect(env.rows).toContainEqual({
      metric: "Хляб",
      value: expect.stringContaining("1,29"),
    });
    expect(env.facts.rank_by_price).toBeUndefined();
    expect(siteLinks(env)[0].href).toContain("/consumption/chain/130007884");
    expect(JSON.stringify(siteLinks(env))).toContain("Билла — пълен профил");
  });
  it("explains source conflicts without quoting the other chain's prices", async () => {
    setup({ sourceConflict: "chain-store-mismatch" });
    const env = await chainProfile({ chain: "БИЛЛА" }, ctx);
    expect(env.facts.price_note).toContain("НОВЕ");
    expect(env.rows?.some((row) => row.metric === "Хляб")).toBe(false);
    expect(env.facts.basket).toBeUndefined();
  });
  it("labels retained prices and withholds prices beyond the display ceiling", async () => {
    setup({ stale: true, beyondCeiling: true });
    const env = await chainProfile({ chain: "БИЛЛА" }, ctx);
    expect(env.facts.price_note).toContain("твърде стари");
    expect(env.rows?.some((row) => row.metric === "Хляб")).toBe(false);
  });
});

it("dates retained prices and does not imply they are current offers", async () => {
  setup({
    stale: true,
    asOf: "2026-09-01",
    products: [{ title: "Хляб", price: 1.29, asOf: "2026-08-30" }],
  });
  const env = await chainProfile({ chain: "БИЛЛА" }, ctx);
  expect(env.facts.prices_as_of).toBe("2026-09-01");
  expect(env.facts.price_note).toContain("не текущи оферти");
  expect(env.rows).toContainEqual({
    metric: "Хляб",
    value: expect.stringContaining("2026-08-30"),
  });
});

it("ranks only complete baskets and retains the procurement summary", async () => {
  vi.mocked(fetchDb).mockImplementation(async (route, args) => {
    if (route === "company")
      return {
        company: { name: "БИЛЛА БЪЛГАРИЯ" },
        procurement: { contractCount: 3, totalEur: 1234 },
      };
    if (args?.kind === "chains")
      return {
        national: [
          { eik: "partial", chain: "Partial", basket: 1, comparable: false },
          { eik: "130007884", chain: "Билла", basket: 20, comparable: true },
          { eik: "second", chain: "Second", basket: 30, comparable: true },
        ],
      };
    return null;
  });
  const env = await chainProfile({ chain: "БИЛЛА" }, ctx);
  expect(env.facts.rank_by_price).toBe("1/2");
  expect(env.facts.basket).toContain("20,00");
  expect(env.facts.as_supplier_contracts).toBe(3);
});

it("bounds the product sample without treating it as a catalogue total", async () => {
  setup({
    products: Array.from({ length: 12 }, (_, i) => ({
      title: `Product ${i}`,
      price: i + 1,
    })),
  });
  const env = await chainProfile({ chain: "БИЛЛА" }, ctx);
  expect(env.facts.shown_products).toBe(8);
  expect(
    env.rows?.filter((r) => String(r.metric).startsWith("Product")),
  ).toHaveLength(8);
});

it("keeps the company identity when price payloads are missing", async () => {
  vi.mocked(fetchDb).mockImplementation(async (route) =>
    route === "company" ? { company: { name: "БИЛЛА БЪЛГАРИЯ" } } : null,
  );
  const env = await chainProfile({ chain: "БИЛЛА" }, ctx);
  expect(env.title).toBe("БИЛЛА БЪЛГАРИЯ");
  expect(env.rows?.[0].value).toContain("Няма налични");
  expect(JSON.stringify(env)).not.toContain("не печели поръчки");
});

it("renders English price caveats and the named English link", async () => {
  setup({ sourceConflict: "chain-store-mismatch" });
  const env = await chainProfile({ chain: "BILLA" }, { ...ctx, lang: "en" });
  expect(env.facts.price_note).toContain("NOVE");
  expect(env.rows?.some((r) => r.metric === "Price data")).toBe(true);
  expect(JSON.stringify(siteLinks(env))).toContain("Билла — full profile");
});
