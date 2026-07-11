// Shared URL builders for the НЗОК molecule (INN) and pack detail pages, so the
// tiles and the screens agree on one encoding. Pack identity is
// (nationalNo, nzokCode) and EITHER side can be blank (the comparison key falls
// back to nzok_code when the national number is missing), so a blank side is
// carried in the path as the "_" sentinel and decoded back to "".

const PACK_BLANK = "_";

export const moleculeHref = (inn: string): string =>
  `/molecule/${encodeURIComponent(inn)}`;

export const packHref = (
  inn: string,
  nationalNo: string | null | undefined,
  nzokCode: string | null | undefined,
): string =>
  `/molecule/${encodeURIComponent(inn)}/pack/` +
  `${encodeURIComponent(nationalNo || PACK_BLANK)}/` +
  `${encodeURIComponent(nzokCode || PACK_BLANK)}`;

// react-router has already percent-decoded the param; only the sentinel remains.
export const decodePackParam = (v: string | undefined): string =>
  v == null || v === PACK_BLANK ? "" : v;
