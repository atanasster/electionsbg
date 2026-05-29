// Factory for naredba parsers whose FEES + TAX documents both live on
// the `*.obshtini.bg` Angular SPA platform. Each per-município parser
// becomes a thin config object; the multi-source fetch + extract +
// partial-success bookkeeping lives here.
//
// Use the per-município module pattern for documentation and to give the
// watcher a stable parser.url field, but bottle the logic so adding a
// new município is a 10-line declaration instead of a 100-line copy.

import { createHash } from "node:crypto";
import { fetchObshtiniBgDocText } from "./fetch_obshtini_bg";
import {
  buildNaredbaBlock,
  extractDogTax,
  extractPropertyTaxIndividualsRate,
  extractTouristTax,
} from "./extract_naredba";
import type { NaredbaParser, NaredbaParserResult } from "../types";

export type ObshtiniBgNaredbaConfig = {
  /** Canonical obshtina code (e.g. "RAZ26"). */
  obshtina: string;
  /** Subdomain on obshtini.bg (e.g. "razgrad"). */
  slug: string;
  /** The FEES naredba doc ID — carries ТБО + service-fees tariff. */
  feesDocId: number;
  /** The TAX naredba doc ID — carries property tax + tourist + dog.
   *  Optional; some municípios only publish FEES on the platform. */
  taxDocId?: number;
  /** In-force year used as the `year` value on the emitted block. */
  year: number;
  /** Human-readable label for the watcher and dispatcher output. */
  label: string;
  /** Optional explicit ТБО rate override (Чл. of the FEES naredba), in
   *  ‰ — passed straight through to `buildNaredbaBlock.overrides`
   *  when the rate isn't reliably auto-extractable. */
  tboResidentialRate?: number;
  tboResidentialZone?: string;
  /** Optional explicit property-tax-for-individuals rate (‰). Some
   *  municípios write the rate clause without the "върху данъчната
   *  оценка" tail anchor the auto-extractor requires (e.g. Samokov's
   *  "се определя на 2,5 на хиляда."). When the auto-extractor returns
   *  null but a per-município reading of the naredba confirms a rate,
   *  pin it here. */
  propertyTaxIndividualsRate?: number;
};

export const createObshtiniBgNaredbaParser = (
  cfg: ObshtiniBgNaredbaConfig,
): NaredbaParser => {
  const feesUrl = `https://${cfg.slug}.obshtini.bg/doc/${cfg.feesDocId}`;
  const taxUrl = cfg.taxDocId
    ? `https://${cfg.slug}.obshtini.bg/doc/${cfg.taxDocId}`
    : null;
  return {
    obshtina: cfg.obshtina,
    label: cfg.label,
    url: feesUrl,
    secondaryUrls: taxUrl ? [taxUrl] : undefined,
    documentType: taxUrl ? "both" : "fees",

    async parse(): Promise<NaredbaParserResult> {
      let fees: Awaited<ReturnType<typeof fetchObshtiniBgDocText>> | null =
        null;
      let feesErr: Error | null = null;
      try {
        fees = await fetchObshtiniBgDocText(
          cfg.slug,
          cfg.feesDocId,
          `${cfg.slug}_fees`,
        );
      } catch (e) {
        feesErr = e instanceof Error ? e : new Error(String(e));
        console.warn(
          `[${cfg.obshtina}] FEES naredba fetch failed: ${feesErr.message}`,
        );
      }

      let tax: Awaited<ReturnType<typeof fetchObshtiniBgDocText>> | null = null;
      let taxErr: Error | null = null;
      if (cfg.taxDocId != null) {
        try {
          tax = await fetchObshtiniBgDocText(
            cfg.slug,
            cfg.taxDocId,
            `${cfg.slug}_tax`,
          );
        } catch (e) {
          taxErr = e instanceof Error ? e : new Error(String(e));
          console.warn(
            `[${cfg.obshtina}] TAX naredba fetch failed: ${taxErr.message}`,
          );
        }
      }

      if (!fees && !tax) {
        throw new Error(
          `both sides failed — FEES: ${feesErr?.message ?? "?"} · TAX: ${taxErr?.message ?? "?"}`,
        );
      }

      const block = fees
        ? buildNaredbaBlock(fees.text, {
            year: cfg.year,
            url: feesUrl,
            overrides:
              cfg.tboResidentialRate != null
                ? {
                    tboResidentialRate: cfg.tboResidentialRate,
                    tboResidentialZone: cfg.tboResidentialZone,
                  }
                : undefined,
          })
        : { year: cfg.year, url: feesUrl };

      if (tax) {
        const ptiRate =
          cfg.propertyTaxIndividualsRate ??
          extractPropertyTaxIndividualsRate(tax.text);
        if (ptiRate != null) {
          block.propertyTaxIndividuals = { rate: ptiRate, year: cfg.year };
        }
        const tt = extractTouristTax(tax.text);
        if (tt) block.touristTax = tt;
      }
      // Dog tax most commonly lives in the FEES naredba (НОАМТЦУ
      // "такси"), but some municípios (Samokov) put it in TAX. Run
      // against both; FEES wins because that's where ЗМДТ Чл. 175(2)
      // is implemented for most municípios.
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

      const sides: NaredbaParserResult["sides"] = {
        fees: fees ? "ok" : "failed",
      };
      if (cfg.taxDocId != null) {
        sides!.tax = tax ? "ok" : "failed";
      }

      return {
        obshtina: cfg.obshtina,
        block,
        sourceHash: combinedHash,
        sides,
      };
    },
  };
};
