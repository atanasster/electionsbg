// Shared types for the municipal cash-execution (касово изпълнение) pillar.
//
// Source is the MINFIN B3 ЕБК template (ОТЧЕТНИ ДАННИ ПО ЕБК ЗА ИЗПЪЛНЕНИЕТО
// НА БЮДЖЕТА) that a handful of общини publish to data.egov.bg. The template
// is uniform across municipalities, so one parser + one tile serve every
// covered муни — unlike capital programmes, where each município's PDF/XLSX
// layout needed its own parser.

export interface Money {
  amount: number; // native amount (BGN through 2025, EUR from 2026)
  currency: "BGN" | "EUR";
  amountEur: number; // always EUR, for cross-year comparison
}

export interface ExecutionParagraph {
  code: string; // ЕБК economic paragraph, e.g. "01-00", "13-00"
  name: string; // Bulgarian label as published
  plan: Money; // Уточнен план (revised annual plan)
  actual: Money; // Отчет (cash execution)
  executionPct: number | null; // actual / plan × 100, null when plan is 0
}

export interface ExecutionSide {
  plan: Money;
  actual: Money;
  executionPct: number | null;
  // Economic-paragraph (XX-00) rollups; под-§ detail is intentionally dropped.
  byParagraph: ExecutionParagraph[];
}

export interface MunicipalExecutionFile {
  obshtina: string; // canonical obshtina code, e.g. "RSE27"
  muniSlug: string; // "ruse"
  muniNameBg: string;
  muniNameEn: string;
  fiscalYear: number;
  period: {
    start: string; // ISO date
    end: string; // ISO date
    isFullYear: boolean; // end is 31 Dec
    labelBg: string; // "01.01.2024 – 31.12.2024"
  };
  currency: "BGN" | "EUR";
  generatedAt: string;
  source: {
    publisher: string;
    datasetUrl: string;
    resourceUri: string;
    fetchedAt: string;
  };
  revenue: ExecutionSide;
  expense: ExecutionSide;
}

export interface MunicipalExecutionIndexEntry {
  muniSlug: string;
  obshtina: string;
  muniNameBg: string;
  muniNameEn: string;
  years: number[]; // ascending; years with a committed file on disk
  // Latest year whose report covers the full fiscal year (period ends 31 Dec).
  // The tile defaults to this so the headline isn't a mid-year partial.
  latestFullYear: number | null;
}

export interface MunicipalExecutionIndexFile {
  generatedAt: string;
  municipalities: MunicipalExecutionIndexEntry[];
}
