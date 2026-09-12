// The per-place Interreg tile lives on the governance/My-Area dashboard, at this
// fixed id — see MyAreaInterregTile.tsx (which sets it) and
// FundsInterregProgrammeScreen.tsx (which also links to it). Exported so all
// three sites share one literal rather than three independent copies that can
// drift silently if the anchor is ever renamed. Linking here with a `#` hash
// relies on the app-wide hash-scroll in routes.tsx's `ScrollToTop`, so no
// scroll code is needed on this end.
export const GOVERNANCE_INTERREG_ANCHOR = "myarea-interreg";

// Sofia never appears in `municipalities.json` under the obshtina code this
// corpus keys it with: `interreg_programme()`/`interreg_by_place()` (194/138)
// normalise the capital to the synthetic `S22` anchor — the same pseudo-code
// `fund_projects` uses (139's header) — and `findMunicipality("S22")` finds
// no row. Left unhandled, every surface reading `m.obshtina` renders the bare
// code "S22" instead of a name (and the ИСУН side of this same family can
// also emit the district codes S23xx/S24xx/S25xx — summaryTiles.tsx's
// `TopMunis` already folds those the same way). One definition so the two
// Interreg municipality lists (this tile's movers list and
// FundsInterregProgrammeScreen's per-programme list) cannot drift.
export const interregMuniName = (
  code: string,
  findMunicipality: (
    code?: string | null,
  ) => { name: string; name_en: string } | undefined,
  bg: boolean,
): string => {
  if (/^S2[2-5]\d{0,2}$/.test(code))
    return bg ? "София (столица)" : "Sofia (city)";
  const muni = findMunicipality(code);
  return (bg ? muni?.name : muni?.name_en) ?? code;
};
