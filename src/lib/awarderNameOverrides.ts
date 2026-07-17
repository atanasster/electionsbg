// Canonical display-name overrides for awarder / institution EIKs where the
// server's institution registry resolves a misleading name — typically because
// several state bodies share one Булстат (ЕИК) and the registry synthesised the
// name from a sub-unit rather than the parent. The awarder page prefers this
// over the institution / procurement-corpus name.
//
// 000695235 — the Булстат of Министерство на вътрешните работи. Many МВР
// structures file under this same ЕИК, and the institutions registry resolves it
// to the "Дирекция Български документи за самоличност" sub-directorate. But the
// EIK IS the ministry (the contracts corpus labels its awards "Министерство на
// вътрешните работи /МВР/"), and it is the security sector's lead awarder — so
// pin the ministry name.
// 121015056 — the Булстат of Агенция за социално подпомагане (АСП). Central АСП,
// its 28 регионални дирекции (РДСП) and the municipal social directorates all file
// under this one legal-entity ЕИК, and the procurement corpus latched onto a
// representative regional record, resolving it to "Регионална дирекция за социално
// подпомагане - Видин". But the EIK IS the agency — it is the social sector's
// disbursement star and the most prominent member of the /sector/social pack — so
// pin the canonical agency name.
import { REGIONAL_ENTITIES } from "./regionalReferenceData";

// The МРРБ group (ministry + АГКК + ДНСК + the 27 областни администрации) — the corpus
// stores their names as typed by each buyer, so they render sloppily: the oblast is
// lower-cased ("Областна администрация - област варна") and АГКК is mis-capitalised
// ("Агенция по геодезия, Картография и кадастър"). Not a wrong entity like the two cases
// above — just bad casing — but it reads as broken in an <h1>. The canonical labels
// already exist in the sector allowlist, so fold them in rather than re-typing 30 rows.
const REGIONAL_OVERRIDES: Record<string, string> = Object.fromEntries(
  REGIONAL_ENTITIES.map((e) => [e.eik, e.name]),
);

export const AWARDER_NAME_OVERRIDES: Record<string, string> = {
  "000695235": "Министерство на вътрешните работи",
  "121015056": "Агенция за социално подпомагане (АСП)",
  ...REGIONAL_OVERRIDES,
};

/** Curated canonical name for an awarder EIK, or undefined if none is pinned. */
export const canonicalAwarderName = (eik: string): string | undefined =>
  AWARDER_NAME_OVERRIDES[eik];
