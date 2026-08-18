// Gate for `src/lib/cultureMatch.ts` — the free-text half of "is this culture".
//
// It exists because the culture plan was drafted with four headline figures
// whose matching was never written down. Publishing the matchers moved two of
// them by more than a third, in OPPOSITE directions, and each direction has its
// own failure mode — which is why the assertions below come in four kinds:
//
//   1. FIGURES — each published number, within a band around its recorded
//      measurement. The band is deliberately NARROWER than the smallest guard
//      effect (kind 2), and kind 4 asserts that relationship, because a band
//      wider than a guard hides the guard's removal completely.
//   2. THE GUARD STILL GUARDS — each exclusion list, and the `art` anchoring,
//      must CHANGE the number it protects. A guard that does not move its own
//      figure is what a well-meaning "simplify these regexes" removes with
//      nothing going red.
//   3. NAMED CASES — the specific false positives that produced each defect stay
//      out, and named true positives stay IN. Kind 2 alone is satisfiable by an
//      exclusion removing the wrong rows; only naming them pins the meaning. An
//      exclusion case also asserts the row EXISTS unguarded, so "excluded" can
//      never be satisfied by "absent from the corpus".
//   4. AGREEMENT — every curated culture institution with an ИСУН row must be
//      admitted by the name matcher. This is the assertion that catches a
//      FALSE NEGATIVE, and nothing else here can: `театр` (the adjectival stem)
//      silently missed „Народен театър" and 23 other theatres — €14.6m — while
//      still matching nine adjectival rows, so every count stayed non-zero.
//
// Auto-skips ONLY when Postgres is down; the hermetic rendering tests below run
// regardless. An empty result is a failure, not a skip: every corpus this reads
// is loaded by `db:refresh` from a committed or cached input.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  cultureNameSql,
  chitalishteNameSql,
  interregThemeSql,
  CULTURE_NAME_INCLUDE,
  INTERREG_CULTURE_THEME_INCLUDE,
} from "@/lib/cultureMatch";
import { STATE_CULTURE_INSTITUTE_EIKS } from "@/lib/kulturaReferenceData";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/** Measured 2026-08-18 against local PG. Re-measure and update deliberately when
 *  a corpus reload moves one past the band — the band is not slack, it is the
 *  headroom the guard assertions need (see TOLERANCE). */
const MEASURED = {
  isunGuarded: { rows: 1559, benef: 1365, eur: 147_135_798 },
  isunUnguarded: { rows: 1636, benef: 1376, eur: 174_931_733 },
  isunChitalishta: { rows: 1332, benef: 1196, eur: 22_140_281 },
  agriChitalishta: { rows: 264, benef: 197, eur: 18_341_814 },
  agriGuarded: { rows: 277, benef: 208, eur: 18_956_087 },
  agriUnguarded: { rows: 624, benef: 222, eur: 21_787_877 },
  interregGuarded: { rows: 202, benef: 168, eur: 48_807_847 },
  interregUnguarded: { rows: 227, benef: 185, eur: 52_833_827 },
  interregBareArt: { rows: 302, benef: 242, eur: 66_991_079 },
} as const;

/** 5%, and the number is derived rather than chosen: the smallest guard effect
 *  is the Interreg exclusion at 7.6% of money. A band at or above that makes the
 *  corresponding FIGURE test blind to the guard's removal — the figure would
 *  simply move inside its own tolerance. `the bands stay narrower than the
 *  guards` asserts this, so raising TOLERANCE fails rather than silently
 *  weakening kind 1. */
const TOLERANCE = 0.05;

type Agg = { rows: number; benef: number; eur: number };

const agg = async (sql: string): Promise<Agg> => {
  const [r] = await allRows<{ n: string; b: string; g: string | null }>(sql);
  return {
    rows: Number(r?.n ?? 0),
    benef: Number(r?.b ?? 0),
    eur: Number(r?.g ?? 0),
  };
};

// ONE beneficiary denominator per corpus, and both are `coalesce(<id>, <name>)`.
// agri_subsidies has 2,094,249 rows with a NULL eik, so counting DISTINCT eik
// there drops every unregistered beneficiary — it under-counts читалища by 27
// (170 vs 197) and disagrees with the ИСУН arm about what "a beneficiary" is.
const isun = (where: string) =>
  agg(`SELECT count(*) n,
              count(DISTINCT coalesce(beneficiary_eik, beneficiary_name)) b,
              round(sum(grant_eur)::numeric, 0) g
       FROM fund_projects WHERE ${where}`);

