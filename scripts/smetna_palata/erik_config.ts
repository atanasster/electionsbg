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
  // ЕРИК flips its data model between the "old" and "new" register: the DataTables payloads
  // carry `isOldSystemElection`. Set it per election by TESTING the endpoint, not from a date
  // rule — the obvious one ("2024-06 onward is new") is contradicted by this file's own
  // `2024_06_09` entry, which has been `true` since it was written. On МИ 2023 (id 76) the
  // flag turned out to be inert: `true` and `false` return the same 1,160 donors and 1,860
  // candidate declarations. Elsewhere a wrong value can silently return zero rows, which is
  // why it stays explicit per entry.
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
  // The only LOCAL cycle here, and the oldest entry — hence LAST, which is what keeps index 0
  // the newest parliamentary one that the watcher fingerprints and the scraper defaults to.
  //
  // Why it is worth having: an инициативен комитет is how a кмет на кметство without a party
  // gets on the ballot at all, and ЕРИК files each one under the CANDIDATE'S OWN NAME —
  // "8-МИ/10.09.2023 — Димитър Венков Стефанов". That is the only campaign-money signal that
  // exists for a village mayor. docs/plans/village-mayor-attribution-v1.md §T5.
  //
  // The id was confirmed against the live register rather than guessed: its participants'
  // registry numbers carry the election code, `2219-МИ/05.09.2023` against `4520-НС/02.03.2026`
  // for id 93. So were its neighbours — 77 and 78 are МИ partials (Feb / Jan 2024), 79 is the
  // European Parliament.
  //
  // NOT YET INGESTABLE, and listed anyway so the id is written down where the next person
  // looks. Two measured things separate it from a parliamentary cycle:
  //
  //   SCALE.  `electionCommissionType` 1 returns 67 national registrations (58 партии,
  //           9 коалиции) — parliamentary-sized. Type 3, the ОИК level where the инициативни
  //           комитети live, reports `recordsTotal` 30,177. `fetchParticipants` now pages
  //           (it used to take one page of 1,000 and stop, which was exact for a
  //           parliamentary cycle and would have written 3.3% of this one as if it were
  //           whole), so the cost is a real crawl against a WAF that 403s bursts.
  //   KEYING. `scrape_erik` reconciles participants against `data/<election>/cik_parties.json`
  //           — a parliamentary artifact of ~28 nationally numbered parties. A local cycle has
  //           no such file, and a местна коалиция registered in one община is a DIFFERENT
  //           registration from the same-named one next door, so the list it needs is per-ОИК.
  //           That key does not exist in this scraper, and `loadCikParties` throwing on the
  //           missing file is what stops a run today.
  //
  // So this entry buys the id and the flags; the ingest is a feature.
  {
    electionId: 76,
    election: "2023_10_29_mi",
    label: "Местни избори — 29 октомври 2023 г.",
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
