// A source-level gate on the one convention the watermark rests on.
//
// `MuniScrapeError.kind` is a required discriminated union, so the
// compiler now forces every call site to classify itself — but `date` is
// optional on three of the four variants, and it has to be: some parsers
// only learn a sitting date from inside the document, so a download
// failure genuinely precedes it.
//
// That optionality is exactly where the defect lived. `rse`, `pvn` and
// `raz26` shipped per-protocol failures with no date, which makes the
// orchestrator freeze the whole município's watermark instead of capping
// it at the failure — every daily run then re-walks the entire window
// behind one flaky download, and the report names "an un-enumerated
// index" for what was a protocol. Nothing was red.
//
// So: a `fetch` site inside a per-protocol loop must supply a date, and
// any that genuinely cannot must say so here, by name, with a reason.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PARSER_DIR = join(process.cwd(), "scripts/council/parsers");

/**
 * The `kind: "fetch"` sites that legitimately cannot name a date, each
 * with why. Adding a line here is a deliberate act: it says "this
 * município's watermark freezes rather than caps on this failure", which
 * is correct but coarse, and should be a last resort.
 *
 * Deliberately EMPTY. Ruse, Pleven and Разград all looked like they
 * belonged here — none of them knows the sitting date at the top of the
 * loop — but in every case the date is in scope by the time the failure
 * that matters happens, and hoisting a `let` was enough. That is the
 * usual answer; reach for an exemption only after trying it.
 *
 * The property being present is what is checked, not that it is defined
 * at runtime: `date: sittingDate` where `sittingDate` is still undefined
 * passes, and correctly so — the site has done everything it can, and the
 * orchestrator handles the undefined case by freezing.
 */
const UNDATED_FETCH_ALLOWLIST: Record<string, string> = {};

type Site = {
  file: string;
  line: number;
  kind: string;
  url: string;
  hasDate: boolean;
};

const readSites = (): Site[] => {
  const out: Site[] = [];
  for (const file of readdirSync(PARSER_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  )) {
    const lines = readFileSync(join(PARSER_DIR, file), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Both shapes: `errors.push({…})` and the early-return `errors: [{…}]`.
      if (!/errors\.push\(\{|errors: \[/.test(lines[i])) continue;
      let depth = 0;
      let j = i;
      for (; j < lines.length; j++) {
        depth += (lines[j].match(/[[{]/g) ?? []).length;
        depth -= (lines[j].match(/[\]}]/g) ?? []).length;
        if (j > i && depth <= 0) break;
      }
      const body = lines.slice(i, j + 1).join(" ");
      const kind = /kind: "(\w+)"/.exec(body)?.[1];
      if (!kind) continue;
      out.push({
        file,
        line: i + 1,
        kind,
        url: (/url: ([^,]+),/.exec(body)?.[1] ?? "?").trim(),
        hasDate: /\bdate: /.test(body),
      });
    }
  }
  return out;
};

describe("MuniScrapeError call sites", () => {
  const sites = readSites();

  it("finds them all — the gate is worthless if the scan silently misses", () => {
    // 16 parsers, every one of which reports at least a discovery failure
    // and a per-protocol one.
    expect(sites.length).toBeGreaterThan(40);
    const files = new Set(sites.map((s) => s.file));
    expect(files.size).toBeGreaterThanOrEqual(16);
  });

  it("uses only the four declared kinds", () => {
    const bad = sites.filter(
      (s) => !["discovery", "fetch", "content", "enrich"].includes(s.kind),
    );
    expect(bad).toEqual([]);
  });

  it("never dates a discovery step", () => {
    // `date?: never` on that variant makes this a compile error too; the
    // gate states the intent where a reader will look for it.
    const dated = sites.filter((s) => s.kind === "discovery" && s.hasDate);
    expect(dated).toEqual([]);
  });

  it("carries a date on every fetch failure outside the allowlist", () => {
    const undated = sites
      .filter((s) => s.kind === "fetch" && !s.hasDate)
      .map((s) => `${s.file}:${s.url}`)
      .filter((k) => !(k in UNDATED_FETCH_ALLOWLIST));
    expect(undated).toEqual([]);
  });

  it("keeps the allowlist honest — no entry for a site that now has a date", () => {
    // A stale exemption is how the convention quietly stops being enforced.
    const undated = new Set(
      sites
        .filter((s) => s.kind === "fetch" && !s.hasDate)
        .map((s) => `${s.file}:${s.url}`),
    );
    const stale = Object.keys(UNDATED_FETCH_ALLOWLIST).filter(
      (k) => !undated.has(k),
    );
    expect(stale).toEqual([]);
  });
});
