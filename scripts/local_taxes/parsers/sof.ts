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
// Watch fingerprint: the municipal_naredba source HEAD-probes the FEES
// URL (parser.url) and the TAX naredba (parser.secondaryUrls), so a
// change to either flips the watcher. In practice Sofia revises both
// naredbi together at end-of-year. Force a re-parse with `--force SOF00`.

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
const TAX_NAREDBA_URL = `https://sofia.obshtini.bg/doc/${TAX_NAREDBA_DOC_ID}`;

const NAREDBA_YEAR = 2026;

export const sofParser: NaredbaParser = {
  obshtina: "SOF00",
  label: "Столична община — Наредби за местните данъци и такси",
  url: FEES_NAREDBA_URL,
  secondaryUrls: [TAX_NAREDBA_URL],
  documentType: "both",

  async parse() {
    // Fetch each side independently. iisda.government.bg has gone down
    // before; web-api.apis.bg less so but still external. If one side
    // fails we ship a partial block from the other rather than yielding
    // nothing for SOF00.
    let fees: Awaited<ReturnType<typeof fetchNaredbaPdf>> | null = null;
    let feesErr: Error | null = null;
    try {
      fees = await fetchNaredbaPdf(FEES_NAREDBA_URL, "sof_fees");
    } catch (e) {
      feesErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[SOF00] FEES naredba fetch failed: ${feesErr.message}`);
    }

    let tax: Awaited<ReturnType<typeof fetchObshtiniBgDocText>> | null = null;
    let taxErr: Error | null = null;
    try {
      tax = await fetchObshtiniBgDocText(
        "sofia",
        TAX_NAREDBA_DOC_ID,
        "sof_tax",
      );
    } catch (e) {
      taxErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[SOF00] TAX naredba fetch failed: ${taxErr.message}`);
    }

    if (!fees && !tax) {
      throw new Error(
        `both sides failed — FEES: ${feesErr?.message ?? "?"} · TAX: ${taxErr?.message ?? "?"}`,
      );
    }

    // FEES carries the ТБО basis + note; without it the block has no
    // tboResidential. Skip buildNaredbaBlock entirely when FEES is gone
    // — it would only set tboResidential from FEES text anyway.
    const block = fees
      ? buildNaredbaBlock(fees.text, {
          year: NAREDBA_YEAR,
          url: FEES_NAREDBA_URL,
        })
      : { year: NAREDBA_YEAR, url: FEES_NAREDBA_URL };

    // Patch from the TAX naredba (separate document). Property tax,
    // tourist tax, and dog tax live only in the TAX naredba.
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

    // Combine sourceHash from only the sides that fetched, so the watch
    // watermark still flips when the surviving side changes upstream.
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