const agri = (where: string) =>
  agg(`SELECT count(*) n, count(DISTINCT coalesce(eik, name)) b,
              round(sum(total_eur)::numeric, 0) g
       FROM agri_subsidies WHERE ${where}`);

const interreg = (where: string) =>
  agg(`SELECT count(*) n, count(DISTINCT p.partner_name) b,
              round(sum(p.budget_eur)::numeric, 0) g
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
       WHERE p.country = 'Bulgaria' AND ${where}`);

const near = (actual: Agg, expected: Agg, label: string) => {
  for (const k of ["rows", "benef", "eur"] as const) {
    const lo = expected[k] * (1 - TOLERANCE);
    const hi = expected[k] * (1 + TOLERANCE);
    assert.ok(
      actual[k] >= lo && actual[k] <= hi,
      `${label}.${k}: ${actual[k]} is outside ±${TOLERANCE * 100}% of the ` +
        `2026-08-18 measurement ${expected[k]}. Either a matcher changed ` +
        `meaning, or the corpus moved and MEASURED needs re-deriving — check ` +
        `which before widening anything.`,
    );
  }
};

/** Does `needle` survive the guarded matcher, and did it exist unguarded? */
const isunAdmits = async (needle: string) => {
  const [r] = await allRows<{ kept: string; raw: string }>(
    `SELECT count(*) FILTER (WHERE ${cultureNameSql("beneficiary_name")}) kept,
            count(*) raw
       FROM fund_projects WHERE beneficiary_name ~* $1`,
    [needle],
  );
  return { kept: Number(r?.kept ?? 0), raw: Number(r?.raw ?? 0) };
};

// ── 1. the published figures ─────────────────────────────────────────────────

test.skipIf(skip)("the ИСУН culture arm matches its measurement", async () => {
  const got = await isun(cultureNameSql("beneficiary_name"));
  assert.ok(got.rows > 0, "no ИСУН culture rows — is fund_projects loaded?");
  near(got, MEASURED.isunGuarded, "isunGuarded");
});

test.skipIf(skip)("the читалища arm matches, in both corpora", async () => {
  near(
    await isun(chitalishteNameSql("beneficiary_name")),
    MEASURED.isunChitalishta,
    "isunChitalishta",
  );
  near(
    await agri(chitalishteNameSql("name")),
    MEASURED.agriChitalishta,
    "agriChitalishta",
  );
});

test.skipIf(skip)(
  "the ДФЗ culture arm matches, and stays читалища",
  async () => {
    const got = await agri(cultureNameSql("name"));
    assert.ok(got.rows > 0, "no ДФЗ culture rows — is agri_subsidies loaded?");
    near(got, MEASURED.agriGuarded, "agriGuarded");
    // No state culture institution files a farm subsidy. If this inverts, the
    // matcher has started catching something the sector does not own.
    const chit = await agri(chitalishteNameSql("name"));
    assert.ok(
      chit.eur / got.eur > 0.9,
      `читалища are ${((chit.eur / got.eur) * 100).toFixed(1)}% of the ДФЗ ` +
        `culture money; below 90% means the arm is no longer читалища-only`,
    );
  },
);

test.skipIf(skip)(
  "the Interreg thematic arm matches its measurement",
  async () => {
    const got = await interreg(interregThemeSql("o.title_en"));
    assert.ok(got.rows > 0, "no Interreg thematic rows — is interreg loaded?");
    near(got, MEASURED.interregGuarded, "interregGuarded");
  },
);

// ── 2. the guards still guard ────────────────────────────────────────────────

const guardMoves = (raw: Agg, guarded: Agg, label: string, floor: number) => {
  assert.ok(
    raw.eur > guarded.eur,
    `${label}: the exclusion list removes no money — it has stopped guarding`,
  );
  const removed = (raw.eur - guarded.eur) / raw.eur;
  assert.ok(
    removed > floor,
    `${label}: the exclusion removes only ${(removed * 100).toFixed(1)}% of the ` +
      `money, against ${(floor * 100).toFixed(1)}% when it was written`,
  );
  return removed;
};

