// Programme taxonomy: maps an ИСУН programme code (e.g. "2014BG16RFOP002") to
// the programming period, fund family, and managing authority. Inferred from
// the EU-wide structural-funds CCI code pattern — keeps the lookup
// maintenance-free as new programmes appear in the 2021-27 / NRRP rollout.
//
// CCI pattern:
//   {periodPrefix}BG{fundSegment}{seq}
//   - periodPrefix: "2014" → 2014-2020, "2021" → 2021-2027
//   - fundSegment: e.g. "16RFOP" (ERDF, 2014-20), "16FFPR" (ERDF+CF, 2021-27),
//     "05M9OP" (ESF, 2014-20), "05SFPR" (ESF+, 2021-27), "16M1OP" (CF, 2014-20),
//     "06RDNP" (EAFRD), "14MFOP" (EMFF), "16RFPR" (ERDF Competitiveness,
//     2021-27), "16JTPR" (Just Transition, 2021-27)
//   - special-case "2021BG-RRP" → National Recovery & Resilience Plan (NRRP)
//   - everything else → "Other"

export type FundsPeriod = "2007-13" | "2014-20" | "2021-27" | "RRP";
export type FundType =
  | "ERDF"
  | "ESF"
  | "CF"
  | "EAFRD"
  | "EMFF"
  | "JTF"
  | "RRP"
  | "Other";

export interface ProgrammeTaxonomy {
  period: FundsPeriod;
  fundType: FundType;
  // Short, viz-friendly label combining period + fund (e.g. "ERDF 2014-20").
  bucket: string;
  // Sankey-friendly fund key — collapses ESF and ESF+ into one stream.
  fundLabel: string;
}

const FUND_LABELS: Record<FundType, string> = {
  ERDF: "ERDF",
  ESF: "ESF",
  CF: "CF",
  EAFRD: "EAFRD",
  EMFF: "EMFF",
  JTF: "JTF",
  RRP: "RRP (ПВУ)",
  Other: "Other",
};

const inferFromCode = (
  code: string,
): { period: FundsPeriod; fundType: FundType } => {
  // National Recovery and Resilience Plan — its own envelope.
  if (/^2021BG-?RRP/i.test(code)) return { period: "RRP", fundType: "RRP" };
  if (/^2014BG[-_ ]?RRP/i.test(code)) return { period: "RRP", fundType: "RRP" };

  // Conventional CCI prefix.
  const m = /^(\d{4})BG(.+)$/.exec(code);
  if (!m) return { period: "2014-20", fundType: "Other" };
  const yr = parseInt(m[1], 10);
  const segment = m[2];

  const period: FundsPeriod =
    yr >= 2021 ? "2021-27" : yr >= 2014 ? "2014-20" : "2007-13";

  // 2014-2020 vocabulary.
  if (period === "2014-20") {
    if (/^16RFOP/.test(segment)) return { period, fundType: "ERDF" };
    if (/^16M1OP/.test(segment)) return { period, fundType: "CF" };
    if (/^05M9OP/.test(segment)) return { period, fundType: "ESF" };
    if (/^06RDNP/.test(segment)) return { period, fundType: "EAFRD" };
    if (/^14MFOP/.test(segment)) return { period, fundType: "EMFF" };
    return { period, fundType: "Other" };
  }

  // 2021-2027 vocabulary — funds got renamed (ESF → ESF+) and bundled
  // (16FFPR = ERDF+CF programme for Transport).
  if (/^16FFPR/.test(segment)) return { period, fundType: "ERDF" };
  if (/^16RFPR/.test(segment)) return { period, fundType: "ERDF" };
  if (/^05SFPR/.test(segment)) return { period, fundType: "ESF" };
  if (/^14MFPR/.test(segment)) return { period, fundType: "EMFF" };
  if (/^06RDPR/.test(segment)) return { period, fundType: "EAFRD" };
  if (/^16JTPR/.test(segment)) return { period, fundType: "JTF" };

  return { period, fundType: "Other" };
};

export const inferTaxonomy = (code: string): ProgrammeTaxonomy => {
  const { period, fundType } = inferFromCode(code);
  return {
    period,
    fundType,
    bucket: `${FUND_LABELS[fundType]} ${period}`,
    fundLabel: FUND_LABELS[fundType],
  };
};

export const fundLabel = (fundType: FundType): string => FUND_LABELS[fundType];

export const allPeriods: FundsPeriod[] = [
  "2007-13",
  "2014-20",
  "2021-27",
  "RRP",
];
