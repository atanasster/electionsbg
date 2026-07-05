// Single source of truth for the ЕРИК campaign-finance scraper
// (erik.bulnao.government.bg — Единен регистър по Изборния кодекс, run by the
// Court of Audit / Сметна палата).
//
// ЕРИК is a classic server-rendered ASP.NET MVC app whose DataTables hydrate
// from plain-HTTP JSON POST endpoints — no SPA, no auth, no Playwright. The
// scraper (scrape_erik.ts) reproduces the exact raw_data/<election>/smetna_palata
// layout the manual download used to produce, so the existing financing parser
// (parseFinancing) consumes it unchanged.
//
// Each election on ЕРИК has an integer `electionId`. We map it to our election
// folder name here. New parliamentary elections get a new id roughly once a year
// — add a line below (LATEST FIRST) when one appears; the watcher fingerprints
// ERIK_ELECTIONS[0] and the scraper defaults to it. This is a deliberately
// manual, config-only step (see the one-off-backfills convention).

export const ERIK_BASE = "https://erik.bulnao.government.bg";

// A desktop User-Agent — the endpoints work without one, but be a polite client.
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type ErikElection = {
  // ЕРИК integer election id (from /Reports?electionId=<id>)
  electionId: number;
  // Our election folder name (matches src/data/json/elections.json `name`)
  election: string;
  // Human label for logs / the watcher detail line
  label: string;
  // ЕРИК flips its data model between the "old" and "new" register. New-system
  // elections (2024-06 onward) use `isOldSystemElection=false` in the DataTables
  // payloads; older ones use `true`. Wrong value silently returns zero rows.
  isOldSystem: boolean;
};

// LATEST FIRST. ERIK_ELECTIONS[0] is the "current" election the watcher tracks
// and the scraper defaults to.
export const ERIK_ELECTIONS: ErikElection[] = [
  {
    electionId: 93,
    election: "2026_04_19",
    label: "Народно събрание — 19 април 2026 г.",
    isOldSystem: false,
  },
  {
    electionId: 83,
    election: "2024_10_27",
    label: "Народно събрание — 27 октомври 2024 г.",
    isOldSystem: true,
  },
  {
    electionId: 80,
    election: "2024_06_09",
    label: "Народно събрание — 9 юни 2024 г.",
    isOldSystem: true,
  },
];

export const findErikElection = (
  key: string | number | undefined,
): ErikElection => {
  if (key === undefined) return ERIK_ELECTIONS[0];
  const s = String(key);
  const hit = ERIK_ELECTIONS.find(
    (e) => e.election === s || String(e.electionId) === s,
  );
  if (!hit) {
    throw new Error(
      `Unknown ЕРИК election "${s}". Known: ` +
        ERIK_ELECTIONS.map((e) => `${e.election} (id ${e.electionId})`).join(
          ", ",
        ) +
        `. Add it to ERIK_ELECTIONS in scripts/smetna_palata/erik_config.ts.`,
    );
  }
  return hit;
};

// Curated ЕРИК-registeredName → CIK party-name overrides for participants whose
// names can't be reconciled by normalisation (acronyms, rebrands). Keyed by the
// exact `registeredName` ЕРИК returns; value must be the exact CIK party name in
// data/<election>/cik_parties.json. reconcileErikToCik() consults this first.
//
// Everything else (prefix ПП/КП/КОАЛИЦИЯ, case, en-dash vs hyphen, dropped
// suffixes like "– АПС"/"- ДПС") is handled automatically — keep this map small
// and only for genuinely underivable cases. When the scraper reports an
// unmatched participant, add its mapping here.
export const PARTY_OVERRIDES: Record<string, string> = {
  // МЕЧ = acronym of "Морал Единство Чест"
  "МОРАЛ ЕДИНСТВО ЧЕСТ": "ПП МЕЧ",
  // НД = "Национално движение"
  "НАЦИОНАЛНО ДВИЖЕНИЕ НЕПОКОРНА БЪЛГАРИЯ": "НД НЕПОКОРНА БЪЛГАРИЯ",
};
