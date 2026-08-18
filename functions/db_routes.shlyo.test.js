// Шльокавица in the price search.
//
// A reader typing on a Latin keyboard gets nothing unless the needle is turned
// back into Cyrillic — price_products.title is Cyrillic and has no Latin-folded
// column. Measured before this: "mliako" returned "Няма резултати".
//
// TWO KINDS of substitution, and the point of these tests is that neither
// alone is enough. The site's maintained keyboard table (src/lib/shlyoRules.ts,
// mirrored into SQL as shlyo_query_fold) handles "6umen" and "sofiq" and leaves
// "mliako" alone; the phonetic pass handles "mlyako" and left "6umen" as
// "6умен".

const test = require("node:test");
const assert = require("node:assert/strict");
const { shlyoCandidates } = require("./db_routes");

/** Does any candidate spelling reach the Cyrillic word? */
const reaches = (term, target) => shlyoCandidates(term).includes(target);

test("the phonetic pass alone: ordinary Latin spellings", () => {
  assert.ok(reaches("mlyako", "мляко"));
  assert.ok(reaches("kafe", "кафе"));
  assert.ok(reaches("sirene", "сирене"));
  assert.ok(reaches("maslo", "масло"));
});

test("the keyboard pass: digits and spare letters standing in for Cyrillic", () => {
  // None of these is reachable by phonetic transliteration alone — the digits
  // and `q` are not letters it maps.
  assert.ok(reaches("6okolad", "шоколад"));
  assert.ok(reaches("4erven", "червен"));
  assert.ok(reaches("jelyazko", "желязко"));
});

test("the i-glide: 'mliako' — the spelling that returned nothing", () => {
  assert.ok(reaches("mliako", "мляко"));
  assert.ok(reaches("biuro", "бюро"));
});

test("'yai' survives the 'ya' rule — qica is яйца, not яица", () => {
  // q→ya leaves "ica", and a bare "ya" rule then yields "яица", which misses
  // all 228 egg products in the catalogue. The trigraph has to be tried first.
  assert.ok(reaches("qica", "яйца"));
  assert.ok(reaches("yaica", "яйца"));
  assert.ok(!reaches("qica", "яица"), "the wrong reading is not what wins");
});

test("an ambiguous rule ADDS a reading, never replaces one", () => {
  // "ia" is я in мляко and и-а in италиа. Both must be offered, or fixing one
  // word breaks the other.
  const c = shlyoCandidates("italia");
  assert.ok(c.includes("италиа"), "the literal reading survives");
  assert.ok(c.includes("италя"), "the glide reading is offered too");
});

test("a Cyrillic query is passed through untouched", () => {
  // The transliteration must be a no-op on text that is already Cyrillic, or
  // every ordinary search pays for extra ILIKE arms that cannot match.
  assert.deepEqual(shlyoCandidates("мляко"), ["мляко"]);
  assert.deepEqual(shlyoCandidates("кафе"), ["кафе"]);
});

test("the raw term is always the first candidate", () => {
  // The шльокавица pass is strictly additive: whatever it produces, the term
  // the user actually typed is still searched, and searched first.
  for (const t of ["mliako", "мляко", "lurpak", "6okolad"])
    assert.equal(shlyoCandidates(t)[0], t.toLowerCase());
});

test("candidates are deduped and bounded", () => {
  // The route builds one ILIKE arm per candidate, so an unbounded list would
  // grow the query with the input.
  for (const t of ["mliako", "6okolad", "sirene", "мляко", "x"]) {
    const c = shlyoCandidates(t);
    assert.equal(new Set(c).size, c.length, `${t} has duplicate candidates`);
    assert.ok(c.length <= 5, `${t} produced ${c.length} candidates`);
  }
});

test("the keyboard rules match src/lib/shlyoRules.ts", () => {
  // functions/ is a separate CJS package and cannot import the shared table, so
  // this is the gate that keeps the hand-copy honest. Reads the source rather
  // than the compiled module.
  const fs = require("node:fs");
  const path = require("node:path");
  const shared = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "shlyoRules.ts"),
    "utf8",
  );
  const table = shared.slice(
    shared.indexOf("export const SHLYO_RULES"),
    shared.indexOf("/** What the rules can actually rewrite"),
  );
  // Every left-hand side the shared table declares must appear in ours.
  const finds = [...table.matchAll(/find:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(finds.length >= 8, "shared table not parsed");
  const ours = fs.readFileSync(path.join(__dirname, "db_routes.js"), "utf8");
  const keyboard = ours.slice(
    ours.indexOf("const SHLYO_KEYBOARD"),
    ours.indexOf("const LAT2CYR_DIGRAPHS"),
  );
  for (const find of finds)
    assert.ok(
      keyboard.includes(`/${find}/g`),
      `SHLYO_RULES declares "${find}" and functions/db_routes.js does not — ` +
        "the two шльокавица tables have drifted",
    );
});
