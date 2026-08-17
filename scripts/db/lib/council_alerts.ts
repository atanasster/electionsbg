// Recent municipal-council decisions per município, read from Postgres.
//
// The My-Area alert builder used to read data/council/index.json for this.
// That file is CAPPED at 200 resolutions per município (six of sixteen exceed
// it) and STRIPPED of per-councillor votes, so an alert built from it could
// only ever say "the council voted on X" — the most valuable event this feed
// could carry, "your councillor voted against X", was not expressible at all.
// This is the same information from the source that index was generated from.
//
// ONE query for every município rather than a call per place: the alert builder
// walks ~265 municípios, and only 16 have a council at all.
//
// It also removes the THIRD copy of the obshtina→council code mapping. The
// builder carried a hand-maintained `COUNCIL_KEY_MAP` whose own comment said it
// mirrored `councilObshtinaMap.ts`; `council_muni_code` is now the single
// definition, and it is the one the serving functions already resolve through.
// A mapping kept in three places is how a município silently renders nothing,
// which is the historical failure councilObshtinaMap.ts was created to fix.
//
// THROWS when Postgres is unreachable, rather than degrading — the
// muni_awarders.ts reasoning applies unchanged: one transient database
// condition would blank the council alerts in every per-município file,
// silently, at exit 0, in a step the watch-report orchestrator runs unattended
// in a repo that auto-commits. ALERTS_ALLOW_EMPTY=1 opts out for a deliberate
// run without a database.

import { Pool } from "pg";
import { DATABASE_URL } from "./pg";

/**
 * The scraper's placeholder for minutes it could read but whose subject line it
 * could not isolate — 2,234 of 4,727 rows (47%).
 *
 * THIRD copy of this rule. The other two are functions/spa_page.js and
 * src/screens/council/CouncilResolutionScreen.tsx, which must agree byte for
 * byte with each other because one hydrates over the other; this one only has
 * to avoid publishing the placeholder, so it is deliberately not held to that.
 * A Cloud Function cannot import from src/ and a build script cannot import
 * from functions/, so all three exist by necessity.
 */
const PLACEHOLDER_TITLE = /^\(?\s*no title parsed\s*\)?$/i;

export type CouncilAlertRow = {
  id: string;
  decidedOn: string;
  /** Already resolved — never the raw placeholder. */
  title: string;
  summaryBg: string | null;
  summaryEn: string | null;
  result: string | null;
  tallyFor: number | null;
  tallyAgainst: number | null;
  tallyAbstain: number | null;
  hasNamedVotes: boolean;
  sourceUrl: string | null;
  /** Councillors who voted AGAINST, and only against.
   *
   *  Abstention is deliberately excluded. „Въздържал се" is the explicit
   *  refusal to take a side, so folding it into an "against" list would name a
   *  person as opposing something they declined to oppose — measured
   *  corpus-wide that fold is 62-78% abstentions. Empty for the 11 councils
   *  that publish no named vote, which is why every consumer must gate on
   *  `hasNamedVotes` rather than on this being non-empty. */
  againstNames: string[];
};

/**
 * Keyed by FRONTEND obshtina code (BGS04, SFO_CITY, S2414…) — the code the
 * alert builder walks and the one /governance/:id uses. Resolution happens in
 * SQL through council_muni_code, so no caller carries the mapping.
 *
 * Sofia's 24 районни codes each map to the same Столичен общински съвет, so a
 * reader in район Лозенец gets their city's decisions rather than nothing.
 */
export const readCouncilAlertsByObshtina = async (
  lookbackDays: number,
): Promise<Map<string, CouncilAlertRow[]>> => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<{
      frontend_code: string;
      id: string;
      decided_on: string;
      number: string | null;
      title: string;
      summary_bg: string | null;
      summary_en: string | null;
      result: string | null;
      tally_for: number | null;
      tally_against: number | null;
      tally_abstain: number | null;
      has_named_votes: boolean;
      source_url: string | null;
      against_names: string[] | null;
    }>(
      `SELECT mc.frontend_code,
              r.id,
              r.decided_on::text AS decided_on,
              r.number,
              r.title,
              r.summary_bg,
              r.summary_en,
              r.result,
              r.tally_for,
              r.tally_against,
              r.tally_abstain,
              r.has_named_votes,
              r.source_url,
              CASE WHEN r.has_named_votes THEN (
                SELECT array_agg(v.councillor ORDER BY v.councillor)
                  FROM council_vote v
                 WHERE v.resolution_id = r.id AND v.vote = 'against'
              ) END AS against_names
         FROM council_resolution r
         JOIN council_muni_code mc ON mc.obshtina_code = r.obshtina_code
        WHERE r.decided_on >= (current_date - ($1::int))
        ORDER BY mc.frontend_code, r.decided_on DESC, r.id`,
      [lookbackDays],
    );

    const out = new Map<string, CouncilAlertRow[]>();
    for (const r of rows) {
      const list = out.get(r.frontend_code) ?? [];
      list.push({
        id: r.id,
        decidedOn: r.decided_on,
        title:
          r.title && !PLACEHOLDER_TITLE.test(r.title.trim())
            ? r.title.trim()
            : `Решение № ${r.number ?? "—"} от ${r.decided_on}`,
        summaryBg: r.summary_bg,
        summaryEn: r.summary_en,
        result: r.result,
        tallyFor: r.tally_for,
        tallyAgainst: r.tally_against,
        tallyAbstain: r.tally_abstain,
        hasNamedVotes: r.has_named_votes,
        sourceUrl: r.source_url,
        againstNames: r.against_names ?? [],
      });
      out.set(r.frontend_code, list);
    }

    // A SUCCESSFUL EMPTY RESULT is the failure this contract is supposed to
    // cover, and the catch below cannot see it. Migration 160 creates the table
    // with CREATE TABLE IF NOT EXISTS, so a database where the loader never ran
    // has council_resolution present and empty — the query returns 0 rows, no
    // error is raised, and all 289 alert files rewrite with the council source
    // blank at exit 0, in an unattended step in a repo that auto-commits.
    //
    // The probe has to key on CORPUS emptiness, not on this window being empty:
    // a quiet 60 days is a legitimate answer and must not throw.
    if (out.size === 0) {
      const { rows: any } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (SELECT 1 FROM council_resolution LIMIT 1) s`,
      );
      if (Number(any[0].n) === 0 && process.env.ALERTS_ALLOW_EMPTY !== "1") {
        throw new Error(
          `[alerts] council_resolution is EMPTY — refusing to write alert files ` +
            `with the council source silently blank. Run ` +
            `\`npm run db:load:council:pg\`, or set ALERTS_ALLOW_EMPTY=1 for a ` +
            `deliberate run without the corpus.`,
        );
      }
      console.warn(
        "[alerts] no council decisions in the window — legitimate for a quiet " +
          "period; the corpus itself is not empty.",
      );
    }
    return out;
  } catch (e) {
    if (process.env.ALERTS_ALLOW_EMPTY === "1") {
      console.warn(
        `[alerts] council source unavailable, continuing without it (ALERTS_ALLOW_EMPTY=1): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return new Map();
    }
    throw new Error(
      `[alerts] cannot read council_resolution from Postgres — refusing to write ` +
        `alert files with the council source silently blank. Run ` +
        `\`npm run db:load:council:pg\`, or set ALERTS_ALLOW_EMPTY=1 for a ` +
        `deliberate run without a database. Cause: ${
          e instanceof Error ? e.message : String(e)
        }`,
    );
  } finally {
    await pool.end();
  }
};
