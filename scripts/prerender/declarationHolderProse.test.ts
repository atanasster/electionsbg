// A declaration's asset tables name a HOLDER — „Собственик или титуляр на правото" — and
// never a relationship. The holder can be a spouse, a person in de-facto cohabitation, or a
// minor child, and nothing in the corpus distinguishes them (see `isSpouseHolder` in
// src/lib/declarations.ts). Copy that says a net worth sums „декларант + съпруг", or that a
// car is „spouse-held", therefore asserts a family relationship about a named public figure
// on the strength of two names differing.
//
// That phrasing was retired across the SPA (11e9185d50) and the assets prerender routes
// (8f702520ab), and BOTH sweeps missed /mp-cars — the page the defect was found on. Its
// prerendered <meta> kept „(или съпруг)" while the SPA footer said the opposite, and its
// body copy documented a column label („притежател „съпруг“") that had not rendered since
// 723aa6c1. Each commit closed the half the other left open, and nothing failed.
//
// This is the gate for that class. It follows `reportRevoice.test.ts` next door: prose is
// not type-checked, so it gets a behavioural test that reads the real route table.
//
// ⚠️ PHRASE-SCOPED, NOT WORD-SCOPED — this is the whole design. Table 12 (доходи) really
// does carry a spouse column („На съпруга/та, лицето при факт. съжителство на съпружески
// начала"), so income copy quoting the form must keep the word. A blanket ban on „съпруг" /
// "spouse" would fail on exactly the strings the sweep deliberately preserved. The income
// keys are allowlisted BY NAME so that removing one is a deliberate act rather than a
// silent widening of the ban.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { prerenderRoutes } from "./routes";
import bg from "../../src/locales/bg/translation.json";
import en from "../../src/locales/en/translation.json";

/** Keys whose subject is Table 12 income, where the register itself distinguishes the
 *  spouse. These quote the form; they are not inferences. */
const INCOME_KEYS = new Set([
  "mp_income_spouse",
  "pp_cohort_income_peers",
  "pp_gap_caveat_sources",
]);

/** Claims an asset table cannot support: a family relationship, or the „притежател =
 *  съпруг" labelling no surface renders any more. */
const BANNED: RegExp[] = [
  // Any „деклар…" tied to a „съпруг" inside ONE sentence. Deliberately not a `+`-only
  // pattern: the first draft of this gate matched „декларант + съпруг" and sailed past
  // „Сумирани притежания на деклариращия и неговия/нейния съпруг(а)" — the prose form,
  // which is the one the sweep actually had to fix. A same-sentence window is the real
  // shape of the claim; the punctuation between them is incidental.
  /деклар[а-я]*[^.!?]{0,60}съпруг/i,
  /declar[a-z]*[^.!?]{0,60}spouse/i,
  // The two forms that name no declarant at all.
  /\(\s*или съпруг/i,
  /\(\s*or spouse\s*\)/i,
  // A rendering rule no surface implements since 723aa6c1.
  /притежател\s*[„"]?\s*съпруг/i,
  /spouse-held/i,
  /holder\s*=\s*spouse/i,
];

/** Copy that names a spouse only to say the declaration does NOT establish the
 *  relationship is the correct copy — it is what the sweep replaced the claims WITH:
 *  „…(съпруг/а, лице при фактическо съжителство или ненавършило пълнолетие дете —
 *  декларацията не уточнява кое)". So the ban is on ASSERTING a relationship, and an
 *  explicit disclaimer in the same string lifts it. Without this the gate fails on its
 *  own remedy, which is how a prose rule ends up being deleted rather than obeyed. */
const DISCLAIMS = [
  /не уточнява/i,
  /не посочва/i,
  /не казва/i,
  /does not (say|state|specify)/i,
  /never the relationship/i,
  /not the relationship/i,
];

const offend = (text: string): RegExp | null => {
  if (DISCLAIMS.some((re) => re.test(text))) return null;
  return BANNED.find((re) => re.test(text)) ?? null;
};

describe("declared-asset copy never asserts a family relationship", () => {
  test("prerender route copy, both languages", () => {
    const bad: string[] = [];
    for (const r of prerenderRoutes) {
      const variants = [r, (r as { english?: unknown }).english].filter(
        Boolean,
      ) as { title?: string; description?: string; bodyHtml?: string }[];
      for (const v of variants) {
        const text = `${v.title ?? ""}\n${v.description ?? ""}\n${v.bodyHtml ?? ""}`;
        const re = offend(text);
        if (re) bad.push(`${(r as { path?: string }).path ?? "?"} — ${re}`);
      }
    }
    assert.deepEqual(
      bad,
      [],
      `prerender copy asserts a relationship:\n${bad.join("\n")}`,
    );
  });

  test("both locale corpora, excluding the table-12 income keys", () => {
    const bad: string[] = [];
    for (const [lang, corpus] of [
      ["bg", bg],
      ["en", en],
    ] as const) {
      for (const [key, value] of Object.entries(
        corpus as Record<string, unknown>,
      )) {
        if (INCOME_KEYS.has(key) || typeof value !== "string") continue;
        const re = offend(value);
        if (re) bad.push(`${lang}.${key} — ${re}`);
      }
    }
    assert.deepEqual(
      bad,
      [],
      `locale copy asserts a relationship:\n${bad.join("\n")}`,
    );
  });

  // The house mutation check: a gate that matches nothing passes on any tree.
  test("the patterns match the phrasing they retired, and spare the income copy", () => {
    for (const retired of [
      "(declarant + spouse, minus debts)",
      "Spouse-held cars are listed with holder = spouse.",
      "деклариран от действащ депутат (или съпруг), от последната",
      "се показват с притежател „съпруг“",
      "Чисто имущество в €, деклариращ + съпруг(а)",
      // The prose forms the first draft of this gate missed entirely.
      "Сумирани притежания на деклариращия и неговия/нейния съпруг(а).",
      "Combined declarant and spouse holdings; source: Court of Audit.",
      "(на деклариращия и съпруга/съпругата) минус декларираните задължения",
    ]) {
      assert.ok(offend(retired), `should have been caught: ${retired}`);
    }
    // …and must NOT fire on copy that names the possibilities in order to DISCLAIM them.
    // These are the exact replacements the sweep shipped.
    for (const remedy of [
      "Сумирани притежания на деклариращия и на останалите титуляри, посочени в декларацията му (съпруг/а, лице при фактическо съжителство или ненавършило пълнолетие дете — декларацията не уточнява кое).",
      "Combined holdings of the declarant and of the other holders named in their declaration (a spouse, a cohabiting partner or a minor child — the declaration does not say which).",
    ]) {
      assert.equal(
        offend(remedy),
        null,
        `remedy wrongly banned: ${remedy.slice(0, 50)}`,
      );
    }

    // The table-12 income keys survive for a DIFFERENT reason — the register itself makes
    // that distinction — and they are exempt BY KEY, not by pattern. Stated explicitly so
    // the two exemptions are not confused: this one genuinely trips the patterns.
    assert.ok(
      offend((bg as Record<string, string>)["pp_cohort_income_peers"]),
      "expected the income caveat to trip the patterns and be spared by INCOME_KEYS",
    );
    assert.equal(
      offend((bg as Record<string, string>)["pp_gap_caveat_sources"]),
      null,
    );
  });
});
