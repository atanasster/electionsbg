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
export const AWARDER_NAME_OVERRIDES: Record<string, string> = {
  "000695235": "Министерство на вътрешните работи",
  "121015056": "Агенция за социално подпомагане (АСП)",
};

/** Curated canonical name for an awarder EIK, or undefined if none is pinned. */
export const canonicalAwarderName = (eik: string): string | undefined =>
  AWARDER_NAME_OVERRIDES[eik];
