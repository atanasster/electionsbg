// Shared types for the Tier B naredba parsers + the merged data file.
// Kept in a tiny standalone module so the watch source can import the
// basis label without pulling in the whole build script.

export type TboBasis = "promil" | "users" | "area" | "volume";

export type NaredbaBlock = {
  year: number;
  url: string;
  tboResidential?: {
    basis: TboBasis;
    rate?: number;
    unit?: string;
    zone?: string;
    note?: string;
  };
  touristTax?: { value: number; unit: string };
  dogTax?: { value: number; unit: string };
  // Property tax on residential real estate (set per Чл. 22 ЗМДТ; legal
  // range 0.1-4.5‰ of данъчна оценка). In Bulgarian law a SINGLE rate
  // is set per município that applies to both individuals and legal
  // entities; the user-facing label is "данък за физически лица"
  // because that's how households think about it. ИПИ's
  // `property_tax_legal` indicator records the same rate from a
  // different source — they agree to within rounding for every
  // município we've cross-checked. Surfaced only when the TAX naredba
  // is reachable (Sofia needs the obshtini.bg JSON-API bridge; Plovdiv
  // / Varna / Burgas still deferred until their TAX-naredba sources
  // are reachable).
  propertyTaxIndividuals?: {
    rate: number; // ‰
    year: number;
    note?: string;
  };
};

export type NaredbaParserResult = {
  obshtina: string;
  block: NaredbaBlock;
  sourceHash: string; // SHA-256 of the source bytes — feeds the watch fingerprint
  // Per-side status for multi-source parsers (e.g. Sofia fetches a FEES
  // PDF + a TAX naredba). Lets the dispatcher surface partial success so
  // operators can see when one side fetched and the other didn't.
  // `null` for single-source parsers.
  sides?: Record<string, "ok" | "failed"> | null;
};

export type NaredbaParser = {
  obshtina: string;
  label: string;
  url: string;
  /** Additional source URLs the parser also fetches at parse time.
   *  Surfaced so the watcher can fingerprint every upstream document,
   *  not just `url`. Sofia, for example, draws ТБО from the FEES PDF
   *  (`url`) and property/tourist/dog tax from the TAX naredba
   *  (`secondaryUrls`) — without listing the TAX URL here, a mid-year
   *  TAX revision wouldn't flip the watcher until the FEES naredba
   *  also changed. */
  secondaryUrls?: string[];
  /** Document type the URL points at — drives which extractors run.
   *  "fees" → carries ТБО only; "tax" → carries tourist + dog; "both"
   *  → a single document covering everything (uncommon). */
  documentType: "fees" | "tax" | "both";
  parse(): Promise<NaredbaParserResult>;
};
