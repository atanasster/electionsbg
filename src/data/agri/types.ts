// Shapes for the ДФ „Земеделие" (CAP paying agency) subsidy payloads, served
// verbatim from agri_payloads (migration 046). See scripts/agri/ingest.ts.

export interface AgriYearTotal {
  year: number;
  totalEur: number;
  rowCount: number;
  entityEur: number;
  individualEur: number;
  entityCount: number;
  individualCount: number;
}

export interface AgriSchemeSlice {
  scheme: string; // Мярка code (short label)
  desc?: string; // full descriptive name (Описание), for the tooltip
  totalEur: number;
  share: number; // % of the latest year's scheme total
}

export interface AgriOblastSlice {
  oblast: string;
  totalEur: number;
  share: number;
}

export interface AgriLorenzPoint {
  x: number; // cumulative % of recipients
  y: number; // cumulative % of money
}

export interface AgriConcentration {
  year: number | null; // null for the all-years scope
  scope: string;
  basis: "legal-entities";
  entityCount: number;
  entityEur: number;
  top1Share: number;
  top10Share: number;
  top100Share: number;
  top1000Share: number;
  lorenz: AgriLorenzPoint[];
}

export interface AgriTopRecipient {
  eik: string;
  name: string;
  oblast: string;
  totalEur: number;
  firstYear: number;
  lastYear: number;
  yearCount: number;
}

export interface AgriIndexFile {
  generatedFrom: string;
  bgnPerEur: number;
  /** The loaded scope: a financial year ("2023") or "all". */
  scope: string;
  scopeYear: number | null; // the year, or null for "all"
  years: number[]; // every available financial year (drives the selector)
  latestYear: number;
  headline: {
    totalEur: number;
    entityEur: number;
    individualEur: number;
    entityCount: number;
    individualCount: number;
    topScheme: { scheme: string; totalEur: number } | null;
  };
  totalsByYear: AgriYearTotal[];
  byScheme: AgriSchemeSlice[];
  byOblast: AgriOblastSlice[];
  concentration: AgriConcentration;
  topRecipients: AgriTopRecipient[];
}

export interface AgriRecipientFile {
  eik: string;
  name: string;
  oblast: string;
  totalEur: number;
  dpEur: number;
  marketEur: number;
  ruralEur: number;
  paymentCount: number;
  firstYear: number;
  lastYear: number;
  byYear: { year: number; totalEur: number }[];
  // `desc` = the descriptive intervention name (may be absent for older codes);
  // render `desc || scheme` so the farm page matches the dashboard's By-scheme.
  byScheme: { scheme: string; desc?: string; totalEur: number }[];
}
