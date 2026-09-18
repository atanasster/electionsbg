// Standalone typo-robustness test for the REAL production person-search
// route (electionsbg.com/api/db/person-search) — no Jev, no LLM involved.
// Isolates the retrieval question the Jev name-disambiguation probe surfaced:
// does the trigram/fuzzy search even SURFACE the right person under a
// single-letter typo, before asking anything about disambiguation.
//
//   npx tsx ai/llm/personSearchTypoTest.ts [sampleSize]
//
// Names come from the COMMITTED data/parliament/mp-cars.json (real MPs, real
// full names, no network needed to build the sample) — deterministic, evenly
// spread selection (every Nth name), not random, so a re-run is reproducible.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PROD_BASE = "https://electionsbg.com";

type PersonHit = { key: string; name: string };
type PersonSearchPayload = {
  power?: PersonHit[];
  money?: PersonHit[];
  others?: PersonHit[];
};

const fetchPersonSearch = async (
  q: string,
  limit = 8,
): Promise<PersonHit[]> => {
  const res = await fetch(
    `${PROD_BASE}/api/db/person-search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as PersonSearchPayload;
  return [...(data.power ?? []), ...(data.money ?? []), ...(data.others ?? [])];
};

const foldName = (s: string): string =>
  s.toLowerCase().replace(/[^a-zа-я]/gi, "");

// ---- deterministic typo generators (Cyrillic-safe: operate on code points,
// not UTF-16 code units, since Cyrillic is all in the BMP this is equivalent,
// but keeping it explicit avoids the exact trap CLAUDE.md flags for BG text).
const dropLetter = (name: string): string => {
  // drop a letter inside the SECOND word (the patronymic), skipping spaces —
  // picking a fixed relative position keeps this deterministic.
  const words = name.split(" ");
  if (words.length < 2) return name;
  const target = words[1];
  const idx = Math.floor(target.length / 2);
  words[1] = target.slice(0, idx) + target.slice(idx + 1);
  return words.join(" ");
};

const transposeLetters = (name: string): string => {
  const words = name.split(" ");
  if (words.length < 2) return name;
  const wi = words.length - 1; // the surname, which is what a typo test wants
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

type Row = {
  name: string;
  kind: string;
  typoQuery: string;
  found: boolean;
  hitCount: number;
  rankIfFound: number | null; // 1-based position among returned hits
  error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const sampleSize = Number(process.argv[2]) || 40;
  const mpCars = JSON.parse(
    readFileSync(join(ROOT, "data/parliament/mp-cars.json"), "utf8"),
  ) as { cars: { mpName: string }[] };
  const names = [
    ...new Set(
      mpCars.cars.map((c) => c.mpName).filter((n) => n.split(" ").length === 3),
    ),
  ].sort();
  const step = Math.max(1, Math.floor(names.length / sampleSize));
  const sample = names.filter((_, i) => i % step === 0).slice(0, sampleSize);

  console.log(
    `\nperson-search typo-robustness test — ${sample.length} real MP names × ${TYPO_KINDS.length} typo kinds = ${sample.length * TYPO_KINDS.length} queries\n(electionsbg.com/api/db/person-search, no Jev)\n`,
  );

  const rows: Row[] = [];
  // Modest concurrency + pacing — this is prod's public API, be polite.
  const concurrency = 4;
  const tasks: { name: string; kind: string; fn: (s: string) => string }[] = [];
  for (const name of sample)
    for (const t of TYPO_KINDS) tasks.push({ name, kind: t.kind, fn: t.fn });
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const { name, kind, fn } = tasks[i];
      const typoQuery = fn(name);
      if (typoQuery === name) continue; // generator was a no-op (e.g. very short surname)
      try {
        await sleep(50);
        const hits = await fetchPersonSearch(typoQuery, 8);
        const target = foldName(name);
        const rank = hits.findIndex((h) => foldName(h.name) === target);
        rows.push({
          name,
          kind,
          typoQuery,
          found: rank !== -1,
          hitCount: hits.length,
          rankIfFound: rank === -1 ? null : rank + 1,
        });
      } catch (e) {
        rows.push({
          name,
          kind,
          typoQuery,
          found: false,
          hitCount: 0,
          rankIfFound: null,
          error: String(e instanceof Error ? e.message : e),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const byKind = new Map<string, Row[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  console.log("=== by typo kind ===");
  for (const [kind, rs] of byKind) {
    const found = rs.filter((r) => r.found).length;
    const rank1 = rs.filter((r) => r.rankIfFound === 1).length;
    console.log(
      `  ${kind.padEnd(28)} survived: ${found}/${rs.length} (${Math.round((100 * found) / rs.length)}%)   rank#1: ${rank1}/${rs.length}`,
    );
  }
  const totalFound = rows.filter((r) => r.found).length;
  console.log(
    `\nOVERALL: ${totalFound}/${rows.length} (${Math.round((100 * totalFound) / rows.length)}%) typo'd queries still surfaced the correct person in the top 8.\n`,
  );

  console.log("=== misses (correct person NOT in top 8) ===");
  for (const r of rows.filter((x) => !x.found)) {
    console.log(
      `  [${r.kind}] "${r.name}" -> "${r.typoQuery}"${r.error ? `  ERROR: ${r.error}` : ""}`,
    );
  }
};

main();
