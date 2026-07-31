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
// Needs Postgres (tr_companies), pinned to the LOCAL database: this builds a
// committed local artifact, and pg.ts documents an ambient cloud DATABASE_URL
// (left over from db:dump:cloud) as a recurring hazard — without the pin the
// culture ingest would silently link against whatever vintage that proxy serves.

import { LOCAL_DATABASE_URL, allRows, pinLocalDatabase } from "../db/lib/pg";
import { stripProducerNoise } from "../../src/lib/foldProducer";
import type { ProducerBucket } from "../../src/data/culture/types";

/** Core name for matching: drop quotes + legal form, collapse spaces, upper.
 *  Punctuation is KEPT — TR names carry it ("КОРУНД-Х"). The rule itself lives in
 *  src/lib/foldProducer.ts so this and `producerFold` cannot drift; the TR side of
 *  the SQL below applies the same quote rule. TR names usually omit the legal
 *  form, which is why only this side strips it. */
export const coreName = (raw: string): string =>
  stripProducerNoise(raw).toLocaleUpperCase("bg-BG");

interface MatchRow {
  core: string;
  matches: string; // count (text from PG)
  uic: string | null;
}

export interface LinkResult {
  linked: number;
  total: number;
  /** Distinct non-empty core names actually looked up. */
  matchable: number;
}

/** The corpus is unusable — Postgres down, or `tr_companies` absent/too small to
 *  be the Commerce Registry. Recoverable: callers may keep what they already have
 *  (the ingest carries the previous EIKs forward). Anything NOT of this type is a
 *  real defect — schema drift, a revoked grant — and must not be degraded away. */
export class TrCorpusUnavailable extends Error {}

/** A corpus smaller than this is not the Commerce Registry, whatever the DDL
 *  says; the real table holds ~1.02M rows. `count(*) > 0` is far too weak — a
 *  one-row table matches nothing and would clear every existing link. */
const MIN_TR_COMPANIES = 100_000;

/**
 * Set (or clear) `eik` on every bucket in `producers`, in place.
 *
 * Throws `TrCorpusUnavailable` — rather than returning zero links — when
 * `tr_companies` is unreadable, empty, implausibly small, or present but matching
 * NOTHING. Each of those would otherwise fall into the clear-on-no-match loop
 * below and strip every existing link while reporting success: exactly the silent
 * unlinking this module exists to prevent. Callers decide what to do with the
 * throw (the ingest keeps the previous EIKs; the CLI exits non-zero).
 *
 * Note the normal `db:load:tr:pg` path cannot trip these: it COPYs inside one
 * transaction, so a concurrent reader sees either 0 rows or the whole corpus. The
 * reachable causes are a stale `DATABASE_URL`, a subset dump, or an interrupted
 * restore.
 */
export const linkProducerEiks = async (
  producers: ProducerBucket[],
): Promise<LinkResult> => {
  pinLocalDatabase();

  // The corpus check comes FIRST, before the degenerate-input return, so the
  // "throws when the corpus is unusable" contract holds on every path.
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
    throw new TrCorpusUnavailable(
      `tr_companies is unreadable (${why}) — is local Postgres up at ${new URL(LOCAL_DATABASE_URL).host}? \`npm run db:pg:up\``,
    );
  }
  if (companies < MIN_TR_COMPANIES)
    throw new TrCorpusUnavailable(
      `tr_companies holds ${companies} row(s) — that is not the Commerce Registry ` +
        `(expected > ${MIN_TR_COMPANIES}). Refusing to clear ${producers.length} existing link(s). ` +
        "Load it first (`npm run db:refresh`).",
    );

  const cores = [...new Set(producers.map((p) => coreName(p.producer)))].filter(
    Boolean,
  );
  if (cores.length === 0)
    return { linked: 0, total: producers.length, matchable: 0 };

  // ONE scan of tr_companies: normalise on the TR side and GROUP, rather than two
  // correlated subqueries per core name (which is 2N sequential scans of a 1.02M-row
  // table — measured at 20.6 s / 14.5M buffers for 25 producers, against 163 ms here).
  // The quote rule must mirror stripProducerNoise: quotes → SPACE, then collapse.
  const NORM = `upper(btrim(regexp_replace(regexp_replace(t.name,'["“”„»«]',' ','g'),'\\s+',' ','g')))`;
  const rows = await allRows<MatchRow>(
    `SELECT ${NORM} AS core,
            count(DISTINCT t.uic) AS matches,
            max(t.uic)            AS uic
       FROM tr_companies t
      WHERE ${NORM} = ANY($1::text[])
      GROUP BY 1`,
    [cores],
  );

  // core → eik, only for unambiguous (exactly one) matches.
  const eikByCore = new Map<string, string>();
  for (const r of rows)
    if (Number(r.matches) === 1 && r.uic) eikByCore.set(r.core, r.uic);

  // Resolve BEFORE mutating: every throw in this function must leave the caller's
  // buckets exactly as it found them, so a degrade can never be a partial strip.
  const resolved = producers.map((p) => eikByCore.get(coreName(p.producer)));
  const linked = resolved.filter(Boolean).length;

  // A full corpus that matches nothing is not a legitimate outcome for this
  // register — it means the names or the corpus are not what we think they are.
  // Degrade instead of publishing an unlinked artifact.
  if (linked === 0 && producers.length > 0)
    throw new TrCorpusUnavailable(
      `0/${producers.length} producers matched a unique TR company, against a ` +
        `${companies}-row corpus. Refusing to clear every link.`,
    );

  producers.forEach((p, i) => {
    const eik = resolved[i];
    if (eik) p.eik = eik;
    else delete p.eik;
  });

  return { linked, total: producers.length, matchable: cores.length };
};
