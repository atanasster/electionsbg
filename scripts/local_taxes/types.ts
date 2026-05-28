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
};

export type NaredbaParserResult = {
  obshtina: string;
  block: NaredbaBlock;
  sourceHash: string; // SHA-256 of the source bytes — feeds the watch fingerprint
};

export type NaredbaParser = {
  obshtina: string;
  label: string;
  url: string;
  /** Document type the URL points at — drives which extractors run.
   *  "fees" → carries ТБО only; "tax" → carries tourist + dog; "both"
   *  → a single document covering everything (uncommon). */
  documentType: "fees" | "tax" | "both";
  parse(): Promise<NaredbaParserResult>;
};
