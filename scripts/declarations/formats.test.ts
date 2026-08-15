// Guards the committed on-disk JSON format of the declarations pipeline's
// artifacts. Both halves matter and they fail differently.
//
// The FORMAT half is the acceptance test for the churn this file exists to
// end: a refresh that reformats an artifact produces a ~million-line no-op
// diff which buries the handful of real value changes and re-uploads the
// trees that ship. Measured 2026-08-15: `--declarations` pretty-printed the
// parliament family (892k whitespace insertions), `--declarations --prod`
// flipped company_links.json to compact (928k whitespace deletions), and no
// invocation produced a clean diff.
//
// The STRUCTURAL half is what keeps it fixed. The cause was one `stringify`
// threaded from main.ts into every builder while the artifacts need two
// different formats, so it could not be right for both at once. Each builder
// now owns its format and takes no formatter argument — re-adding one
// reopens the defect, and the format assertions below cannot catch it on a
// checkout whose artifacts happen to be committed correctly.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { compactJson, prettyJson } from "./formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const DATA = path.join(REPO, "data");

/** Single-line: exactly one line, no indented keys. */
const isCompact = (s: string): boolean =>
  !s.replace(/\n$/, "").includes("\n") && !/^\s+"/m.test(s);

/** 2-space indent: at least one key indented by exactly two spaces. */
const isPretty = (s: string): boolean => /\n {2}"/.test(s);

const COMPACT_FILES = [
  "parliament/companies-index.json",
  "parliament/assets-rankings.json",
  "parliament/assets-rankings-top.json",
  "parliament/car-makes.json",
  "parliament/mp-cars.json",
  "parliament/data-provenance.json",
];

const COMPACT_DIRS = ["parliament/declarations", "parliament/mp-assets"];

const PRETTY_FILES = ["officials/derived/company_links.json"];

describe("declarations artifact formats", () => {
  it("emits the two formats the committed artifacts use", () => {
    expect(compactJson({ a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    // The rebuild runners historically wrote `JSON.stringify(o, null, 0)`.
    // compactJson must stay byte-identical to it or re-pointing them at the
    // shared constant would itself have been a reformat.
    const sample = { a: 1, b: [2, { c: "x" }] };
    expect(compactJson(sample)).toBe(JSON.stringify(sample, null, 0));
  });

  for (const rel of COMPACT_FILES) {
    it(`${rel} is compact`, () => {
      const p = path.join(DATA, rel);
      if (!fs.existsSync(p)) return; // fresh clone / not yet built
      expect(isCompact(fs.readFileSync(p, "utf-8"))).toBe(true);
    });
  }

  for (const rel of COMPACT_DIRS) {
    it(`every file in ${rel}/ is compact`, () => {
      const dir = path.join(DATA, rel);
      if (!fs.existsSync(dir)) return;
      const bad: string[] = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        if (!isCompact(fs.readFileSync(path.join(dir, f), "utf-8"))) {
          bad.push(f);
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }

  for (const rel of PRETTY_FILES) {
    it(`${rel} is pretty (2-space)`, () => {
      const p = path.join(DATA, rel);
      if (!fs.existsSync(p)) return;
      expect(isPretty(fs.readFileSync(p, "utf-8"))).toBe(true);
    });
  }

  it("no declarations builder takes a stringify argument", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else if (e.name.endsWith(".ts") && e.name !== "formats.test.ts") {
          const src = fs.readFileSync(full, "utf-8");
          // A `stringify:` object member — the parameter shape that was
          // threaded. Bare `JSON.stringify(...)` calls are unaffected.
          if (/(^|[^.\w])stringify\s*:/.test(src)) {
            offenders.push(path.relative(REPO, full));
          }
        }
      }
    };
    walk(__dirname);
    expect(offenders).toEqual([]);
  });

  it("main.ts does not thread its --prod formatter into declarations", () => {
    const src = fs.readFileSync(path.join(REPO, "scripts/main.ts"), "utf-8");
    const call = src.match(/parseFinancialDeclarations\(\{[\s\S]*?\}\)/)?.[0];
    expect(call).toBeTruthy();
    expect(call).not.toContain("stringify");
  });
});
