// Gate for `declaration_asset.is_spouse` — WHOSE the declared thing is.
//
// THE RULE. Each asset row names its holder („Собственик или титуляр на правото"), and that
// person is frequently NOT the declarant. `isSpouseHolder` (src/lib/declarations.ts) is the
// one definition of „this row is somebody else's", and it is read from TWO sides that cannot
// share a query: the PARSER stores it here at parse time, while the /person stake renderer
// derives it live from `holderName` + `declarantName`, because `declaration_stake` has no
// such column.
//
// WHY THIS TEST. That split is the whole exposure. The rule is a pure function of two fields
// this table already carries, so the stored column is reproducible EXACTLY — which means any
// disagreement is a real defect and never an ambiguity, unlike the parse-time provenance in
// `held_scope` / `value_basis` / `table_num`, where SQL cannot check the parser's work at all.
// Concretely, the failure this catches is: someone changes the fold (a live example — the
// separator-only second pass added 2026-08-19, which cleared 563 rows), the renderer picks it
// up on the next build because it computes live, and the stored column keeps the OLD answer
// until `scripts/declarations/backfill_asset_is_spouse.ts` and a reload. Between those two the
// same corpus says two different things about whose company a named individual holds — a claim
// about a real person, on their own page.
//
// It is deliberately a FULL-CORPUS recompute rather than a sample: the rows that move are the
// register's hand-typing accidents (a lost space, a hyphen for a space, a stray comma or
// digit), which are by definition rare and unevenly spread, so a sample can miss all of them.
// 335,676 rows recompute in well under a second.
//
// Auto-skips when Postgres is down or the corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { isSpouseHolder, normHolderName } from "../../../src/lib/declarations";

const n = (v: unknown): number => Number(v ?? 0);

// ⚠️ Only a CONNECTION failure is a skip. A bare try/catch over the probes turns a permission
// error (42501 — a live class on this project's app_readonly path), a dropped table, or a typo
// in the probe itself into „Postgres is down" and takes all six tests green. These are
// ratchets; a swallowed fault is how one dies without anyone noticing.
//
// Memoised: six tests × two round trips is twelve queries for one answer that cannot change
// mid-run.
let reachableOnce: Promise<boolean> | undefined;
const reachable = (): Promise<boolean> =>
  (reachableOnce ??= (async () => {
    if (!(await dbReachable())) return false;
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_asset",
    );
    return n(c.n) > 0;
  })());

type Row = {
  holder_name: string | null;
  declarant_name: string;
  is_spouse: boolean;
  source_url: string;
  seq: number;
};

// Memoised: four of the six tests want the identical read-only set, and it is 335,676 joined
// rows — 1.2-2.2 s per pull on the local box, and this file keeps accreting corpus-wide gates.
let corpusOnce: Promise<Row[]> | undefined;
const corpus = (): Promise<Row[]> =>
  (corpusOnce ??= allRows<Row>(
    `SELECT a.holder_name, d.declarant_name, a.is_spouse, d.source_url, a.seq
       FROM declaration_asset a JOIN declaration d USING (declaration_id)`,
  ));

test("every stored is_spouse re-derives from the row's own holder and declarant", async () => {
  if (!(await reachable())) return;
  const rows = await corpus();
  const bad = rows.filter(
    (r) => r.is_spouse !== isSpouseHolder(r.holder_name, r.declarant_name),
  );
  const sample = bad
    .slice(0, 10)
    .map(
      (r) =>
        `  stored=${r.is_spouse} holder=${JSON.stringify(r.holder_name)} declarant=${JSON.stringify(r.declarant_name)}\n    ${r.source_url} seq=${r.seq}`,
    )
    .join("\n");
  assert.equal(
    bad.length,
    0,
    `${bad.length} of ${rows.length} asset row(s) disagree with isSpouseHolder — the fold changed and the corpus was not restamped. Run:\n` +
      `  npx tsx scripts/declarations/backfill_asset_is_spouse.ts --apply\n` +
      `  npm run db:load:declarations:pg\n` +
      `  npm run db:load:declarations:pg -- --resolve\n${sample}`,
  );
});

