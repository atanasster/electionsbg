// Unit tests for the Layer 2 deed scraper, against real captured fixtures spanning
// EOOD / OOD / AD / EAD / ET / ЮЛНЦ / bankrupt (the entity types §4.1 called for).
// The fixtures are verbatim CR Deeds bodies captured 2026-07-27.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCrDeed,
  parseParty,
  parseCapital,
  fieldRecords,
  stripHtml,
  decodeEntities,
} from "./parse_cr_deeds";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "cr_deeds",
);
const load = (name: string) =>
  fs.readFileSync(path.join(dir, `${name}.json`), "utf8");

describe("html helpers", () => {
  it("decodes the entities the CR renderer emits", () => {
    expect(decodeEntities("&quot;АБВ&quot; &amp; &#039;x&#039;")).toBe(
      "\"АБВ\" & 'x'",
    );
  });

  it("splits a multi-person field into one record per <p class='field-text'>", () => {
    const html =
      "<div class='record-container'><p class='field-text'>А, Държава: БЪЛГАРИЯ</p></div>" +
      "<hr class='hr--report' />" +
      "<div class='record-container'><p class='field-text'>Б, Държава: ИСПАНИЯ</p></div>";
    expect(fieldRecords(html)).toEqual([
      "А, Държава: БЪЛГАРИЯ",
      "Б, Държава: ИСПАНИЯ",
    ]);
  });

  it("collapses <br/> and nested tags into one line", () => {
    expect(stripHtml("гр. София<br/>р-н Младост")).toBe(
      "гр. София р-н Младост",
    );
  });
});

describe("parseParty", () => {
  it("reads a natural person with country", () => {
    const p = parseParty(
      "ИВЕЛИНА ИВАНОВА НИКОЛОВА, Държава: БЪЛГАРИЯ",
      "manager",
      "00070",
      "2025-09-17",
    );
    expect(p).toMatchObject({
      name: "ИВЕЛИНА ИВАНОВА НИКОЛОВА",
      isLegalEntity: false,
      eik: null,
      country: "БЪЛГАРИЯ",
      role: "manager",
      entryDate: "2025-09-17",
    });
  });

  it("reads a legal-entity owner and extracts its ЕИК (the ownership chain)", () => {
    const p = parseParty(
      "ОБЩИНА РАЗЛОГ, ЕИК/ПИК 000024948",
      "sole_owner",
      "00230",
      "2008-09-04",
    );
    expect(p).toMatchObject({
      name: "ОБЩИНА РАЗЛОГ",
      isLegalEntity: true,
      eik: "000024948",
    });
  });

  it("flags a foreign legal person via 'Идентификация' + 'юридическо лице'", () => {
    const p = parseParty(
      '"ШНАЙДЕР ЕЛЕКТРИК ИНДЪСТРИЗ" С.А.С., Идентификация 954503439, Чуждестранно юридическо лице, Държава: ФРАНЦИЯ',
      "sole_owner",
      "00230",
      null,
    );
    expect(p.isLegalEntity).toBe(true);
    expect(p.eik).toBe("954503439");
    expect(p.country).toBe("ФРАНЦИЯ");
  });

  it("reads a ЮЛНЦ board position label", () => {
    const p = parseParty(
      "ИВАН НИКОЛОВ ЧЕРНОЗЕМСКИ, Държава: БЪЛГАРИЯ, Длъжност: Председател на Управителния съвет",
      "ngo_board",
      "00100",
      null,
    );
    expect(p.positionLabel).toBe("Председател на Управителния съвет");
    expect(p.country).toBe("БЪЛГАРИЯ");
  });
});

describe("parseCapital", () => {
  it("reads amount + currency, mapping € to EUR", () => {
    expect(parseCapital("5112918.81 €")).toEqual({
      amount: 5112918.81,
      currency: "EUR",
    });
  });
  it("handles a лв amount with a comma decimal", () => {
    expect(parseCapital("5 000,00 лв.")).toEqual({
      amount: 5000.0,
      currency: "BGN",
    });
  });
});

