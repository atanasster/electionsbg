// Burgas (Община Бургас) naredba parser.
//
// Burgas publishes both naredbi on the council site:
//   - FEES naredba (DOCX): burgascouncil.org/sites/default/files/2024-02/
//     naredba_mestni_danci_i_ceni_na_uslugi_3.docx (carries ТБО + dog
//     tax tariff).
//   - TAX naredba (DOC — legacy binary):
//     burgascouncil.org/sites/default/files/2023-11/naredba-mestni-danci.doc
//     (carries property tax + tourist tax). Converted via macOS textutil
//     in lib/fetch_doc.ts; on Linux operators swap in antiword (same I/O).
//
// Property-tax rate is pinned at 1.75‰ because Burgas's Чл. 18 uses
// anaphoric phrasing ("Данъкът се определя върху данъчната оценка...")
// rather than the "данък върху недвижими имоти" anchor the generic
// extractor requires. Tourist tax is auto-extracted from the .doc text.

import { createHash } from "node:crypto";
import { fetchNaredbaDocx } from "../lib/fetch_docx";
import { fetchNaredbaDoc } from "../lib/fetch_doc";
import {
  buildNaredbaBlock,
  extractDogTax,
  extractTouristTax,
} from "../lib/extract_naredba";
import type { NaredbaParser } from "../types";

const FEES_NAREDBA_URL =
  "https://burgascouncil.org/sites/default/files/2024-02/naredba_mestni_danci_i_ceni_na_uslugi_3.docx";
const TAX_NAREDBA_URL =
  "https://burgascouncil.org/sites/default/files/2023-11/naredba-mestni-danci.doc";

const NAREDBA_YEAR = 2024;
const PROPERTY_TAX_RATE_PROMIL = 1.75; // Чл. 18, изм. Протокол №6/17.12.2015

export const bgsParser: NaredbaParser = {
  obshtina: "BGS04",
  label: "Община Бургас — Наредби за местните данъци и такси",
  url: FEES_NAREDBA_URL,
  secondaryUrls: [TAX_NAREDBA_URL],
  documentType: "both",

  async parse() {
    let fees: Awaited<ReturnType<typeof fetchNaredbaDocx>> | null = null;
    let feesErr: Error | null = null;
    try {
      fees = await fetchNaredbaDocx(FEES_NAREDBA_URL, "bgs_fees");
    } catch (e) {
      feesErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[BGS04] FEES naredba fetch failed: ${feesErr.message}`);
    }

    let tax: Awaited<ReturnType<typeof fetchNaredbaDoc>> | null = null;
    let taxErr: Error | null = null;
    try {
      tax = await fetchNaredbaDoc(TAX_NAREDBA_URL, "bgs_tax");
    } catch (e) {
      taxErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[BGS04] TAX naredba fetch failed: ${taxErr.message}`);
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
            // Тарифа Приложение №3 of the Burgas fees naredba (per
            // Protocol №5/19.12.2023): "За жилищни и вилни имоти на
            // граждани...в гр. Бургас и кварталите му...в промил върху
            // данъчната оценка...1.3 ‰"
            tboResidentialRate: 1.3,
            tboResidentialZone: "гр. Бургас + кварталите",
          },
        })
      : { year: NAREDBA_YEAR, url: FEES_NAREDBA_URL };

    if (tax) {
      // Pinned because Burgas's Чл. 18 phrasing doesn't clear the
      // generic extractor's "данък върху недвижими имоти" anchor.
      block.propertyTaxIndividuals = {
        rate: PROPERTY_TAX_RATE_PROMIL,
        year: NAREDBA_YEAR,
      };
      const tt = extractTouristTax(tax.text);
      if (tt) block.touristTax = tt;
    }
    // Dog tax lives in the FEES naredba (тарифа Приложение №2).
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