// An assertion that only ever compares the column to a function is satisfied by an inverted
// implementation both sides agree on, and by a corpus where nothing is marked at all. Pin the
// shape independently: the column must discriminate, and it must be the MINORITY answer.
test("the column discriminates and stays the minority answer", async () => {
  if (!(await reachable())) return;
  const [c] = await allRows<{ total: string; spouse: string; named: string }>(
    `SELECT count(*) total,
            count(*) FILTER (WHERE is_spouse) spouse,
            count(*) FILTER (WHERE holder_name IS NOT NULL AND btrim(holder_name) <> '') named
       FROM declaration_asset`,
  );
  const total = n(c.total);
  const spouse = n(c.spouse);
  assert.ok(
    spouse > 0,
    "no asset row is marked as somebody else's — the rule is not firing",
  );
  assert.ok(
    spouse < n(c.named),
    "every named holder is somebody other than the declarant — the fold has stopped matching",
  );
  // Measured 2026-08-19: 110,272 of 335,676 (32.9%). A band wide enough to survive a corpus
  // refresh and narrow enough to fail if the fold degenerates in either direction.
  const pct = (spouse / total) * 100;
  assert.ok(
    pct > 20 && pct < 50,
    `${spouse} of ${total} rows (${pct.toFixed(1)}%) marked as somebody else's — outside the 20-50% band`,
  );
});

// The separator-only second pass is the current fold's distinguishing property, and it is the
// half that a future "simplification" back to a bare `h !== d` would silently undo. Prove it is
// live against the corpus's own worst spellings rather than against a fixture: if any of these
// is stored as somebody else's holding, the running corpus predates the fold.
test("a declarant's own name survives the register's mangled spellings", async () => {
  if (!(await reachable())) return;
  const rows = await corpus();
  // The discriminator has to be the SECOND pass's own contribution, not „the folds differ" —
  // `normHolderName` alone already rescues a hyphen respaced („Димитриева - Николова"), so a
  // looser filter stays non-empty with the second pass deleted and the test proves nothing.
  // These are exactly the rows the first pass calls somebody else and the second reclaims.
  const selfMangled = rows.filter((r) => {
    const h = normHolderName(r.holder_name);
    const d = normHolderName(r.declarant_name);
    return (
      h !== "" &&
      d !== "" &&
      h !== d &&
      !isSpouseHolder(r.holder_name, r.declarant_name)
    );
  });
  assert.ok(
    selfMangled.length > 0,
    "no row is rescued by the separator fold — either the corpus changed or isSpouseHolder lost its second pass",
  );
  assert.ok(
    selfMangled.every((r) => r.is_spouse === false),
    "a row the fold rescues is still stored as somebody else's — the corpus needs restamping",
  );
});

// The gate above reads `declaration_asset` alone, which is correct for the drift it exists to
// catch — only the asset side has a STORED column that can go stale. But the headline
// measurement in `isSpouseHolder`'s header is over `declaration_stake`, on the side the header
// explicitly warns readers not to re-derive by hand, and nothing kept it true. Bands rather
// than literals: the corpus grows, and the load-bearing claim is the DIRECTION — the fold puts
// the declarant in the majority of named holders, which the raw `<>` count inverts.
test("the stake side still matches the split the header publishes", async () => {
  if (!(await reachable())) return;
  const rows = await allRows<{
    holder_name: string | null;
    declarant_name: string;
  }>(
    `SELECT s.holder_name, d.declarant_name
       FROM declaration_stake s JOIN declaration d USING (declaration_id)`,
  );
  const lettersOf = (v: string | null) =>
    normHolderName(v).replace(/[^\p{L}]/gu, "");
  const namesNobody = rows.filter(
    (r) => lettersOf(r.holder_name) === "",
  ).length;
  const named = rows.length - namesNobody;
  const other = rows.filter((r) =>
    isSpouseHolder(r.holder_name, r.declarant_name),
  ).length;

  assert.ok(
    other > 0 && other < named,
    "the fold has stopped discriminating on stakes",
  );
  assert.ok(
    other < named / 2,
    `„somebody else" is ${other} of ${named} named holders — the majority. The fold has stopped ` +
      `matching, or the header's split needs re-measuring; do NOT restate the raw <> count, which inverts it.`,
  );
  // A row the fold counts as somebody else must actually name somebody: this is the
  // letters-free class (21 asset + 8 stake rows before the guard), where „-" or „." was
  // published as a third party on the declarant's own page.
  const letterless = rows.filter(
    (r) =>
      lettersOf(r.holder_name) === "" &&
      isSpouseHolder(r.holder_name, r.declarant_name),
  );
  assert.equal(
    letterless.length,
    0,
    `${letterless.length} stake row(s) whose holder cell has no letters are published as somebody else's`,
  );
});