describe("parseCrDeed — against real fixtures", () => {
  it("rejects a non-answer body (never project from it)", () => {
    expect(parseCrDeed(null)).toBeNull();
    expect(parseCrDeed("")).toBeNull();
    expect(parseCrDeed("<html>blocked</html>")).toBeNull();
    expect(parseCrDeed("{}")).toBeNull(); // valid JSON, not a deed tree
  });

  it("EOOD: resolves the sole owner, managers, UBO, capital, founding date", () => {
    const d = parseCrDeed(load("eood1"));
    expect(d).not.toBeNull();
    expect(d!.uic).toBe("121587769");
    expect(d!.legalFormCode).toBe(10);
    // sole owner is the foreign legal person, with its identification
    const owner = d!.parties.find((p) => p.role === "sole_owner");
    expect(owner?.isLegalEntity).toBe(true);
    expect(owner?.eik).toBe("954503439");
    // three managers (natural persons), one Spanish
    const managers = d!.parties.filter((p) => p.role === "manager");
    expect(managers.length).toBe(3);
    expect(managers.some((m) => m.country === "ИСПАНИЯ")).toBe(true);
    expect(d!.parties.some((p) => p.role === "actual_owner")).toBe(true);
    expect(d!.capitalAmount).toBeGreaterThan(5_000_000);
    expect(d!.capitalCurrency).toBe("EUR");
    expect(d!.foundingDate).toBe("2008-08-25");
  });

  it("EOOD (МБАЛ Разлог): the recovered owner is a municipality, not a person", () => {
    const d = parseCrDeed(load("eood2"));
    const owner = d!.parties.find((p) => p.role === "sole_owner");
    expect(owner?.name).toContain("ОБЩИНА РАЗЛОГ");
    expect(owner?.isLegalEntity).toBe(true);
    expect(owner?.eik).toBe("000024948");
  });

  it("OOD: reads съдружници (partners) and a manager", () => {
    const d = parseCrDeed(load("ood"));
    expect(d!.parties.some((p) => p.role === "partner")).toBe(true);
    expect(d!.parties.some((p) => p.role === "manager")).toBe(true);
  });

  it("EAD: sole owner is Столична община (state-owned)", () => {
    const d = parseCrDeed(load("ead"));
    expect(d!.legalFormCode).toBe(11);
    const owner = d!.parties.find((p) => p.role === "sole_owner");
    expect(owner?.isLegalEntity).toBe(true);
    expect(owner?.name).toContain("ОБЩИНА");
  });

  it("AD: reads board members (director role)", () => {
    const d = parseCrDeed(load("ad"));
    expect(d!.legalFormCode).toBe(5);
    expect(
      d!.parties.filter((p) => p.role === "director").length,
    ).toBeGreaterThan(0);
  });

  it("ЮЛНЦ: reads the governing board with position labels", () => {
    const d = parseCrDeed(load("ngofound"));
    const board = d!.parties.filter((p) => p.role === "ngo_board");
    expect(board.length).toBeGreaterThan(0);
    expect(board.some((b) => b.positionLabel?.includes("Председател"))).toBe(
      true,
    );
  });

  it("every fixture parses to a deed with a uic and a founding date", () => {
    for (const name of [
      "eood1",
      "eood2",
      "ead",
      "ad",
      "ood",
      "ngofound",
      "et",
      "bankrupt",
    ]) {
      const d = parseCrDeed(load(name));
      expect(d, name).not.toBeNull();
      expect(d!.uic, name).toBeTruthy();
      expect(d!.foundingDate, name).toMatch(/^\d{4}-\d\d-\d\d$/);
    }
  });

  it("never emits a natural person carrying an eik, nor an entity without one flagged", () => {
    // Guard the person-graph boundary (plan §8.4): eik ⟺ isLegalEntity for every party.
    for (const name of ["eood1", "eood2", "ead", "ad", "ood", "ngofound"]) {
      for (const p of parseCrDeed(load(name))!.parties) {
        if (p.eik) expect(p.isLegalEntity, `${name}:${p.name}`).toBe(true);
        if (!p.isLegalEntity) expect(p.eik, `${name}:${p.name}`).toBeNull();
      }
    }
  });
});
