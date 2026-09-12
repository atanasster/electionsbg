// Canonical funding classifications must not inherit legacy guesses for unknown codes.
export function fundingProgrammeClass(code: string, fundType: string) {
  const rrp = /^(?:2021BG-?RRP|2014BG[-_ ]?RRP)/i.test(code);
  const eea = /^BG(?:ENERGY|CULTURE|LD|JUSTICE|HOMEAFFAIRS|ENVIRONMENT)$/.test(
    code,
  );
  const conventional = /^(2007|2014|2021)BG/.exec(code);
  return {
    period:
      rrp || !conventional
        ? "unknown"
        : (
            {
              "2007": "2007-2013",
              "2014": "2014-2020",
              "2021": "2021-2027",
            } as Record<string, string>
          )[conventional[1]],
    mechanism: rrp
      ? "RRP"
      : eea
        ? "EEA-Norway"
        : conventional
          ? "EU"
          : "unknown",
    fundType: rrp ? "RRP" : fundType,
  };
}
export const FUNDING_EXTRA_THEMES = [
  {
    id: "health",
    label_bg: "Здравеопазване (по заглавие)",
    label_en: "Healthcare (title search)",
    keywords: [
      "здравеопаз",
      "болниц",
      "медицин",
      "здравни услуги",
      "здравна помощ",
    ],
    programme_ids: [],
  },
];