// ── THE RESIDUE RATCHET AND THE PER-TIER NON-VACUITY FLOOR ────────────────────────────
//
// docs/plans/declaration-holder-self-fold-v1.md T7.2 and T7.3. The gate above compares the
// stored column to the function, so it is satisfied by ANY rule both sides agree on —
// including one that folds nothing. These two close that from both ends, and they classify
// the corpus with predicates written HERE rather than by calling isSpouseHolder, so a change
// to the rule cannot move the test with it.
//
// ⚠️ INDEPENDENT OF THE FOLD LOGIC, NOT OF THE NORMALISATION. `deHomo`, `DECOR`,
// `LEADING_TITLES`, `undecorated`, `oneEditApart` and `soleDiff` are all local copies — a
// classifier that imported the allowlist it is checking could not notice that allowlist
// changing. `normHolderName` is deliberately SHARED: it is the case fold, the NFC pass and the
// hyphen respacing, i.e. what „the same string" means before any pass runs, and re-deriving it
// would test a different corpus rather than the rule. It fails safe — every local allowlist
// here is keyed on the uppercase form it produces.
//
// Shapes are the classes of the plan's §1: a Latin homoglyph, a decoration-only difference, a
// token subset, an initial, one token differing by one edit, and a re-ordering.
//
// ⚠️ A row matching NONE of the six is not inspected by either gate. Of the 102,234 currently
// marked, these look at 267 — the plan's ~96,400 „genuinely another person" rows and its 5,385
// MIXED rows are never read, and a mis-fold class §1 did not enumerate is invisible here. This
// is a per-class regression detector, not a coverage measure of `is_spouse`: a green ratchet is
// no evidence that the 96,400 are right.

const LETTERS = /[^\p{L}]/gu;
const lettersOnlyOf = (v: string | null): string =>
  normHolderName(v).replace(LETTERS, "");
const tokensOf = (v: string | null): string[] =>
  normHolderName(v)
    .split(/\s+/)
    .map((t) => t.replace(LETTERS, ""))
    .filter(Boolean);

const HOMO: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};
const deHomo = (s: string): string => [...s].map((c) => HOMO[c] ?? c).join("");

// Deliberately a SEPARATE list from the rule's own: a test that imports the allowlist it is
// checking cannot notice the allowlist changing underneath it.
const DECOR = new Set([
  "СИО",
  "ЗП",
  "ЕТ",
  "ИД",
  "ЧАСТ",
  "ЧАСТИ",
  "ИДЕАЛНА",
  "ИДЕАЛНИ",
  "НАСЛЕДСТВО",
  "ДАРЕНИЕ",
  "ПРЕЗ",
  "ГОДИНА",
  "СЪКРЕДИТОР",
  "СЪДЛЪЖНИК",
  "ПРОДАВАЧ",
  "КУПУВАЧ",
  "ДАРИТЕЛ",
  "СОБСТВЕНИК",
  "СОБСТВЕНОСТ",
  "В",
  "НА",
  "ОТ",
  "ПО",
  "ЗА",
  "И",
]);
// A title is decoration in LEADING position only. `tokenize` reduces „д-р" (the title) and
// „др." („други" — AND OTHERS, i.e. holders the cell does not name) to the same token, so a
// position-blind shape calls „X и др." a decoration-only difference and the ratchet then
// reads the rule's deliberate refusal of it as a residue.
const LEADING_TITLES = new Set(["АДВ", "ДР", "ПРОФ", "ДОЦ", "ИНЖ", "АРХ"]);
const undecorated = (t: string[]): string[] => {
  const body = t[0] !== undefined && LEADING_TITLES.has(t[0]) ? t.slice(1) : t;
  return body.filter((x) => !DECOR.has(x));
};

const oneEditApart = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) return false;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] === 1;
};

const soleDiff = (H: string[], D: string[]): [string, string] | null => {
  if (H.length !== D.length) return null;
  const rest = [...D];
  const left: string[] = [];
  for (const t of H) {
    const i = rest.indexOf(t);
    if (i >= 0) rest.splice(i, 1);
    else left.push(t);
  }
  return left.length === 1 && rest.length === 1 ? [left[0], rest[0]] : null;
};

/** Which of the plan's classes does this (holder, declarant) pair have the SHAPE of?
 *  Independent of the rule: this says what the pair looks like, not what the rule did. */