test.skipIf(skip)("the ИСУН exclusion list CHANGES the number", async () => {
  const guarded = await isun(cultureNameSql("beneficiary_name"));
  const raw = await isun(
    cultureNameSql("beneficiary_name", { withExclusions: false }),
  );
  near(raw, MEASURED.isunUnguarded, "isunUnguarded");
  guardMoves(raw, guarded, "ИСУН", 0.1);
});

test.skipIf(skip)("the ДФЗ exclusion list CHANGES the number", async () => {
  const guarded = await agri(cultureNameSql("name"));
  const raw = await agri(cultureNameSql("name", { withExclusions: false }));
  near(raw, MEASURED.agriUnguarded, "agriUnguarded");
  guardMoves(raw, guarded, "ДФЗ", 0.08);
  assert.ok(
    raw.rows > guarded.rows * 1.5,
    "the ДФЗ crop guard no longer removes rows — `култури` is unguarded again",
  );
});

test.skipIf(skip)(
  "the Interreg exclusion list CHANGES the number",
  async () => {
    const guarded = await interreg(interregThemeSql("o.title_en"));
    const raw = await interreg(
      interregThemeSql("o.title_en", { withExclusions: false }),
    );
    near(raw, MEASURED.interregUnguarded, "interregUnguarded");
    guardMoves(raw, guarded, "Interreg", 0.05);
  },
);

test.skipIf(skip)("anchoring `art` CHANGES the Interreg number", async () => {
  const anchored = await interreg(interregThemeSql("o.title_en"));
  const bare = await interreg(
    interregThemeSql("o.title_en", { anchored: false }),
  );
  near(bare, MEASURED.interregBareArt, "interregBareArt");
  assert.ok(
    bare.eur > anchored.eur * 1.1,
    "the bare `art` substring now matches no more than the anchored form — " +
      "either the anchoring was removed or the corpus lost the Partnership rows",
  );
});

// ── 3. the named cases ───────────────────────────────────────────────────────

test.skipIf(skip)(
  "the defects that produced this file stay excluded",
  async () => {
    for (const [needle, why] of [
      ["системен оператор", "ЕСО — €189m from `опера`, the original defect"],
      ["изкуствен интелект", "`изкуств` matching artificial intelligence"],
      ["аквакултур", "`култур` matching fish farming"],
      ["агрокултур", "the `о` spelling of the crop compound"],
      ["жандармерия", "`операции` in the gendarmerie's own name"],
    ] as const) {
      const { kept, raw } = await isunAdmits(needle);
      // Both halves matter: raw > 0 proves the row is IN the corpus, so `kept = 0`
      // means excluded rather than merely absent.
      assert.ok(
        raw > 0,
        `"${needle}" is not in fund_projects at all — this case ` +
          `can no longer prove anything (${why})`,
      );
      assert.equal(kept, 0, `the matcher admitted "${needle}" (${why})`);
    }
  },
);

test.skipIf(skip)("the named true positives stay included", async () => {
  for (const [needle, why] of [
    ["Народен театър", "театър — the adjectival stem `театр` cannot match it"],
    ["куклен театър", "the most common regional theatre form"],
    ["художествена академия", "НХА — named in the plan's EIK-exact set"],
    ["ансамбъл", "the fugitive vowel, singular side"],
    ["Министерство на културата", "култур, the stem the crop guard narrows"],
    ["опера", "`\\yопера\\y` must still match a real opera house"],
    ["музе", "музей"],
    ["библиотек", "библиотека"],
    ["галери", "галерия"],
  ] as const) {
    const { kept } = await isunAdmits(needle);
    assert.ok(kept > 0, `the matcher no longer admits "${needle}" (${why})`);
  }
});

