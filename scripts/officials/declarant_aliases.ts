// The one name a register person is published under, when the register itself
// used several.
//
// ./shared.ts canonicalDeclarantName() levels the mechanical drift — case, inner
// whitespace, hyphen spacing, a "д-р" prefix — which reunites 233 of the 270
// declarants the register forked across folder years. It cannot go further: what
// is left differs by a real typo ("Натгалия" for "Наталия"), a swapped
// patronymic and surname, or a genuine rename, and a rule loose enough to fold
// those would equally fold two same-named strangers into one profile.
//
// So those are resolved by identity rather than by spelling: register.cacbg.bg
// stamps every filing with a per-DECLARANT GUID, and ./_declarant_guid_aliases.json
// maps that GUID to the single name the profile should carry. Read by both
// ingests and by the rename migration, so all three agree on who is who.
//
// Kept out of ./shared.ts deliberately: shared.ts is pure string handling with no
// I/O, and both ingests import it before they have a GUID in hand.

import fs from "fs";
import path from "path";
import { ROOT } from "./shared";

export const ALIASES_FILE = path.join(
  ROOT,
  "scripts/officials/_declarant_guid_aliases.json",
);

type AliasFile = {
  aliases: Record<string, { name: string; folds: string[]; reason: string }>;
};

const load = (): Map<string, string> => {
  // Runs at import, and both ingests plus several tests import this — so a
  // hand-edit that breaks the JSON would otherwise fail all of them with a bare
  // SyntaxError that names no file. Name it.
  let raw: AliasFile;
  try {
    raw = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf-8")) as AliasFile;
  } catch (err) {
    throw new Error(`malformed ${ALIASES_FILE}: ${(err as Error).message}`);
  }
  return new Map(
    Object.entries(raw.aliases).map(([guid, a]) => [
      guid.toUpperCase(),
      a.name,
    ]),
  );
};

const ALIASES = load();

/** The name to slug and to publish for a filing.
 *
 *  `guid` is null when the filename carries a per-document id rather than a
 *  person id (see ./slug_identity.ts) — such a filing proves no identity, so it
 *  keeps the register's listing name and lands on the profile that name implies.
 *  That is the right fallback: every aliased declarant's filings all carry a
 *  real person id, so none of them depends on this branch. */
export const aliasedDeclarantName = (
  guid: string | null,
  listingName: string,
): string => (guid && ALIASES.get(guid.toUpperCase())) || listingName;

/** Every aliased GUID, for the migration and the corpus gate. */
export const aliasedGuids = (): ReadonlySet<string> => new Set(ALIASES.keys());
