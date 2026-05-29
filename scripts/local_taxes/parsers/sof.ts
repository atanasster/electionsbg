// Sofia (Столична община) naredba parser.
//
// Sofia maintains two naredbi:
//   1. **TAX naredba** — sofia.obshtini.bg/doc/385434 — НОРМД, carries the
//      property-tax rate (Чл. 15), tourist tax (Чл. 71+), and dog tax
//      (Чл. 80+). Lives behind an Angular SPA but reachable directly
//      via the web-api.apis.bg JSON-API bridge (lib/fetch_obshtini_bg.ts).
//   2. **FEES naredba** — published as a direct PDF in the iisda registry
//      at /adm_services/service_regulatory_file/24499_137312. Carries
//      the ТБО chapter (Раздел I).
//
// What ships from each:
//   - FEES → ТБО basis flag (promil, confirmed in Чл. 18 + Чл. 22). Per-
//     year ТБО RATE is set by annual СОС resolution, not in the naredba
//     itself — surfaced as a Bulgarian explanatory note.
//   - TAX → property tax on individuals (rate from Чл. 15), tourist tax,
//     dog tax.
//
// Watch fingerprint: the municipal_naredba source HEAD-probes only the
// FEES URL (parser.url field). The TAX naredba is fetched at parse time
// and changes won't trigger a re-ingest until the FEES URL also flips.
// In practice Sofia revises both naredbi together at end-of-year, so
// the FEES fingerprint catches the common case. Force a re-parse with
// `--force SOF00` if only the TAX naredba changed mid-year.

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
  "https://iisda.government.bg/adm_services/service_regulatory_file/24499_137312";
const TAX_NAREDBA_DOC_ID = 385434;

const NAREDBA_YEAR = 2026;

export const sofParser: NaredbaParser = {
  obshtina: "SOF00",
  label: "Столична община — Наредби за местните данъци и такси",
  url: FEES_NAREDBA_URL,
  documentType: "both",

  async parse() {
    const fees = await fetchNaredbaPdf(FEES_NAREDBA_URL, "sof_fees");
    const tax = await fetchObshtiniBgDocText(
      "sofia",
      TAX_NAREDBA_DOC_ID,
      "sof_tax",
    );

    const block = buildNaredbaBlock(fees.text, {
      year: NAREDBA_YEAR,
      url: FEES_NAREDBA_URL,
    });

    // Patch from the TAX naredba (separate document). buildNaredbaBlock
    // was called with FEES text, which doesn't carry property tax,
    // tourist tax, or dog tax — those live in the TAX naredba only.
    const ptiRate = extractPropertyTaxIndividualsRate(tax.text);
    if (ptiRate != null) {
      block.propertyTaxIndividuals = { rate: ptiRate, year: NAREDBA_YEAR };
    }
    const tt = extractTouristTax(tax.text);
    if (tt) block.touristTax = tt;
    const dt = extractDogTax(tax.text);
    if (dt) block.dogTax = dt;

    // Combined sourceHash so re-running with --force after EITHER naredba
    // upstream-changes produces a fresh watermark.
    const combinedHash = createHash("sha256")
      .update(`${fees.hash}::${tax.hash}`)
      .digest("hex");

    return { obshtina: this.obshtina, block, sourceHash: combinedHash };
  },
};
