// The АПИ awarder key and the canonical paths to its pages — and NOTHING
// else. This file must stay import-free.
//
// It sits apart from the roads engine (@/lib/roadAttributes, which re-exports
// API_EIK) for a bundling reason: routes.tsx needs the path for the legacy
// /procurement/roads redirect, and taking it from either roadAttributes or the
// sectorPacks registry makes the whole sector-pack cluster a STATIC import of
// the entry chunk — ~20 reference-data modules of EIK allowlists and label
// tables (kultura, transport, social, security, cpvSectors, the roads
// engine, …) downloaded by every page, for one string. The packs themselves
// stay lazy; it is only the module that names them that leaks.
//
// Gated by src/entryGraph.test.ts, which fails if the registry becomes
// statically reachable from main.tsx again.

/** АПИ — Агенция „Пътна инфраструктура". One legal entity; the 28 ОПУ regional
 *  directorates file under this EIK as buyer sub-units (see awarder_identity.ts).
 *  Shared by the FE hook, the AI tool and the ingest scripts. */
export const API_EIK = "000695089";

/** The АПИ awarder page. It renders the generic buyer view only — the roads
 *  pack moved to the sector hub (CompanyDbScreen suppresses a pack whose EIK
 *  leads a sector dashboard), so link here for "АПИ as a buyer", never for the
 *  road-specific tiles. */
export const ROADS_AWARDER_PATH = `/awarder/${API_EIK}`;

/** The roads sector hub — where the map, €/km and competition tiles live. The
 *  legacy /procurement/roads redirect points here (routes.tsx). */
export const ROADS_SECTOR_PATH = "/sector/roads";
