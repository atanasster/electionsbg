// Correctness harness for the schoolMatura name matcher (two-way containment).
// Run: npx tsx ai/tools/education.harness.ts  (part of `npm run ai:test:all`).
//
// Pins the exact matching contract the tool relies on: a clean school-name arg
// (LLM path) matches as a substring of the record, a longer residual query
// ("успех на матурата на <school>") matches because it CONTAINS the school name,
// and a short junk needle does not over-match. The `needle.length >= 4` gate on
// the reverse direction is precisely the kind of thing a refactor breaks quietly.

import { matchSchoolByName } from "./education";

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures += 1;
};

type S = { name: string; latestScore: number | null };
const schools: S[] = [
  {
    name: "Софийска математическа гимназия Паисий Хилендарски",
    latestScore: 5.75,
  },
  { name: "Първа английска езикова гимназия", latestScore: 5.5 },
  { name: "91. Немска езикова гимназия", latestScore: 5.4 },
  { name: "СУ Неофит Рилски", latestScore: 4.38 },
];

console.log("schoolMatura matchSchoolByName:");

// Forward: a clean partial name is a substring of the record.
{
  const r = matchSchoolByName(schools, "математическа гимназия");
  ok(
    r[0]?.name.includes("математическа"),
    "clean partial name → math gymnasium",
  );
}

// Reverse: a residual query CONTAINS the full school name (needle.length >= 4).
{
  const r = matchSchoolByName(
    schools,
    "какъв е успехът на матурата на първа английска езикова гимназия",
  );
  ok(
    r[0]?.name === "Първа английска езикова гимназия",
    "residual query → the school name it contains",
  );
}

// A junk needle with no substring anywhere returns nothing.
{
  const r = matchSchoolByName(schools, "zzzq");
  ok(r.length === 0, "junk needle → no matches");
}

// A short (<4) needle only forward-matches real substrings — the reverse
// (contains) path is gated off, so it can't pull in unrelated records.
{
  const r = matchSchoolByName(schools, "мат");
  ok(
    r.every((s) => s.name.toLowerCase().includes("мат")),
    "short needle only forward-matches substrings",
  );
}

// Multiple matches come back sorted by score, best first.
{
  const r = matchSchoolByName(schools, "гимназия");
  ok(
    r.length >= 3 && (r[0].latestScore ?? 0) >= (r[1].latestScore ?? 0),
    "'гимназия' → multiple matches, sorted by score desc",
  );
}

// A record with no matura score is never a match.
{
  const withNull: S[] = [
    ...schools,
    { name: "Нова гимназия", latestScore: null },
  ];
  const r = matchSchoolByName(withNull, "нова гимназия");
  ok(r.length === 0, "school with null latestScore is excluded");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
