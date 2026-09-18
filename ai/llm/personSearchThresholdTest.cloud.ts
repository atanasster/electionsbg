// Same word_similarity threshold sweep as personSearchThresholdTest.ts, run
// READ-ONLY against the REAL production person_search table (597,346 rows:
// tier P 63,649 · V 85,286 · N 448,411) via the Cloud SQL proxy, to check
// whether the isolated 360-row test's result-set-growth numbers (the thing
// that couldn't transfer from a toy table) hold at real scale.
//
// `SET pg_trgm.word_similarity_threshold` is SESSION-scoped — nothing here
// persists past this script's one connection, and nothing writes. The proxy
// must already be running: `npm run db:proxy:cloud` (port 5434).
//
//   PGPASSFILE=.pgpass npx tsx ai/llm/personSearchThresholdTest.cloud.ts

import { Client } from "pg";

const CONN = "postgres://postgres@127.0.0.1:5434/electionsbg";

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

// Mirrors the real fuzzyQ in functions/db_routes.js exactly: tier-scoped,
// one `%>` arm per qualifying word ANDed, ordered by the real rank_static,
// LIMIT 8 (the size used throughout this chat's earlier tests).
const runFuzzyQuery = async (
  client: Client,
  typoQuery: string,
): Promise<{ key: string; name: string }[]> => {
  const words = qualifyingWords(typoQuery);
  if (!words.length) return [];
  const arms = words
    .map((_, i) => `name_fold %> translit_bg_latin($${i + 2})`)
    .join(" AND ");
  const { rows } = await client.query(
    `SELECT key, name FROM person_search WHERE tier = $1 AND ${arms} ORDER BY rank_static DESC LIMIT 8`,
    [TIER, ...words],
  );
  return rows;
};

const THRESHOLDS = process.argv[3]
  ? process.argv[3].split(",").map(Number)
  : [0.6, 0.4, 0.35, 0.3, 0.25];
const SAMPLE_SIZE = Number(process.argv[2]) || undefined;
const TIER = (process.argv[4] || "P") as "P" | "V" | "N";

const main = async () => {
  const client = new Client(CONN);
  await client.connect();
  await client.query("SELECT 'a' % 'a'"); // force-load pg_trgm's GUCs into this backend

  // Real MP full names, straight from the real table (tier P) — same
  // selection rule as the isolated test (3-word names), but these are the
  // ACTUAL rows the real trigram index scans, not a copy.
  const { rows: nameRows } = await client.query<{ name: string }>(
    `SELECT DISTINCT name FROM person_search WHERE tier = $1 AND array_length(regexp_split_to_array(name, '\\s+'), 1) = 3 ORDER BY name`,
    [TIER],
  );
  const allNames = nameRows.map((r) => r.name);
  const step = SAMPLE_SIZE
    ? Math.max(1, Math.floor(allNames.length / SAMPLE_SIZE))
    : 1;
  const names = allNames
    .filter((_, i) => i % step === 0)
    .slice(0, SAMPLE_SIZE ?? allNames.length);
  console.log(
    `\n${names.length}/${allNames.length} real MP names (tier P) pulled from the LIVE person_search table (evenly-spaced sample).\n`,
  );

  const tasks: { name: string; kind: string; typoQuery: string }[] = [];
  for (const name of names)
    for (const t of TYPO_KINDS) {
      const typoQuery = t.fn(name);
      if (typoQuery !== name) tasks.push({ name, kind: t.kind, typoQuery });
    }
  console.log(
    `TIER ${TIER} — ${tasks.length} typo'd queries per threshold × ${THRESHOLDS.length} thresholds, read-only, against 597,346 real rows.\n`,
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
      const maxSize = Math.max(...b.resultSizes);
      console.log(
        `  ${kind.padEnd(28)} survived (top 8): ${b.found}/${b.total} (${Math.round((100 * b.found) / b.total)}%)   mean result-set size: ${meanSize.toFixed(1)}   max: ${maxSize}`,
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
