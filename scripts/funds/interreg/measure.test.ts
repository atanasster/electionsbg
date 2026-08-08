import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const FILE = path.join(HERE, "measure.ts");
const src = readFileSync(FILE, "utf8");
/** The file with comments stripped. The header PROSE says "there is no
 *  --apply", so a naive substring search on the whole file finds the very
 *  sentence promising the opposite — the assertion has to read code. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
  .join("\n");

// The defining property of this file, and the reason it can be pointed at
// PRODUCTION through the Cloud SQL proxy without a second thought. A harness
// that could write is a migration wearing a measurement's name.
describe("measure.ts is read-only", () => {
  it("contains no write path", () => {
    // Not a proof — a determined edit can always route around a grep — but it
    // catches the realistic case: someone adds "while I'm here, let me just
    // fix the one row I found".
    for (const forbidden of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bCREATE\s+(TABLE|MATERIALIZED|INDEX)\b/i,
      /\bREFRESH\s+MATERIALIZED\b/i,
      /\bDROP\b/i,
      /\bALTER\s+(TABLE|MATERIALIZED)\b/i,
      /\bGRANT\b/i,
      /\bCOPY\s+\w+.*\bFROM\b/i,
      /\bSELECT\b[\s\S]{0,200}?\bINTO\s+\w/i,
      /writeFileSync|createWriteStream|\.write\(/,
    ])
      expect(code, `forbidden construct ${forbidden}`).not.toMatch(forbidden);
  });

  it("offers no --apply flag", () => {
    // The sibling harnesses in scripts/procurement/ all take --apply, so its
    // ABSENCE here is a deliberate difference rather than an oversight, and a
    // future copy-paste is the way it would arrive.
    expect(code).not.toContain("--apply");
  });

  it("imports the real reader rather than re-implementing it", () => {
    // The whole argument for a committed harness: measure_cross_source.ts's
    // header records that the procurement plan's first draft measured a
    // LOOKALIKE helper and was wrong. Re-reading the corpus here by hand would
    // reintroduce exactly that.
    expect(src).toMatch(/import \{ readCorpus \} from "\.\/corpus"/);
    expect(src).toMatch(/from "\.\/types"/);
  });
});

describe("measure.ts CLI", () => {
  const run = (
    args: string[],
    env: Record<string, string> = {},
  ): { status: number; out: string } => {
    try {
      const out = execFileSync("npx", ["tsx", FILE, ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      return { status: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return {
        status: err.status ?? 1,
        out: `${err.stdout ?? ""}${err.stderr ?? ""}`,
      };
    }
  };

  // A mistyped flag must not silently print the OTHER source's numbers under
  // the requested heading. crawl.ts uses argv.includes() and does silently
  // ignore unknown flags, which is how a fake `--probe` reached the skill docs.
  it("refuses an unknown flag instead of ignoring it", () => {
    const r = run(["--sourse=pg"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("unknown flag");
  }, 60_000);

  it("rejects the flag pair that would measure nothing", () => {
    // §6 needs the LOADED corpus and fund_payloads; --source=corpus has
    // neither. Accepting it exits 0 with an empty report, which reads as
    // "measured, nothing to say".
    const r = run(["--source=corpus", "--ranking-delta"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("measures nothing");
  }, 60_000);

  // A skipped section must be visible to the MACHINE consumer too — --json is
  // the run-to-run diff the header advertises, and without a marker a skipped
  // run is byte-identical to --source=corpus.
  it("marks skipped sections in --json", () => {
    const r = run(["--json"], {
      DATABASE_URL: "postgres://postgres:postgres@localhost:59999/nope",
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.out) as { skipped?: { sections: string[] } };
    expect(parsed.skipped?.sections).toEqual(["§3.2", "§6", "T4"]);
  }, 120_000);

  // The section this proves is the one a fresh clone can still answer: the
  // committed corpus needs no database, because place resolution — and only
  // place resolution — lives in the loader.
  it("measures the committed corpus with no database", () => {
    const r = run(["--source=corpus", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(["§5", "§3.1", "§7", "§1"]),
    );
    // …and does NOT claim the placement sections, which it cannot answer.
    expect(Object.keys(parsed)).not.toContain("§3.2");
    expect(Object.keys(parsed)).not.toContain("§6");
    const five = parsed["§5"] as {
      bgPartnerRows: number;
      byPeriod: Record<string, { withEik: number }>;
    };
    expect(five.bgPartnerRows).toBeGreaterThan(1_200);
    // The Tier L ceiling, re-derived rather than asserted from the plan's prose.
    expect(five.byPeriod["2014-2020"].withEik).toBe(0);
  }, 120_000);
});