const shapeOf = (holder: string | null, declarant: string): string | null => {
  const hl = lettersOnlyOf(holder);
  const dl = lettersOnlyOf(declarant);
  if (!hl || !dl || hl === dl) return null;
  if (deHomo(hl) === deHomo(dl)) return "homoglyph";
  const H = tokensOf(holder).map(deHomo);
  const D = tokensOf(declarant).map(deHomo);
  const Hs = undecorated(H);
  const Ds = undecorated(D);
  if (Hs.length && Ds.length && Hs.join("") === Ds.join(""))
    return "decoration";
  if (
    Hs.length >= 2 &&
    Hs.length < Ds.length &&
    Hs[0] === Ds[0] &&
    Hs.every(
      (t) =>
        Ds.filter((x) => x === t).length >= Hs.filter((x) => x === t).length,
    )
  )
    return "subset";
  if (H.length >= 2 && H.length === D.length) {
    const pair = soleDiff(H, D);
    if (pair) {
      const [a, b] = pair;
      if (
        (a.length === 1 && b.startsWith(a)) ||
        (b.length === 1 && a.startsWith(b))
      )
        return "initial";
      if (oneEditApart(a, b)) return "one-edit";
    }
    if (H[0] === D[0] && [...H].sort().join("|") === [...D].sort().join("|"))
      return "reorder";
  }
  return null;
};

const SHAPES = [
  "homoglyph",
  "decoration",
  "subset",
  "initial",
  "one-edit",
  "reorder",
] as const;

/** Rows still marked as somebody else's DESPITE having a fold's shape. Every one is a
 *  deliberate refusal. Measured 2026-09-05 on the restamped corpus. */
const RESIDUE_CEILING: Record<(typeof SHAPES)[number], number> = {
  homoglyph: 0,
  decoration: 0,
  subset: 0,
  initial: 0,
  // T5's masc/fem carve-out on the family name — the whole 267, measured 2026-09-05. The
  // generational-rotation and under-three-token refusals contribute 0 rows each: no corpus
  // row carries either signature, so a change in THIS number is the carve-out moving and
  // nothing else. Widening the carve-out to every token position — the alternative the plan
  // measures at 440 rows against 270 — lands at ~435 and trips this.
  "one-edit": 400,
  // 0 measured. Both of the rule's reorder refusals (a repeated token, a generational
  // rotation) are 0 rows corpus-wide, so any slack here is slack on the tier the plan ranks
  // riskiest — 23 pairs verified by hand precisely because a naming convention can produce
  // two people from one token set.
  reorder: 0,
};

/** ⚠️ THE CEILING ALONE IS ONE-SIDED, AND THE MISSING SIDE IS THE ONE THAT MATTERS.
 *
 *  A ceiling catches a class GROWING — a spelling the rule has not learned. It cannot catch
 *  a class SHRINKING TO NOTHING, which is what an over-eager fold looks like, and plan §4
 *  names that the direction that must not fail: a household member's declared property
 *  relabelled as a named public figure's own.
 *
 *  Measured: delete T5's masc/fem carve-out, restamp as §6 requires, and `one-edit` residue
 *  goes 267 → 0 while its folds go 5,056 → 5,323. Under a ceiling and over a floor — all six
 *  tests green, on the normal shipping path. So any class whose residue is REQUIRED rather
 *  than merely tolerated carries a floor too.
 *
 *  Only `one-edit` has one today. The other five have a residue of 0 by design, and their
 *  refusals are pinned by fixtures in src/lib/declarations.test.ts instead. */
const RESIDUE_FLOOR: Partial<Record<(typeof SHAPES)[number], number>> = {
  "one-edit": 200,
};

