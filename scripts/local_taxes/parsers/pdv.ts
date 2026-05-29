// Plovdiv (Община Пловдив) naredba parser.
//
// Plovdiv publishes both naredbi on the obshtini.bg Angular SPA platform:
//   - FEES naredba (НОАМТЦУ): plovdiv.obshtini.bg/doc/388893 — carries
//     ТБО (Раздел I) + service-fees tariff.
//   - TAX naredba (НОРМД): plovdiv.obshtini.bg/doc/388894 — discovered
//     via the platform's DocList API. Carries the property-tax rate
//     (Чл. 15: 1.8‰ as of 2025) plus tourist + dog tax.
//
// Both reachable via the lib/fetch_obshtini_bg.ts JSON-API bridge — no
// Playwright session required.
//
// Mirrors Sofia's partial-success pattern: if one side fails the other
// still ships, with per-side status reported in `sides`.

import { createHash } from "node:crypto";
import { fetchObshtiniBgDocText } from "../lib/fetch_obshtini_bg";
import {
  buildNaredbaBlock,
  extractDogTax,
  extractPropertyTaxIndividualsRate,
  extractTouristTax,
} from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_DOC_ID = 388893;
const FEES_NAREDBA_URL = `https://plovdiv.obshtini.bg/doc/${FEES_NAREDBA_DOC_ID}`;
const TAX_NAREDBA_DOC_ID = 388894;
const TAX_NAREDBA_URL = `https://plovdiv.obshtini.bg/doc/${TAX_NAREDBA_DOC_ID}`;

const NAREDBA_YEAR = 2025;

export const pdvParser: NaredbaParser = {
  obshtina: "PDV22",
  label: "Община Пловдив — Наредби за местните данъци и такси",
  url: FEES_NAREDBA_URL,
  secondaryUrls: [TAX_NAREDBA_URL],
  documentType: "both",

  async parse() {
    let fees: Awaited<ReturnType<typeof fetchObshtiniBgDocText>> | null = null;
    let feesErr: Error | null = null;
    try {
      fees = await fetchObshtiniBgDocText(
        "plovdiv",
        FEES_NAREDBA_DOC_ID,
        "pdv_fees",
      );
    } catch (e) {
      feesErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[PDV22] FEES naredba fetch failed: ${feesErr.message}`);
    }

    let tax: Awaited<ReturnType<typeof fetchObshtiniBgDocText>> | null = null;
    let taxErr: Error | null = null;
    try {
      tax = await fetchObshtiniBgDocText(
        "plovdiv",
        TAX_NAREDBA_DOC_ID,
        "pdv_tax",
      );
    } catch (e) {
      taxErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[PDV22] TAX naredba fetch failed: ${taxErr.message}`);
    }

    if (!fees && !tax) {
      throw new Error(
        `both sides failed — FEES: ${feesErr?.message ?? "?"} · TAX: ${taxErr?.message ?? "?"}`,
      );
    }

    const block = fees
      ? buildNaredbaBlock(fees.text, {
          year: NAREDBA_YEAR,
          url: FEES_NAREDBA_URL,
        })
      : { year: NAREDBA_YEAR, url: FEES_NAREDBA_URL };

    if (tax) {
      const ptiRate = extractPropertyTaxIndividualsRate(tax.text);
      if (ptiRate != null) {
        block.propertyTaxIndividuals = { rate: ptiRate, year: NAREDBA_YEAR };
      }
      const tt = extractTouristTax(tax.text);
      if (tt) block.touristTax = tt;
      const dt = extractDogTax(tax.text);
      if (dt) block.dogTax = dt;
    }

    const hashParts: string[] = [];
    if (fees) hashParts.push(`fees=${fees.hash}`);
    if (tax) hashParts.push(`tax=${tax.hash}`);
    const combinedHash = createHash("sha256")
      .update(hashParts.join("::"))
      .digest("hex");

    return {
      obshtina: this.obshtina,
      block,
      sourceHash: combinedHash,
      sides: {
        fees: fees ? "ok" : "failed",
        tax: tax ? "ok" : "failed",
      } as const,
    };
  },
};
