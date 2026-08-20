// A model id must be written down exactly once — in `gemini_models.ts`.
//
// The failure this prevents is not an outage; it is DRIFT. Before this gate the id
// was a bare literal in 29 files and the repo ran three flash versions at once,
// with nothing able to notice. A bump then means finding all 29, and the one you
// miss keeps working — it just quietly runs an older model on a subset of the
// corpus, which no row count and no test can see.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GEMINI_MODELS } from "./gemini_models";

const ROOT = path.resolve(__dirname, "../..");
const MODULE = path.join("scripts", "lib", "gemini_models.ts");
const DIRS = ["scripts", "ai", "functions", "src", "vite", "video"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);

/** Strings that look like a model id and are not one. `gemini-api` is a PROVIDER
 *  label in a union type (`source: "cloud-live" | "gemini-api" | …`), not something
 *  you can pass to the SDK. */
const NOT_A_MODEL = new Set(["gemini-api"]);

const sources = (): { file: string; text: string }[] => {
  const out: { file: string; text: string }[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(p);
      } else if (EXT.has(path.extname(e.name))) {
        out.push({
          file: path.relative(ROOT, p),
          text: fs.readFileSync(p, "utf8"),
        });
      }
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
};

describe("gemini model ids live in exactly one place", () => {
  const files = sources();

  it("is scanning a real tree (non-vacuity)", () => {
    // Without this, a broken walk would make every assertion below pass trivially.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.file === MODULE)).toBe(true);
    expect(GEMINI_MODELS.length).toBeGreaterThanOrEqual(5);
  });

  it("no source file pins a known model id inline", () => {
    const offenders: string[] = [];
    for (const { file, text } of files) {
      if (file === MODULE) continue;
      for (const m of GEMINI_MODELS)
        if (text.includes(`"${m}"`) || text.includes(`'${m}'`))
          offenders.push(`${file} → ${m}`);
    }
    expect(
      offenders,
      "import the constant from scripts/lib/gemini_models instead — a bare literal " +
        "is invisible to the next model bump, and the one you miss keeps working",
    ).toEqual([]);
  });

  it("no source file pins an UNKNOWN gemini id inline either", () => {
    // The arm above only sees ids we already know. This one catches a NEW model
    // pinned inline — which is how the drift started, not how it was noticed.
    const offenders: string[] = [];
    const re = /["'](gemini-[a-z0-9.-]+)["']/g;
    for (const { file, text } of files) {
      if (file === MODULE) continue;
      for (const m of text.matchAll(re)) {
        const id = m[1];
        if (NOT_A_MODEL.has(id)) continue;
        if ((GEMINI_MODELS as readonly string[]).includes(id)) continue; // arm above owns it
        offenders.push(`${file} → ${id}`);
      }
    }
    expect(
      offenders,
      "a gemini id not declared in gemini_models.ts — add it there as a named " +
        "constant (and to GEMINI_MODELS), or to NOT_A_MODEL if it is not a model",
    ).toEqual([]);
  });

  it("GEMINI_MODELS lists every exported id — the list cannot rot", () => {
    // A constant missing from the array is exempt from both arms above, silently.
    const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
    const exported = [
      ...src.matchAll(/export const GEMINI_[A-Z_]+ = "([^"]+)";/g),
    ].map((m) => m[1]);
    expect(exported.length).toBeGreaterThanOrEqual(5);
    expect([...exported].sort()).toEqual([...GEMINI_MODELS].sort());
  });
});
