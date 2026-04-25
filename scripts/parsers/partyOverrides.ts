// Manual overrides where the per-election `commonName` reconciliation
// in cik_parties.json doesn't connect lineages. Each entry says:
// "treat all listed nicknames as the same canonical party".
//
// Add entries here when you spot a real rebrand or coalition rebadge that the
// CEC's `commonName` field doesn't capture. Don't add entries for splits where
// the parties really diverged (e.g. ДПС vs ДПС-НН after 2024 — those have
// different leadership and platforms).

export type CanonicalOverride = {
  // Stable slug used as the canonicalId (URL-safe, lowercase ASCII).
  id: string;
  // Preferred display label (Bulgarian).
  displayName: string;
  // All nicknames across elections that should map to this canonical party.
  aliases: string[];
};

export const partyOverrides: CanonicalOverride[] = [
  // Real rebrand: ГЕРБ became ГЕРБ-СДС from 2021 onward (added СДС as a partner).
  {
    id: "gerb",
    displayName: "ГЕРБ-СДС",
    aliases: ["ГЕРБ", "ГЕРБ-СДС"],
  },
  // BSP rebranded into the БСП-ОЛ ("Обединена левица") umbrella in 2026.
  {
    id: "bsp",
    displayName: "БСП-ОЛ",
    aliases: ["БСП", "БСП-ОЛ"],
  },
  // ATAKA registered with different casing across years.
  {
    id: "ataka",
    displayName: "Атака",
    aliases: ["Атака", "АТАКА"],
  },
];
