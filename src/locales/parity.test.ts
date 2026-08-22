// The two locale bundles must carry the SAME key set.
//
// i18next has no loud failure mode for a missing key: `t("nsh_tile_votes")` renders the
// literal string "nsh_tile_votes" at a 200, so an English page ships raw identifiers where
// its labels should be and nothing — not the typecheck, not the build, not a smoke test —
// says so. The bundles are edited by hand and by generator scripts, in both directions, so
// "we added it to both" is a convention rather than a guarantee.
//
// This is deliberately a PARITY check, not a "every key is used" check: plenty of keys are
// referenced dynamically (`t(tile.titleKey)`), so unreferenced-key detection would need a
// resolver and would produce false positives. Parity needs neither and catches the failure
// that actually ships.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LOCALE_BUNDLES } from "./bundles";
import { bgCorpus as bg, enCorpus as en } from "./allKeys";

/** The corpus is authored as ONE namespace and only PARTITIONED across files —
 *  core plus one per deferred bundle. Parity is a property of the UNION, so
 *  every assertion below reads allKeys; the per-file split has its own
 *  assertion. */
const FILES = ["translation", ...LOCALE_BUNDLES];
const readFile = (lang: "bg" | "en", file: string): Record<string, string> =>
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "src/locales", lang, `${file}.json`),
      "utf8",
    ),
  );

const keys = (bundle: Record<string, unknown>) => new Set(Object.keys(bundle));

describe("locale bundles", () => {
  // The union is only a corpus if the files PARTITION it. A key present in both
  // translation.json and budget.json would resolve from whichever merged last —
  // so the two copies could disagree and nothing would say which one shipped.
  // The splitter writes each key to exactly one file; this is what keeps a
  // hand-edit from undoing that.
  test("each key lives in exactly one file, in both languages", () => {
    for (const lang of ["bg", "en"] as const) {
      const seen = new Map<string, string>();
      const duplicated: string[] = [];
      for (const file of FILES) {
        for (const key of Object.keys(readFile(lang, file))) {
          const prev = seen.get(key);
          if (prev) duplicated.push(`${key} (${prev} + ${file})`);
          else seen.set(key, file);
        }
      }
      assert.deepEqual(duplicated, [], `${lang}: keys in two corpus files`);
    }
  });

  // Same file set on both sides. A bundle file that exists in bg/ and not in
  // en/ makes every one of its keys render as its own identifier in English,
  // which the key-set parity below cannot see: loadCorpus would simply not find
  // the file and the two unions would look equal.
  test("both languages carry the same corpus files", () => {
    for (const file of FILES) {
      for (const lang of ["bg", "en"] as const) {
        const p = path.join(process.cwd(), "src/locales", lang, `${file}.json`);
        assert.ok(fs.existsSync(p), `${p} is missing`);
      }
    }
  });

  test("bg and en carry the same keys", () => {
    const bgKeys = keys(bg as Record<string, unknown>);
    const enKeys = keys(en as Record<string, unknown>);

    const missingInEn = [...bgKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInBg = [...enKeys].filter((k) => !bgKeys.has(k)).sort();

    // Reported together and in full: fixing one at a time across a 5,500-key bundle is how
    // the second half gets forgotten.
    assert.deepEqual(
      { missingInEn, missingInBg },
      { missingInEn: [], missingInBg: [] },
      "the locale bundles have drifted apart",
    );
  });

  test("bg and en interpolate the same variables, none of them reserved", () => {
    // Two failure modes, both silent and both demonstrated by this repo:
    //
    //   1. A variable named after an i18next OPTION is never interpolated — it is consumed
    //      as configuration. `t("…", { ns: 44 })` threw "namespaces.forEach is not a
    //      function" and rendered nothing, because `ns` selects a namespace.
    //   2. BG and EN drifting apart on placeholders: one bundle renders the number, the
    //      other prints a sentence with a hole in it. Key-set parity above cannot see
    //      inside the values.
    const RESERVED = new Set([
      "ns",
      "lng",
      "lngs",
      "count",
      "context",
      "defaultValue",
      "replace",
      "keySeparator",
      "nsSeparator",
      "interpolation",
      "parseMissingKeyHandler",
    ]);
    const vars = (s: string) =>
      [...s.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]).sort();

    // Keys whose bundles legitimately interpolate DIFFERENT variables, because the two
    // languages need different material from the same call. Each was checked at its call
    // site; all three supply every variable both bundles use.
    //
    //   company_conn_check_degree — the call passes `degree` AND `ord`; Bulgarian needs the
    //     ordinalised form („на 3-та степен"), English takes the bare number.
    //   budget_executed_sofar     — the call passes `year`; BG says „за 2026 г.", EN just
    //     "so far", which reads better without it.
    //   nsh_feed_sub_dissent_one  — English bakes the count into the singular ("…once"),
    //     Bulgarian states it („1 път").
    //
    // Deliberately a short list with reasons rather than a relaxed rule: a variable in one
    // bundle and not the other is normally a sentence rendering with a hole in it.
    const DRIFT_OK = new Set([
      "company_conn_check_degree",
      "budget_executed_sofar",
      "nsh_feed_sub_dissent_one",
    ]);

    const bgB = bg as Record<string, unknown>;
    const enB = en as Record<string, unknown>;
    const drift: string[] = [];
    const staleAllowance: string[] = [];
    const reserved: string[] = [];
    let checked = 0;
    for (const [k, bv] of Object.entries(bgB)) {
      const ev = enB[k];
      if (typeof bv !== "string" || typeof ev !== "string") continue;
      const bvVars = vars(bv);
      if (bvVars.length === 0 && vars(ev).length === 0) continue;
      checked += 1;
      const differs = bvVars.join("|") !== vars(ev).join("|");
      if (differs && !DRIFT_OK.has(k)) drift.push(k);
      // An allowance that no longer describes a real difference is worse than no allowance:
      // it silently covers whatever that key becomes next.
      if (!differs && DRIFT_OK.has(k)) staleAllowance.push(k);
      for (const v of bvVars) if (RESERVED.has(v)) reserved.push(`${k}: ${v}`);
    }
    // `count` is i18next's plural selector and IS legitimately interpolated, so it must be
    // exempt or every plural key trips this.
    assert.deepEqual(
      reserved.filter((r) => !r.endsWith(": count")),
      [],
      "keys using a reserved i18next option as an interpolation variable",
    );
    assert.deepEqual(drift, [], "bg/en interpolation drift");
    assert.deepEqual(
      staleAllowance,
      [],
      "DRIFT_OK entries whose bundles no longer differ — remove them",
    );
    // Non-vacuity: a regex that matched nothing would pass every assertion above.
    assert.ok(checked > 50, `expected many interpolated keys, saw ${checked}`);
    assert.ok(vars("a {{x}} b {{ y }}").join() === "x,y", "the scanner works");
  });

  test("no key holds an empty string in either bundle", () => {
    // An empty value is worse than a missing one: `t()` returns "" rather than falling back
    // to the key or the inline default, so the label silently disappears from the page.
    for (const [lang, bundle] of [
      ["bg", bg],
      ["en", en],
    ] as const) {
      const empty = Object.entries(bundle as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v.trim() === "")
        .map(([k]) => k);
      assert.deepEqual(empty, [], `${lang} has empty values`);
    }
  });
});
