// Shared catalogue of the five ИПИ tax indicators we pull from
// 265obshtini.bg. Imported by both the watcher (for the fingerprint id
// list) and the build script (for the per-indicator labels + units).
//
// Indicator ids are stable URL fragments — verified against the public
// /map/{id} pages on 265obshtini.bg. Each id corresponds to one
// `/downloadCSV/{id}` endpoint returning rows
// `Община,YYYY,YYYY,YYYY,YYYY,YYYY`.
//
// "Direction" tells the UI how to colour-ramp the rank:
//   - "lower-better": rate increase = burden for taxpayer (default for
//     property/vehicle/patent — citizens see lower as friendlier).

export type IpiIndicatorKey =
  | "property_tax_legal"
  | "transfer_tax"
  | "vehicle_tax_74_110kw"
  | "patent_tax_retail"
  | "patent_tax_taxi";

export type IpiIndicator = {
  key: IpiIndicatorKey;
  ipiId: number;
  unit: string;
  direction: "lower-better";
  label: { bg: string; en: string };
};

export const IPI_INDICATORS: IpiIndicator[] = [
  {
    key: "property_tax_legal",
    ipiId: 615,
    unit: "‰",
    direction: "lower-better",
    label: {
      bg: "Данък върху недвижимите имоти (юридически лица)",
      en: "Property tax (legal entities)",
    },
  },
  {
    key: "transfer_tax",
    ipiId: 616,
    unit: "%",
    direction: "lower-better",
    label: {
      bg: "Данък при придобиване на имущество",
      en: "Property-transfer tax",
    },
  },
  {
    key: "vehicle_tax_74_110kw",
    ipiId: 617,
    // BGN per kW of engine power — for a typical 100 kW passenger car at
    // a 1.21 BGN/kW rate, annual tax = 121 BGN. The 74–110 kW band is the
    // middle of the ЗМДТ tariff grid and the slice ИПИ tracks as the
    // representative comparison point.
    unit: "BGN/kW",
    direction: "lower-better",
    label: {
      bg: "Данък върху превозните средства (74–110 kW)",
      en: "Vehicle tax (74–110 kW)",
    },
  },
  {
    key: "patent_tax_retail",
    ipiId: 618,
    unit: "BGN",
    direction: "lower-better",
    label: {
      bg: "Патентен данък (търговия на дребно ≤ 100 м²)",
      en: "Patent tax (retail ≤ 100 m²)",
    },
  },
  {
    key: "patent_tax_taxi",
    ipiId: 360,
    unit: "BGN",
    direction: "lower-better",
    label: {
      bg: "Патентен данък (такси)",
      en: "Patent tax (taxi)",
    },
  },
];

export const IPI_CSV_URL = (id: number): string =>
  `https://www.265obshtini.bg/downloadCSV/${id}`;
