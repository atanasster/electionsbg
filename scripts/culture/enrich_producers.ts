// Enrich data/culture/overview.json's topProducers with a company EIK — ONLY
// where the producer name matches EXACTLY ONE Commerce-Registry company (a unique
// match). The НФЦ register has no EIK (plan §6), and common names ("Клас", "АРС")
// hit several companies, so those are left unlinked rather than guessed; only
// unambiguous names get a /company/:eik link.
//
//   npx tsx scripts/culture/enrich_producers.ts   # run AFTER scripts/culture/ingest.ts
//
// Needs Postgres (tr_companies). Re-run whenever the film ingest rewrites
// overview.json (which drops the eik it added).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allRows, getPool } from "../db/lib/pg";
import type { CultureOverviewFile } from "../../src/data/culture/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OVERVIEW = path.resolve(__dirname, "../../data/culture/overview.json");

/** Core name for matching: drop quotes + legal form, collapse spaces, upper. The
 *  TR side strips quotes in SQL; TR names usually omit the legal form. */
// NB: JS `\b` does NOT fire around Cyrillic letters (they aren't ASCII word
// chars), so the legal form must be stripped as a whitespace-delimited token,
// not with `\bФОРМА\b`.
const coreName = (raw: string): string =>
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

const main = async () => {
  const overview = JSON.parse(
    fs.readFileSync(OVERVIEW, "utf8"),
  ) as CultureOverviewFile;

  // Unique cores for the top producers we display.
  const cores = [
    ...new Set(overview.topProducers.map((p) => coreName(p.producer))),
  ].filter(Boolean);
  if (cores.length === 0) {
    console.log("no producers to enrich");
    await getPool().end();
    return;
  }

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
  for (const p of overview.topProducers) {
    const eik = eikByCore.get(coreName(p.producer));
    if (eik) {
      p.eik = eik;
      linked += 1;
    } else {
      delete p.eik;
    }
  }

  fs.writeFileSync(OVERVIEW, JSON.stringify(overview, null, 2) + "\n");
  console.log(
    `✓ ${linked}/${overview.topProducers.length} top producers linked to a unique EIK · → data/culture/overview.json`,
  );
  await getPool().end();
};

main().catch((e) => {
  console.error("producer enrichment failed:", e);
  process.exit(1);
});
