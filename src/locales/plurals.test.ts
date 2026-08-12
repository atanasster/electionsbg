// Every `t(key, { count })` call site must RESOLVE through i18next — parity is not enough.
//
// parity.test.ts asserts bg and en carry the same key set, which is the right guard for a
// missing key but blind to a malformed plural family. i18next composes `key_one` / `key_other`
// by CLDR category, so a pair misnamed the SAME way in both bundles (`_1`/`_2`,
// `_singular`/`_plural`, or `_other` present with `_one` missing) passes parity, passes any
// component test that mocks `t`, and renders the bare identifier on the page at a 200 — the
// exact failure parity.test.ts's own header describes, one level down.
//
// DRIVEN FROM THE CALL SITES, not from the bundle's key shapes, and that is the whole design.
// Neither suffix identifies a plural family on its own, measured against the real bundle:
//
//   • 6 keys END in `_one` and are not plurals — `support_no_one` ("Не подкрепям никого"),
//     `company_geo_lead_one` (a variant beside `_conc`/`_spread`), `contract_annexes_one`
//     (beside `_several`), `company_related_owner_one` (beside `_many`),
//     `concentration_contract_one` and `watchlist_contract_one`. Every one is called by its
//     FULL literal key, so i18next's plural machinery is never involved and demanding an
//     `_other` for them would be wrong.
//   • 11 keys end in `_other` and are enum labels, not plurals — `municipal_role_other`,
//     `ngo_type_other`, `pp_decl_type_other` ("Друга"), and so on.
//
// A heuristic over key names therefore produces 17 false positives before it finds a real
// defect. What is unambiguous is a call that passes `count`: that call, and only that call,
// asks i18next to pluralise, so scanning source for it gives the exact set to verify.
//
// bg and en are both CLDR one/other languages, so `_one` + `_other` is the complete set for
// each; a language with more categories (ru, ar) would need its own expectation here.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import i18next, { type i18n as I18n } from "i18next";
import bg from "./bg/translation.json";
import en from "./en/translation.json";

const SRC = path.join(process.cwd(), "src");

const BUNDLES = [
  ["bg", bg],
  ["en", en],
] as const;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

/** Keys called as `t("key", { … count … })` — i.e. the calls that ask i18next to pluralise.
 *  Template-literal and variable keys are out of reach of a static scan and are not claimed
 *  to be covered; see the count assertion below, which keeps this from silently finding none. */
const pluralCallSites = (): string[] => {
  const re = /\bt\(\s*["']([a-z0-9_]+)["']\s*,\s*\{[^}]*\bcount\b/gi;
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    const code = fs.readFileSync(file, "utf8");
    for (const m of code.matchAll(re)) found.add(m[1]);
  }
  return [...found].sort();
};

const instanceFor = async (
  lng: string,
  resource: Record<string, unknown>,
): Promise<I18n> => {
  const inst = i18next.createInstance();
  await inst.init({
    resources: { [lng]: { translation: resource } },
    lng,
    fallbackLng: lng,
    interpolation: { escapeValue: false },
  });
  return inst;
};

describe("plural call sites resolve through i18next", () => {
  const sites = pluralCallSites();

  test("the scan finds the call sites at all", () => {
    // A regex that quietly matched nothing would make every test below vacuous.
    assert.ok(
      sites.length > 30,
      `expected the codebase's plural call sites, found ${sites.length}`,
    );
    assert.ok(sites.includes("mp_assets_show_more"));
    assert.ok(sites.includes("pp_in_contracts"));
  });

  for (const [lng, bundle] of BUNDLES) {
    const res = bundle as unknown as Record<string, unknown>;

    test(`${lng}: every plural call site renders a real string at count 1 and 3`, async () => {
      const inst = await instanceFor(lng, res);
      const broken: { key: string; count: number; got: string }[] = [];
      for (const key of sites) {
        // A key the bundle does not carry at all is parity.test.ts's business, and it has
        // its own inline-default story; this test is about families that exist but cannot
        // be composed.
        if (!(`${key}_one` in res) && !(`${key}_other` in res) && !(key in res))
          continue;
        for (const count of [1, 3]) {
          const out = inst.t(key, { count });
          if (out === key || out.trim() === "")
            broken.push({ key, count, got: out });
        }
      }
      assert.deepEqual(
        broken,
        [],
        `${lng}: plural call sites that returned the bare key`,
      );
    });
  }

  test("the check discriminates — a misnamed family is caught", async () => {
    const inst = await instanceFor("en", {
      broken_singular: "one thing",
      broken_plural: "{{count}} things",
    });
    assert.equal(inst.t("broken", { count: 3 }), "broken");
  });

  test("the count reaches the string, in both languages", async () => {
    // The half of T1.2 that a key-existence check cannot see: `+{n} {t(key)}` also
    // "resolved" — it just put the number outside the phrase, in the wrong place for
    // Bulgarian. Assert the rendered label actually carries the number.
    for (const [lng, bundle] of BUNDLES) {
      const inst = await instanceFor(lng, bundle as Record<string, unknown>);
      const out = inst.t("mp_assets_show_more", { count: 3 });
      assert.match(
        out,
        /3/,
        `${lng} mp_assets_show_more dropped {{count}}: ${out}`,
      );
    }
  });

  test("bg renders the expected forms for the T1.2 label", async () => {
    // Pinned verbatim because the singular/plural distinction here is a real Bulgarian
    // agreement (позиция / позиции), not a mechanical suffix — a translator editing one
    // form and not the other is the likely regression.
    const inst = await instanceFor(
      "bg",
      bg as unknown as Record<string, unknown>,
    );
    assert.equal(
      inst.t("mp_assets_show_more", { count: 1 }),
      "Покажи още 1 позиция",
    );
    assert.equal(
      inst.t("mp_assets_show_more", { count: 3 }),
      "Покажи още 3 позиции",
    );
  });
});