test("no fold class grows a residue of rows still marked as somebody else's", async () => {
  if (!(await reachable())) return;
  const rows = await corpus();
  // ⚠️ `is_spouse` is NOT NULL DEFAULT false, so „never stamped" and „nothing is marked" are
  // the SAME state to everything below — every class would report 0 residue and every ceiling
  // would pass. „The corpus has no provenance yet" must never read as „the rule is enforced",
  // which is why this says so in its own words rather than relying on a sibling test.
  assert.ok(
    rows.some((r) => r.is_spouse),
    "no row is marked as somebody else's — the corpus has never been stamped, so this " +
      "ratchet is measuring nothing. Run backfill_asset_is_spouse.ts --apply, then reload.",
  );
  // The two sides read DIFFERENT sources on purpose, because they detect different things.
  //
  //   ceiling — the STORED column: „has the register grown a spelling the rule cannot fold?"
  //   floor   — the RULE: „does the rule still refuse what it is supposed to refuse?"
  //
  // A floor over the stored column would only fire AFTER a restamp, which is the normal
  // shipping path — so a deleted carve-out would ship, restamp, and read as green until the
  // next reload. Asking the rule makes it fire the moment the refusal disappears.
  const residue = new Map<string, { n: number; sample: string[] }>();
  const refused = new Map<string, number>();
  for (const r of rows) {
    const shape = shapeOf(r.holder_name, r.declarant_name);
    if (!shape) continue;
    if (isSpouseHolder(r.holder_name, r.declarant_name))
      refused.set(shape, (refused.get(shape) ?? 0) + 1);
    if (!r.is_spouse) continue;
    const e = residue.get(shape) ?? { n: 0, sample: [] };
    e.n += 1;
    if (e.sample.length < 5)
      e.sample.push(`${r.holder_name} ⟂ ${r.declarant_name}`);
    residue.set(shape, e);
  }
  for (const shape of SHAPES) {
    const got = residue.get(shape);
    const n = got?.n ?? 0;
    assert.ok(
      n <= RESIDUE_CEILING[shape],
      `${n} rows with the ${shape} shape are still marked as somebody else's, ` +
        `above the recorded ceiling of ${RESIDUE_CEILING[shape]}. Either a pass stopped ` +
        `firing, or the register grew a spelling the rule has not learned:\n  ` +
        (got?.sample.join("\n  ") ?? ""),
    );
    const floor = RESIDUE_FLOOR[shape];
    if (floor !== undefined)
      assert.ok(
        (refused.get(shape) ?? 0) >= floor,
        `the rule refuses only ${refused.get(shape) ?? 0} rows with the ${shape} shape, under the floor of ` +
          `${floor}. That residue is a DELIBERATE refusal, not slack — a fold has swallowed ` +
          `it, which is the direction plan §4 says must not fail. The likely cause is T5's ` +
          `masculine/feminine carve-out on the family name.`,
      );
  }
});

// The mutation check the plan's T7.3 asks for, expressed as a per-tier floor. „The rule folds
// initials" is satisfied by a rule that folds nothing, so each pass has to be shown FIRING on
// the live corpus: a pass that is deleted or narrowed to a no-op drops its count to 0 here.
//
// Measured counts, produced by THIS file's shapeOf over the restamped corpus (2026-09-05) and
// deliberately NOT copied from the rule's own comments, whose per-tier figures count different
// populations: homoglyph 61, decoration 1,441, subset 1,307, initial 75, one-edit 5,056,
// reorder 68. The floors sit far under all but one of them.
//
// ⚠️ `homoglyph` is the one class this cannot fully isolate, and the mutation check is how
// that surfaced: with `deHomoglyph` neutered to the identity, the class stays ABOVE its floor
// because a single Latin letter inside one token is also a ONE-EDIT difference, so T5 folds
// the same rows by another route. The homoglyph pass earns its place on what T5 cannot reach
// — „ПETKO ДОБРЕВ ПЕТКОВ" carries three Latin letters in one token (edit distance 3) — and a
// dead homoglyph pass is caught by the parity test above rather than here.
const FOLD_FLOOR: Record<(typeof SHAPES)[number], number> = {
  homoglyph: 10,
  decoration: 200,
  subset: 200,
  // ⚠️ `initial` IS NOT A DISTRIBUTION, IT IS ONE PERSON. 75 rows over three declarants,
  // split 70 / 4 / 1 — Дирк Йохан Густаф Пергот carries the 70. Phase 1 TRUNCATEs and
  // reloads, and the register withdraws and re-files, so a floor keyed on that filing fails
  // the day it leaves and tells the operator the RULE regressed. Set below what the other
  // two declarants supply (5), and still non-vacuous: with the T4 arm deleted the class is
  // 0, not 5 — an initial-shaped pair cannot reach T5 (the length prefilter refuses „С"
  // against „СПАСОВА") nor T6.
  initial: 3,
  "one-edit": 500,
  reorder: 10,
};

test("every fold class is actually firing on the corpus", async () => {
  if (!(await reachable())) return;
  const rows = await corpus();
  const folded = new Map<string, number>();
  for (const r of rows) {
    // Asks the RULE, not the stored column. Reading `is_spouse` here would only prove the
    // corpus still carries yesterday's folds — a pass deleted today would keep passing
    // until someone restamped. This way a neutered pass drops its class to 0 immediately.
    if (isSpouseHolder(r.holder_name, r.declarant_name)) continue;
    const shape = shapeOf(r.holder_name, r.declarant_name);
    if (!shape) continue;
    folded.set(shape, (folded.get(shape) ?? 0) + 1);
  }
  for (const shape of SHAPES) {
    const got = folded.get(shape) ?? 0;
    assert.ok(
      got >= FOLD_FLOOR[shape],
      `only ${got} rows fold via the ${shape} class, under the floor of ${FOLD_FLOOR[shape]} — ` +
        `that pass has stopped firing, or the corpus lost the spellings it exists for`,
    );
  }
});

afterAll(async () => {
  await end();
});
