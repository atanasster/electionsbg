// The active local-election cycle to surface in the SPA.
//
// Step 1 hardcodes mi2023 — the most recent regular cycle. Step 3 will
// replace this with a discovery hook that reads a list of cycles from
// data/local_cycles.json (written by the parser) and picks the most
// recent based on round1Date, optionally honouring a `?local=` query
// param so a user can pin an older cycle for comparison.
//
// The string format mirrors the data/<cycle>/ folder name and the
// election-selector entry suffix: "YYYY_MM_DD_mi" or "YYYY_MM_DD_chmi".

export const LATEST_LOCAL_CYCLE = "2023_10_29_mi";

export const useLatestLocalCycle = (): string => LATEST_LOCAL_CYCLE;
