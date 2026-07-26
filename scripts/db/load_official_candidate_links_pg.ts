// Populate official_candidate_link (migration 108) — the candidateLink decoration that
// municipal_officials_table LEFT JOINs, so the municipal roster served from Postgres carries
// the party / ballot-position / preference-votes / elected flag / MP-photo enrichment the
// by_obshtina JSON shards used to (persons-pg-retirement-v1 T1.5).
//
// SERVING loader — never writes JSON back. It is the PG twin of
// scripts/officials/candidate_links.ts (which still decorates the JSON shards until the
// officials JSON is torn down); both call ./officials/candidate_link_join.ts, so the table
// and the shards agree row-for-row.
//
// The subject list — which official_slug / name / obshtina to decorate — comes from PG
// (person_role + person, §6-gated) rather than from the shard files, so this loader has no
// dependency on the JSON that is being retired. Its INPUTS (the local-election slate bundles
// and the parliament index) are load-source JSON that stays on disk.
//
// PARITY with the JSON decorator is exact to one row (measured 2026-07-26): 5409 vs 5410
// links across 6077 eligible listings, 0 party / photo mismatches. The one difference is a
// person whose resolved person-layer display_name differs from the officials-register name
// (a marriage rename the resolver canonicalised — Минева → Петкова): the name-join fires on
// the register name in the JSON path but on display_name here. Joining on display_name is
// the deliberate choice — it is the name the roster actually renders — and one lost party
// tint out of 6077 is a fair price for not re-introducing the retired register-name column.
//
// ORDER. person_role must be filled (db:resolve:persons) and municipal_officials_table must
// exist (created by load_declarations_pg.ts --resolve, which applies 108 then 102). This
// loader runs AFTER that resolve in db:refresh, TRUNCATEs + COPYs the links, then REFRESHes
// municipal_officials_table so the LEFT JOIN picks them up. A fresh DB serves an
// un-decorated roster in the window between the resolve and this loader — the LEFT JOIN just
// yields NULLs — which is why 102 never hard-depends on a populated table.
//
// NOT wired into recent_updates: this is a derived enrichment of the municipal roster, whose
// freshness is a pure function of the officials ingest + the local-election corpus (both
// already tracked). A separate changelog line would be misleading noise, not a new dataset.
//
// Run: `npm run db:load:official-candidate-links:pg` (local) / `:cloud` (Cloud SQL proxy).

import { allRows, exec, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  buildSlateIndex,
  loadMiBundle,
  loadParliamentByName,
  officialsToMi,
  resolveCandidateLink,
  type SlateIndex,
} from "../officials/candidate_link_join";

// The roster roles that carry a candidateLink (DECORATED_ROLES). Pushed into the SQL WHERE
// so the loader never fetches chief_architect / other rows it would only discard.
const DECORATED_ROLE_SQL =
  "('mayor','deputy_mayor','council_chair','councillor')";

interface Listing {
  official_slug: string;
  name: string;
  obshtina: string;
}

const main = async (): Promise<void> => {
  // Same membership as municipal_officials_table: official_muni listings with a place,
  // gated to active public figures (§6). Ordered so the per-obshtina slate index is built
  // once and reused for the whole run of one município's rows.
  const listings = await allRows<Listing>(
    `SELECT r.ref AS official_slug, p.display_name AS name, r.place AS obshtina
       FROM person_role r
       JOIN person p ON p.person_id = r.person_id
                    AND p.status = 'active'
                    AND p.is_public_figure
      WHERE r.source = 'official_muni'
        AND r.place IS NOT NULL
        AND r.role IN ${DECORATED_ROLE_SQL}
      ORDER BY r.place, r.ref`,
  );
  console.log(
    `[official-candidate-links] ${listings.length} decoratable municipal listing(s)`,
  );

  const parliamentByName = loadParliamentByName();
  console.log(
    `[official-candidate-links] parliament index: ${parliamentByName.size} MPs by name`,
  );

  // Cache one slate index per mi-code so a município's rows (contiguous after the ORDER BY)
  // build it once. `null` = no local-election bundle for that município (a valid state —
  // the MP-photo join can still fire).
  const slateCache = new Map<string, SlateIndex | null>();
  const slateFor = (obshtina: string): SlateIndex | null => {
    const miCode = officialsToMi(obshtina);
    if (!slateCache.has(miCode)) {
      const bundle = loadMiBundle(miCode);
      slateCache.set(miCode, bundle ? buildSlateIndex(bundle) : null);
    }
    return slateCache.get(miCode) ?? null;
  };

  const rows: unknown[][] = [];
  let partyHits = 0;
  let photoHits = 0;
  for (const l of listings) {
    const link = resolveCandidateLink(
      l.name,
      slateFor(l.obshtina),
      parliamentByName,
    );
    if (!link) continue;
    if (link.partyCanonicalId !== null || link.partyName !== "") partyHits++;
    if (link.photoUrl) photoHits++;
    rows.push([
      l.official_slug,
      link.cycle,
      link.partyName,
      link.partyCanonicalId,
      link.listPos,
      link.prefVotes,
      link.isElected,
      link.mpId ?? null,
      link.photoUrl ?? null,
    ]);
  }

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE official_candidate_link");
    const copied = await copyRows(
      client,
      "official_candidate_link",
      [
        "official_slug",
        "cycle",
        "party_name",
        "party_canonical_id",
        "list_pos",
        "pref_votes",
        "is_elected",
        "mp_id",
        "photo_url",
      ],
      rows,
    );
    await client.query("COMMIT");
    console.log(
      `[official-candidate-links] loaded ${copied} link(s) — ` +
        `party ${partyHits}, photo ${photoHits}`,
    );
  });

  // The LEFT JOIN in municipal_officials_table reads the table above — refresh it so the
  // serving roster carries the links this run just wrote. No CONCURRENTLY: the matview may
  // be empty on a first-ever load and CONCURRENTLY refuses an unpopulated matview.
  await exec("REFRESH MATERIALIZED VIEW municipal_officials_table");
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM municipal_officials_table WHERE candidate_party_name IS NOT NULL OR candidate_mp_id IS NOT NULL",
  );
  console.log(
    `[official-candidate-links] municipal_officials_table refreshed — ${n} listing(s) now carry a candidateLink`,
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void end();
  });
