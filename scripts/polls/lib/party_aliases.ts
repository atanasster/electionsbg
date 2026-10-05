// Parliamentary label aliases for docs/plans/polls-ai-review-v1.md: the
// extractor stores an agency's short label („РБ", „КП ББЦ") while an
// independent reader often copies the full name („Реформаторски блок").
// ЦИК's own per-election party list (data/<election>/cik_parties.json) is the
// one authoritative short-name → official-name table we hold.
import fs from "node:fs";
import path from "node:path";
import { foldLabel } from "./ai_reading";

/** folded short name → every official name ЦИК registered under it. */
export type PartyAliases = Map<string, string[]>;

export const loadPartyAliases = (root: string): PartyAliases => {
  const aliases: PartyAliases = new Map();
  const dataDir = path.join(root, "data");
  if (!fs.existsSync(dataDir)) return aliases;
  for (const entry of fs.readdirSync(dataDir)) {
    if (!/^\d{4}_\d{2}_\d{2}$/.test(entry)) continue;
    const file = path.join(dataDir, entry, "cik_parties.json");
    if (!fs.existsSync(file)) continue;
    let parties: { name?: string; nickName?: string }[];
    try {
      parties = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const p of parties) {
      if (!p.name || !p.nickName) continue;
      const key = foldLabel(p.nickName);
      // „КП ББЦ" and „ББЦ" are the same short name with/without the
      // coalition prefix the agencies add.
      for (const k of [key, key.replace(/^(?:кп|пп|ппк)\s+/, "")]) {
        const names = aliases.get(k) ?? [];
        if (!names.includes(p.name)) names.push(p.name);
        aliases.set(k, names);
      }
    }
  }
  return aliases;
};
