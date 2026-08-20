// Pure parsing of one chain's daily КЗП CSV into PriceRow[]. No database.
//
// normLabel / normName back UNIQUE constraints in Postgres (price_stores,
// price_skus) — a change to either is a data migration, not a refactor — so
// they get their own boring, explicit cases. parseChainCsv absorbs the feed's
// 4 header/delimiter variants and quietly drops malformed rows; every filter it
// applies is exercised below against a small hand-built CSV.

import { describe, it, expect } from "vitest";
import {
  parseChainFromFilename,
  normLabel,
  normName,
  parseChainCsv,
} from "./normalize";

describe("parseChainFromFilename", () => {
  it("splits the display name from the trailing _EIK, dropping the (entity)", () => {
    expect(
      parseChainFromFilename(
        "Кауфланд (Кауфланд България ЕООД енд Ко КД)_131129282.csv",
      ),
    ).toEqual({ eik: "131129282", chain: "Кауфланд" });
  });

  it("handles a plain <Chain>_<EIK>.csv with no parenthetical", () => {
    expect(parseChainFromFilename("Lidl_131071587.csv")).toEqual({
      eik: "131071587",
      chain: "Lidl",
    });
  });

  it("is case-insensitive on the .csv extension", () => {
    expect(parseChainFromFilename("Billa_130007884.CSV").eik).toBe("130007884");
  });

  it("falls back to the whole base when there is no underscore", () => {
    expect(parseChainFromFilename("NoUnderscore.csv")).toEqual({
      eik: "NoUnderscore",
      chain: "NoUnderscore",
    });
  });
});

describe("normLabel / normName (the DB-constraint key)", () => {
  it("uppercases, collapses punctuation/space to single spaces, and trims", () => {
    expect(normLabel("  Кауфланд,  ул.  Витоша  ")).toBe("КАУФЛАНД УЛ ВИТОША");
    expect(normName("Мляко   'Верея'  1Л")).toBe("МЛЯКО ВЕРЕЯ 1Л");
  });

  it("is the same normalization for stores and product names", () => {
    const s = "Billa — ж.к. Люлин 7";
    expect(normLabel(s)).toBe(normName(s));
  });

  it("is idempotent (re-normalizing an already-normal key is a no-op)", () => {
    const once = normName("Прясно Мляко, Верея 3.6%");
    expect(normName(once)).toBe(once);
  });
});

const KZP_HEADER =
  "Населено място;Търговски обект;Наименование на продукта;Код на продукта;Категория;Цена на дребно;Цена в промоция";

describe("parseChainCsv", () => {
  const header = KZP_HEADER;

  it("parses a semicolon file: header skip, comma-decimal price, promo", () => {
    const csv = [
      header,
      "68134;Магазин Витоша;МЛЯКО ВЕРЕЯ 1Л 3%;ABC123;6;1,89;1,59",
      "00151;Селски магазин;ХЛЯБ ДОБРУДЖА;X-1;40;0,99;",
    ].join("\n");
    const rows = parseChainCsv(csv, "Billa_130007884.csv");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ekatte: "68134",
      product: "МЛЯКО ВЕРЕЯ 1Л 3%",
      productId: 6,
      price: 1.89,
      promo: 1.59,
      eik: "130007884",
      chain: "Billa",
    });
    // Empty promo cell → null, not 0.
    expect(rows[1].promo).toBeNull();
    expect(rows[1].productId).toBe(40);
  });

  it("carries the normalized store + product keys onto every row", () => {
    const csv = [header, "68134;Билла Люлин;ХЛЯБ;A;40;0,99;"].join("\n");
    const [row] = parseChainCsv(csv, "Billa_130007884.csv");
    expect(row.storeNorm).toBe("БИЛЛА ЛЮЛИН");
    expect(row.productNorm).toBe("ХЛЯБ");
  });

  it("drops rows whose settlement code is not a 5-digit EKATTE", () => {
    const csv = [header, "BADXX;Лош ред;НЕЩО;Y;6;1,00;"].join("\n");
    expect(parseChainCsv(csv, "Billa_130007884.csv")).toHaveLength(0);
  });

  it("zero-pads a short numeric code rather than dropping it", () => {
    const csv = [header, "151;Магазин;ХЛЯБ;A;40;0,99;"].join("\n");
    expect(parseChainCsv(csv, "Billa_130007884.csv")[0].ekatte).toBe("00151");
  });

  it("buckets an out-of-range category code to 0 (legacy bucket)", () => {
    // "200" is quoted in the feed and > 101 → bucket 0.
    const csv = [header, '77195;Магазин;ЗАХАР 1КГ;Z;"200";2,49;'].join("\n");
    expect(parseChainCsv(csv, "Billa_130007884.csv")[0].productId).toBe(0);
  });

  it("drops rows with a non-positive / unparseable retail price", () => {
    const csv = [
      header,
      "77195;Развален;НУЛА;Z;6;0;",
      "77195;Празна;ПРАЗНА;Z;6;;",
    ].join("\n");
    expect(parseChainCsv(csv, "Billa_130007884.csv")).toHaveLength(0);
  });

  it("auto-detects a comma-delimited variant", () => {
    const csv = [
      "Населено място,Търговски обект,Наименование,Код,Категория,Цена на дребно,Цена в промоция",
      "68134,Shop,МЛЯКО,A,6,1.50,",
    ].join("\n");
    const rows = parseChainCsv(csv, "Kaufland_131129282.csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(1.5);
  });

  it("strips a UTF-8 BOM before the header", () => {
    const csv = ["﻿" + header, "68134;Shop;МЛЯКО;A;6;1,50;"].join("\n");
    expect(parseChainCsv(csv, "Billa_130007884.csv")).toHaveLength(1);
  });
});

