// Varna (Община Варна) naredba parser.
//
// Varna publishes both naredbi on multiple platforms:
//   - FEES naredba: direct PDF on varna.bg/upload/20701/... (current,
//     carries ТБО — Раздел I). Kept on the direct-PDF path because it's
//     already wired and the `tboResidentialRate: 1.5` override is
//     verified against Чл. 18 of that PDF.
//   - TAX naredba: varna.obshtini.bg/doc/345772 — НОРМД, carries the
//     property-tax rate (Чл. 14: 2‰ as of 2025) and tourist + dog tax.
//     Reached via the lib/fetch_obshtini_bg.ts JSON-API bridge.
//
// Partial-success pattern: if one side fails the other still ships.

import { createHash } from "node:crypto";
import { fetchNaredbaPdf } from "../lib/fetch_pdf";
import { fetchObshtiniBgDocText } from "../lib/fetch_obshtini_bg";
import {
  buildNaredbaBlock,
  extractDogTax,
  extractPropertyTaxIndividualsRate,
  extractTouristTax,
} from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_URL =
  "https://www.varna.bg/upload/20701/NAREDBA_na_ObS_Varna_za_opredelqneto_i_administriraneto_na_mestnite_taksi_i_ceni_na_uslugi_na_terito.pdf";
const TAX_NAREDBA_DOC_ID = 345772;
const TAX_NAREDBA_URL = `https://varna.obshtini.bg/doc/${TAX_NAREDBA_DOC_ID}`;

const NAREDBA_YEAR = 2025;

export const varParser: NaredbaParser = {
  obshtina: "VAR06",
  label: "Община Варна — Наредби за местните данъци и такси",
  url: FEES_NAREDBA_URL,
  secondaryUrls: [TAX_NAREDBA_URL],
  documentType: "both",

  async parse() {
    let fees: Awaited<ReturnType<typeof fetchNaredbaPdf>> | null = null;
    let feesErr: Error | null = null;
    try {
      fees = await fetchNaredbaPdf(FEES_NAREDBA_URL, "var_fees");
    } catch (e) {
      feesErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[VAR06] FEES naredba fetch failed: ${feesErr.message}`);
    }

    let tax: Awaited<ReturnType<typeof fetchObshtiniBgDocText>> | null = null;
    let taxErr: Error | null = null;
    try {
      tax = await fetchObshtiniBgDocText(
        "varna",
        TAX_NAREDBA_DOC_ID,
        "var_tax",
      );
    } catch (e) {
      taxErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[VAR06] TAX naredba fetch failed: ${taxErr.message}`);
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
          overrides: {
            // Чл. 18 of the Varna fees naredba (per amendment in force from
            // 1.01.2025): "за жилищни имоти на граждани и предприятия в
            // размер на 1,5 на хиляда пропорционално върху данъчната оценка"
            tboResidentialRate: 1.5,
            tboResidentialZone: "градско ядро",
          },
        })
      : { year: NAREDBA_YEAR, url: FEES_NAREDBA_URL };

    if (tax) {
      const ptiRate = extractPropertyTaxIndividualsRate(tax.text);
      if (ptiRate != null) {
        block.propertyTaxIndividuals = { rate: ptiRate, year: NAREDBA_YEAR };
      }
      const tt = extractTouristTax(tax.text);
      if (tt) block.touristTax = tt;
    }
    // Dog tax lives in the FEES naredba (такси). Fall back to TAX text.
    const dt =
      (fees && extractDogTax(fees.text)) ||
      (tax && extractDogTax(tax.text)) ||
      null;
    if (dt) block.dogTax = dt;

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
