// Trigram word_similarity threshold sweep — an ISOLATED, throwaway experiment.
// Answers "would widening the threshold recover the drop/transpose typo
// misses found in personSearchTypoTest.ts", without touching production or
// any real serving database.
//
// Requires the disposable container from the chat session:
//   docker run --rm -d --name typo_threshold_test -p 5545:5432 \
//     -e POSTGRES_PASSWORD=test -e POSTGRES_DB=typotest postgres:16-alpine
// loaded with pg_trgm + the real translit_bg_latin() function + the 360 real
// MP names from data/parliament/mp-cars.json — see the chat transcript for
// the setup SQL. This script only READS that isolated instance.
//
//   npx tsx ai/llm/personSearchThresholdTest.ts

import { Client } from "pg";

const CONN = "postgres://postgres:test@127.0.0.1:5545/typotest";

// Mirrors qualifyingSearchWords (functions/db_table.js): split on whitespace,
// keep words of length >= SEARCH_MIN_CHARS (3), dedup, cap (irrelevant here —
// our names are 3 words).
const SEARCH_MIN_CHARS = 3;
const qualifyingWords = (raw: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw.split(/\s+/)) {
    if ([...w].length < SEARCH_MIN_CHARS) continue;
    const key = w.normalize("NFC").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
};

// Same three deterministic typo generators as personSearchTypoTest.ts.
const dropLetter = (name: string): string => {
  const words = name.split(" ");
  if (words.length < 2) return name;
  const target = words[1];
  const idx = Math.floor(target.length / 2);
  words[1] = target.slice(0, idx) + target.slice(idx + 1);
  return words.join(" ");
};
const transposeLetters = (name: string): string => {
  const words = name.split(" ");
  const wi = words.length - 1;
  const chars = [...words[wi]];
  const idx = Math.floor(chars.length / 2);
  if (idx + 1 >= chars.length) return name;
  [chars[idx], chars[idx + 1]] = [chars[idx + 1], chars[idx]];
  words[wi] = chars.join("");
  return words.join(" ");
};
const duplicateLetter = (name: string): string => {
  const words = name.split(" ");
  const wi = words.length - 1;
  const chars = [...words[wi]];
  const idx = Math.floor(chars.length / 2);
  chars.splice(idx, 0, chars[idx]);
  words[wi] = chars.join("");
  return words.join(" ");
};
const TYPO_KINDS: { kind: string; fn: (s: string) => string }[] = [
  { kind: "drop_letter_patronymic", fn: dropLetter },
  { kind: "transpose_letters_surname", fn: transposeLetters },
  { kind: "duplicate_letter_surname", fn: duplicateLetter },
];

// Mirrors fuzzyQ in functions/db_routes.js: one `name_fold %> translit_bg_latin($i)`
// arm per qualifying word, ANDed.
const runFuzzyQuery = async (
  client: Client,
  typoQuery: string,
): Promise<{ name: string }[]> => {
  const words = qualifyingWords(typoQuery);
  if (!words.length) return [];
  const arms = words
    .map((_, i) => `name_fold %> translit_bg_latin($${i + 1})`)
    .join(" AND ");
  const { rows } = await client.query(
    `SELECT name FROM person_search_test WHERE ${arms}`,
    words,
  );
  return rows;
};

const THRESHOLDS = [0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2];

const main = async () => {
  const client = new Client(CONN);
  await client.connect();

  const namesRes = await client.query<{ name: string }>(
    "SELECT name FROM person_search_test ORDER BY name",
  );
  const names = namesRes.rows.map((r) => r.name);

  const tasks: { name: string; kind: string; typoQuery: string }[] = [];
  for (const name of names)
    for (const t of TYPO_KINDS) {
      const typoQuery = t.fn(name);
      if (typoQuery !== name) tasks.push({ name, kind: t.kind, typoQuery });
    }

  console.log(
    `\nword_similarity threshold sweep — ${names.length} real MP names, ${tasks.length} typo'd queries per threshold, ${THRESHOLDS.length} thresholds (isolated container, no prod involved)\n`,
  );

  for (const threshold of THRESHOLDS) {
    await client.query(`SET pg_trgm.word_similarity_threshold = ${threshold}`);
    const byKind = new Map<
      string,
      { found: number; total: number; resultSizes: number[] }
    >();
    for (const { name, kind, typoQuery } of tasks) {
      const rows = await runFuzzyQuery(client, typoQuery);
      const found = rows.some((r) => r.name === name);
      const b = byKind.get(kind) ?? { found: 0, total: 0, resultSizes: [] };
      b.total++;
      if (found) b.found++;
      b.resultSizes.push(rows.length);
      byKind.set(kind, b);
    }
    console.log(
      `--- threshold = ${threshold} ${threshold === 0.6 ? "(production default)" : ""} ---`,
    );
    let overallFound = 0;
    let overallTotal = 0;
    for (const [kind, b] of byKind) {
      const meanSize =
        b.resultSizes.reduce((a, x) => a + x, 0) / b.resultSizes.length;
      console.log(
        `  ${kind.padEnd(28)} survived: ${b.found}/${b.total} (${Math.round((100 * b.found) / b.total)}%)   mean result-set size: ${meanSize.toFixed(1)} rows`,
      );
      overallFound += b.found;
      overallTotal += b.total;
    }
    console.log(
      `  OVERALL: ${overallFound}/${overallTotal} (${Math.round((100 * overallFound) / overallTotal)}%)\n`,
    );
  }

  await client.end();
};

main();