// Plan T5, gate 5. The zero-price guarantee, pinned at the only place it is
// enforced.
//
// The concern that prompted it: when a chain stops filing, does the loader write
// its products at a price of 0 and drag every average toward zero? It does not,
// and cannot — `toPrice` returns null unless the value parses to a number > 0,
// and the row is skipped. Measured across the whole corpus: 0 rows with
// `price <= 0` in price_current, price_facts, price_grid_days,
// price_chain_grid_days and price_last_seen (the stored half of this gate lives
// in scripts/db/tests/prices_last_seen.data.test.ts).
//
// The guarantee is STRUCTURAL — one `> 0` and one `continue`. This block is what
// stops it being structural by ACCIDENT: removing the comparison turns 7 of
// these red rather than silently shifting a quarterly average.
//
// See docs/plans/prices-chain-absence-v1.md §5 and §6.
describe("toPrice — no writer can introduce a non-positive price", () => {
  // Same header the `parseChainCsv` block above uses. Declared once here rather
  // than copied: a third spelling of the column order is how two blocks end up
  // testing different files.
  const header = KZP_HEADER;
  const row = (price: string, promo = "") =>
    ["68134", "Магазин", "ХЛЯБ", "000001", "1", price, promo].join(";");
  const parse = (...rows: string[]) =>
    parseChainCsv([header, ...rows].join("\n"), "Тест_100000001.csv");

  it("keeps an ordinary price", () => {
    const rows = parse(row("1,99"));
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBeCloseTo(1.99, 6);
  });

  for (const bad of ["0", "0,00", "0.00", "-1", "-0,50", "", "   "]) {
    it(`drops the row for a price of ${JSON.stringify(bad)}`, () => {
      expect(parse(row(bad))).toHaveLength(0);
    });
  }

  it("drops a row whose price is not a number at all", () => {
    // The euro-changeover shape: a chain appends a currency to the cell.
    expect(parse(row("1,99 лв."))).toHaveLength(0);
    expect(parse(row("n/a"))).toHaveLength(0);
  });

  it("never emits a non-positive price across a mixed file", () => {
    const rows = parse(
      row("1,99"),
      row("0"),
      row("-2,50"),
      row("3,49"),
      row(""),
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.price).toBeGreaterThan(0);
  });

  it("a zero PROMO is null rather than a zero price, and keeps the row", () => {
    // promo shares toPrice, so the same rule applies — but a bad promo must not
    // take the row with it: the regular price is still a fact.
    const [r] = parse(row("1,99", "0"));
    expect(r.price).toBeCloseTo(1.99, 6);
    expect(r.promo).toBeNull();
  });
});
