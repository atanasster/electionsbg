// Maps a site canonical-party id (canonical_parties.json) to the slug of the
// matching party in the Court of Audit annual-report registry (gfopp).
//
// The gfopp register lists individual *registered legal parties*; the site
// tracks *electoral* parties and coalitions — so for a coalition this points
// at its lead constituent party, and the /party annual-report panel labels
// which legal entity is shown.
//
// Curated and intentionally partial: a party without a confident match is
// simply absent, and the panel does not render for it. Extend as needed.

export const GFOPP_SLUG_BY_CANONICAL_ID: Record<string, string> = {
  gerb: "gerb", // ГЕРБ-СДС coalition → ГЕРБ
  bsp: "balgarska-sotsialisticheska-partiya-bsp", // БСП
  ataka: "ataka", // Атака
  p_7: "vazrazhdane", // Възраждане
  p_16: "dvizhenie-za-prava-i-svobodi", // ДПС
  p_0: "ima-takav-narod", // ИТН
  p_13: "velichie", // Величие
  p_89: "abv-alternativa-za-balgarsko-vazrazhdane", // АБВ
  p_3: "moral-edinstvo-chest", // МЕЧ
  p_67: "prodalzhavame-promyanata-pp", // ПП
  p_6: "prodalzhavame-promyanata-pp", // ПП-ДБ coalition → ПП (lead)
  p_72: "demokrati-za-silna-balgariya", // ДБ → ДСБ (lead constituent)
};

// Reverse: gfopp registry slug → site canonical-party id. Used to badge the
// per-party annual-report page with the party's brand colour and short
// display name. One canonical id per slug (the lead party, not the coalition).
export const CANONICAL_ID_BY_GFOPP_SLUG: Record<string, string> = {
  gerb: "gerb",
  "balgarska-sotsialisticheska-partiya-bsp": "bsp",
  ataka: "ataka",
  vazrazhdane: "p_7",
  "dvizhenie-za-prava-i-svobodi": "p_16",
  "ima-takav-narod": "p_0",
  velichie: "p_13",
  "abv-alternativa-za-balgarsko-vazrazhdane": "p_89",
  "moral-edinstvo-chest": "p_3",
  "prodalzhavame-promyanata-pp": "p_67",
  "demokrati-za-silna-balgariya": "p_72",
};
