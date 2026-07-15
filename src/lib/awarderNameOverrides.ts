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
export const AWARDER_NAME_OVERRIDES: Record<string, string> = {
  "000695235": "Министерство на вътрешните работи",
};

/** Curated canonical name for an awarder EIK, or undefined if none is pinned. */
export const canonicalAwarderName = (eik: string): string | undefined =>
  AWARDER_NAME_OVERRIDES[eik];
