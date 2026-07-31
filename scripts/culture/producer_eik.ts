// Resolve НФЦ top-producer names to a company EIK — ONLY where the name matches
// EXACTLY ONE Commerce-Registry company (a unique match). The НФЦ register has no
// EIK (plan §6), and common names ("Клас", "АРС") hit several companies, so those
// are left unlinked rather than guessed; only unambiguous names get a
// /company/:eik link.
//
// Shared by BOTH callers, so the two can never drift apart:
//  - scripts/culture/ingest.ts   — calls it BEFORE writing overview.json, so a
//    film refresh can never leave the file without the eik it had.
//  - scripts/culture/enrich_producers.ts — the standalone re-run.
//
// Needs Postgres (tr_companies).

import { allRows } from "../db/lib/pg";
import type { ProducerBucket } from "../../src/data/culture/types";

/** Core name for matching: drop quotes + legal form, collapse spaces, upper. The
 *  TR side strips quotes in SQL; TR names usually omit the legal form. */
// NB: JS `\b` does NOT fire around Cyrillic letters (they aren't ASCII word
// chars), so the legal form must be stripped as a whitespace-delimited token,
// not with `\bФОРМА\b`.
export const coreName = (raw: string): string =>
  raw
    .replace(/["“”„»«]/g, "")
    .replace(/(^|\s)(ЕООД|ООД|ЕТ|ЕАД|АД|ДЗЗД|СНЦ|ЮЛНЦ|ФОНДАЦИЯ)(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("bg-BG");

interface MatchRow {
  core: string;
  matches: string; // count (text from PG)
  uic: string | null;
}

export interface LinkResult {
  linked: number;
  total: number;
}

/**
 * Set (or clear) `eik` on every bucket in `producers`, in place.
 *
 * Throws — rather than returning zero links — when tr_companies is unreadable or
 * empty. A missing corpus matches nothing, and the clear-on-no-match below would
 * then strip EVERY existing link: exactly the silent unlinking this module exists
 * to prevent. Callers decide what to do with the throw (the ingest keeps the
 * previous EIKs; the CLI exits non-zero).
 */
export const linkProducerEiks = async (
  producers: ProducerBucket[],
): Promise<LinkResult> => {
  const cores = [...new Set(producers.map((p) => coreName(p.producer)))].filter(
    Boolean,
  );
  if (cores.length === 0) return { linked: 0, total: producers.length };

  let companies = 0;
  try {
    const [row] = await allRows<{ n: string }>(
      `SELECT count(*) AS n FROM tr_companies`,
    );
    companies = Number(row?.n ?? 0);
  } catch (e) {
    // node-pg wraps a refused connection in an AggregateError whose `.message`
    // is EMPTY, so fall back to the constructor name rather than printing "()".
    const why =
      (e as Error).message || (e as Error).name || "unknown connection error";
    throw new Error(
      `tr_companies is unreadable (${why}) — is local Postgres up? \`npm run db:pg:up\``,
    );
  }
  if (companies === 0)
    throw new Error(
      "tr_companies is empty — load the Commerce Registry first (`npm run db:refresh`)",
    );

  // One scan of tr_companies (not one per name): group the quote-stripped,
  // upper-cased names against the supplied cores.
  const rows = await allRows<MatchRow>(
    `WITH cores(core) AS (SELECT unnest($1::text[]))
     SELECT c.core,
            (SELECT count(DISTINCT t.uic) FROM tr_companies t
               WHERE upper(regexp_replace(t.name,'["“”„»«]','','g')) = c.core) AS matches,
            (SELECT max(t.uic) FROM tr_companies t
               WHERE upper(regexp_replace(t.name,'["“”„»«]','','g')) = c.core) AS uic
       FROM cores c`,
    [cores],
  );

  // core → eik, only for unambiguous (exactly one) matches.
  const eikByCore = new Map<string, string>();
  for (const r of rows)
    if (Number(r.matches) === 1 && r.uic) eikByCore.set(r.core, r.uic);

  let linked = 0;
  for (const p of producers) {
    const eik = eikByCore.get(coreName(p.producer));
    if (eik) {
      p.eik = eik;
      linked += 1;
    } else {
      delete p.eik;
    }
  }
  return { linked, total: producers.length };
};