test.skipIf(skip)("the Interreg agronomy compounds stay excluded", async () => {
  const rows = await allRows<{ title_en: string }>(
    `SELECT title_en FROM interreg_operations
      WHERE ${interregThemeSql("title_en")}
        AND title_en ~* 'agricultur|aquacultur|viticultur|horticultur'`,
  );
  assert.equal(
    rows.length,
    0,
    "agronomy operations entered the culture theme: " +
      rows.map((r) => r.title_en.slice(0, 60)).join(" · "),
  );
  const [raw] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM interreg_operations
      WHERE title_en ~* 'agricultur|aquacultur|viticultur|horticultur'`,
  );
  assert.ok(
    Number(raw?.n ?? 0) > 0,
    "no agronomy operations in the corpus — this case proves nothing",
  );
});

// ── 4. agreement with the curated EIK register ───────────────────────────────

test.skipIf(skip)(
  "every curated institution with an ИСУН row is admitted",
  async () => {
    const rows = await allRows<{ beneficiary_name: string; eik: string }>(
      `SELECT DISTINCT beneficiary_name, beneficiary_eik AS eik
       FROM fund_projects
      WHERE beneficiary_eik = ANY($1)
        AND NOT ${cultureNameSql("beneficiary_name")}`,
      [[...STATE_CULTURE_INSTITUTE_EIKS]],
    );
    assert.equal(
      rows.length,
      0,
      `kulturaReferenceData.ts calls these culture and cultureMatch.ts does not — ` +
        `the two definitions disagree about named institutions: ` +
        rows.map((r) => `${r.beneficiary_name} (${r.eik})`).join(" · "),
    );
  },
);

// ── hermetic: the rendering itself, no database ──────────────────────────────

test("the SQL rendering is well-formed", () => {
  const sql = cultureNameSql("beneficiary_name");
  assert.match(
    sql,
    /^\(beneficiary_name ~\* '.+' AND beneficiary_name !~\* '.+'\)$/s,
  );
  assert.ok(sql.includes("\\yопера\\y"), "the anchoring is lost in rendering");
  assert.ok(
    !cultureNameSql("x", { withExclusions: false }).includes("!~*"),
    "withExclusions:false still rendered an exclusion",
  );
  // A qualified reference is legal; anything else is a typo, not a column.
  assert.ok(interregThemeSql("o.title_en").startsWith("(o.title_en"));
  for (const bad of ["a; DROP TABLE t", "a b", "", "1x", "a.b.c"])
    assert.throws(
      () => cultureNameSql(bad),
      /not a plain column reference/,
      bad,
    );
});

test("the unanchored forms differ from the anchored ones, and never widen", () => {
  const anchored = cultureNameSql("c");
  const bare = cultureNameSql("c", { anchored: false });
  assert.notEqual(anchored, bare, "anchored:false rendered the anchored form");
  assert.ok(bare.includes("|опера|"), "the bare `опера` spelling is missing");
  const itrgBare = interregThemeSql("c", { anchored: false });
  assert.ok(itrgBare.includes("|art|"), "the bare `art` spelling is missing");
  // An empty alternative matches every row. `\yarts\y` declares `bare: ""` and
  // must be DROPPED, never rendered as `||`.
  for (const p of [bare, itrgBare])
    assert.ok(!/\|\||~\* '\||\|'/.test(p), `empty alternative in: ${p}`);
});

test("every include term is a non-empty, compilable fragment", () => {
  for (const pattern of [CULTURE_NAME_INCLUDE, INTERREG_CULTURE_THEME_INCLUDE])
    for (const term of pattern.split("|")) {
      assert.ok(term.length > 0, `empty term in ${pattern}`);
      // JS has no \y; the PG spelling is checked by the DB tests above. Here we
      // only prove the rest of the fragment is a valid regex at all, so a typo
      // like an unclosed group fails hermetically instead of at query time.
      assert.doesNotThrow(() => new RegExp(term.replace(/\\y/g, "\\b")), term);
    }
});

test("the tolerance bands stay narrower than the guards they protect", () => {
  // If a band is as wide as its guard's effect, the FIGURE test can no longer
  // see the guard being removed — the number just moves inside its own band.
  const pairs = [
    ["ИСУН", MEASURED.isunUnguarded, MEASURED.isunGuarded],
    ["ДФЗ", MEASURED.agriUnguarded, MEASURED.agriGuarded],
    ["Interreg", MEASURED.interregUnguarded, MEASURED.interregGuarded],
    ["Interreg/art", MEASURED.interregBareArt, MEASURED.interregGuarded],
  ] as const;
  for (const [label, raw, guarded] of pairs) {
    const effect = (raw.eur - guarded.eur) / raw.eur;
    assert.ok(
      effect > TOLERANCE,
      `${label}: the guard moves the figure by ${(effect * 100).toFixed(1)}%, ` +
        `which is inside the ±${TOLERANCE * 100}% band — the figure test cannot ` +
        `see this guard being removed. Narrow TOLERANCE.`,
    );
  }
});
