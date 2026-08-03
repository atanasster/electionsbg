// Official English names for the ИСУН programmes.
//
// ИСУН publishes programme names in Bulgarian only. Without an English name the
// /en programme page carries the Bulgarian one in its <h1> and <title>, so it
// differs from the Bulgarian page in boilerplate alone — and Google noticed:
// the SERP for `2014bg16rfop002` paired the BULGARIAN title with an ENGLISH
// snippet scraped from the rendered DOM. That is the near-duplication this map
// exists to end.
//
// CURATED, NOT TRANSLATED. Every entry is the name the programme is published
// under in English by the Commission, eufunds.bg or the EEA/Norway Grants —
// these are proper nouns with official forms, and inventing a plausible
// translation for one would be exactly the fabrication the procedure-naming
// rule refuses to make (see MODAL_TITLE_MIN_SHARE in ./procedures.ts).
//
// A programme with no entry here keeps `programNameEn: null`, and its English
// page canonicalises at the Bulgarian URL instead of competing with it. Adding
// a name is what promotes that page to an indexable one, so add only names you
// can point at a source for.
//
// Lives in src/ because BOTH sides need it and they must not disagree: the
// prerender writes the <title>, and FundsProgramScreen renders the <h1> Google
// actually scraped its snippet from. A map the prerender alone could see would
// have fixed the head and left the rendered DOM Bulgarian — which is the half
// of the bug the SERP evidence was about.
export const PROGRAMME_NAMES_EN: Record<string, string> = {
  // 2015BG16RFSM001 and 2023BG06AFSP001 are deliberately ABSENT: neither the
  // Commission nor the managing authority publishes a form this file could
  // cite, and a plausible paraphrase is exactly what the rule above forbids.

  // ── Recovery and Resilience Facility ──────────────────────────────────────
  "2021BG-RRP": "National Recovery and Resilience Plan",

  // ── 2014-2020 operational programmes ──────────────────────────────────────
  // The Commission publishes "Innovations" (plural); the managing authority
  // (opic.bg) uses the singular. Going with the Commission's form, which is what
  // an English-language search for this programme is most likely to carry.
  "2014BG16RFOP002": "Innovations and Competitiveness",
  "2014BG16RFOP001": "Regions in Growth",
  "2014BG16M1OP001": "Transport and Transport Infrastructure",
  "2014BG16M1OP002": "Environment",
  "2014BG05M9OP001": "Human Resources Development",
  "2014BG05M2OP001": "Science and Education for Smart Growth",
  "2014BG05SFOP001": "Good Governance",
  "2014BG06RDNP001": "Rural Development Programme",
  "2014BG14MFOP001": "Maritime and Fisheries Programme",
  "2014BG05FMOP001":
    "Operational Programme for Food and/or Basic Material Assistance",
  "2014BG65ISNP001": "Internal Security Fund",
  "2014BG65AMNP001": "Asylum, Migration and Integration Fund",

  // ── 2021-2027 programmes ──────────────────────────────────────────────────
  "2021BG16RFPR001":
    "Competitiveness and Innovation in Enterprises Programme 2021-2027",
  "2021BG16RFPR002":
    "Research, Innovation and Digitalisation for Smart Transformation Programme 2021-2027",
  "2021BG16FFPR001": "Transport Connectivity Programme 2021-2027",
  "2021BG16FFPR002": "Environment Programme 2021-2027",
  "2021BG16FFPR003": "Development of the Regions Programme 2021-2027",
  "2021BG05SFPR001": "Education Programme 2021-2027",
  "2021BG05SFPR002": "Human Resources Development Programme 2021-2027",
  "2021BG05SFPR003": "Food and Basic Material Assistance Programme 2021-2027",
  "2021BG16RFTA001": "Technical Assistance Programme 2021-2027",
  "2021BG14MFPR001": "Maritime, Fisheries and Aquaculture Programme 2021-2027",
  "2021BG65AMPR001": "Asylum, Migration and Integration Fund Programme",
  "2021BG65ISPR001": "Internal Security Fund Programme",
  "2021BG16BARA001": "Brexit Adjustment Reserve",

  // ── EEA / Norway Grants programme areas ───────────────────────────────────
  BGLD: "Local Development, Poverty Reduction and Enhanced Inclusion of Vulnerable Groups",
  BGJUSTICE: "Justice",
  BGHOMEAFFAIRS: "Home Affairs",
  BGENERGY: "Renewable Energy, Energy Efficiency, Energy Security",
  BGENVIRONMENT: "Environment Protection and Climate Change",
  BGCULTURE: "Cultural Entrepreneurship, Heritage and Cooperation",
  DF: "Fund for Bilateral Relations",

  // ── National / EU direct-managed instruments ──────────────────────────────
  DEP: "Digital Europe Programme",
  BNSF: "Bulgarian National Science Fund",
  NIF: "National Innovation Fund",
};

/** The programme's English name, or null when none is published. */
export const programmeNameEn = (code: string): string | null =>
  PROGRAMME_NAMES_EN[code] ?? null;
