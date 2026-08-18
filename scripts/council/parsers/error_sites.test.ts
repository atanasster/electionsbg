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
//
// The same optionality bit a second time, one axis over. Five parsers wrap
// download AND extraction in one try/catch and stamped the lot `fetch` —
// but a body that is not a readable .docx/.odt is `content`: the bytes are
// already in hand, so re-fetching yields the same failure. PER32 sat at
// sinceDate 2025-10-16 for weeks re-writing 271 unchanged resolutions on
// every run because protokol №13's href serves a Word 97-2003 .doc. So a
// catch that covers an office-container extractor must ask
// `isMalformedArchiveError(err)`, and the scanner below reads BOTH arms of
// such a site rather than the first `kind:` literal it happens to see.

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
  /** The whole `errors.push({…})` call, for gates that read the expression. */
  body: string;
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
      // BOTH arms of the kind expression, not just a bare literal. A
      // conditional site — `kind: isMalformedArchiveError(err) ? "content"
      // : "fetch"` — has to satisfy the rules for each arm it can produce.
      //
      // A `kind: "(\w+)"` scan does NOT merely read the first arm of such a
      // site: it matches nothing at all, so the site drops out of the scan
      // and its `fetch` arm silently stops being covered by the date rule.
      // That is the same shape of hole this file exists to close, so the
      // pattern deliberately spans the ternary rather than the literal.
      const m = /kind:\s*[^,"]*?"(\w+)"(?:\s*:\s*"(\w+)")?/.exec(body);
      if (!m) continue;
      const kinds = [...new Set([m[1], m[2]].filter(Boolean) as string[])];
      for (const kind of kinds) {
        out.push({
          file,
          line: i + 1,
          kind,
          url: (/url: ([^,]+),/.exec(body)?.[1] ?? "?").trim(),
          hasDate: /\bdate: /.test(body),
          body,
        });
      }
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

// Every reader in lib/docx.ts that can raise MalformedArchiveError. A parser
// calling one of these has, by construction, a call site that can fail on
// unusable BYTES rather than on the download.
//
// `extractWordText` is the router parsers should use and the other three are
// its parts, but all four are listed rather than just the router: a parser
// reaching past it — which is what fed an OLE2 file to the OOXML reader for a
// month — must still classify its failure, and dropping off this list is not
// a way to be exempt from that.
const CONTAINER_EXTRACTORS = [
  "extractWordText",
  "extractDocxText",
  "extractOdtText",
  "convertDocToText",
];

describe("office-container failures are content, not fetch", () => {
  const files = readdirSync(PARSER_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  const sources = new Map(
    files.map((f) => [f, readFileSync(join(PARSER_DIR, f), "utf8")] as const),
  );
  const users = files.filter((f) =>
    CONTAINER_EXTRACTORS.some((fn) =>
      new RegExp(`\\b${fn}\\(`).test(sources.get(f)!),
    ),
  );

  it("finds the parsers that extract from an office container", () => {
    // per32, rse, pvn, raz26, hkv09. A sixth arriving must be classified
    // too, which is what makes the assertion below worth running.
    expect(users.length).toBeGreaterThanOrEqual(5);
  });

  it.each(users.map((f) => [f] as const))(
    "%s classifies a malformed archive as content",
    (file) => {
      const sites = readSites().filter(
        (s) => s.file === file && s.kind === "fetch",
      );
      // The per-protocol catch is the one that wraps the extractor. At
      // least one `fetch` site in the file must route through the
      // predicate — otherwise an unreadable document caps the watermark
      // and the município re-writes its whole window every run.
      const classified = sites.filter((s) =>
        s.body.includes("isMalformedArchiveError"),
      );
      expect(classified.length).toBeGreaterThan(0);
      // And that site's other arm must be `content`, not something else.
      for (const s of classified) {
        expect(s.body).toMatch(
          /isMalformedArchiveError\(err\)\s*\?\s*"content"\s*:\s*"fetch"/,
        );
      }
    },
  );

  it("never resolves the predicate to a kind the watermark treats differently", () => {
    // `enrich` would drop the protocol off the ledger entirely, and
    // `discovery` would freeze the whole município — both worse than the
    // bug this replaced.
    for (const s of readSites()) {
      if (!s.body.includes("isMalformedArchiveError")) continue;
      expect(["content", "fetch"]).toContain(s.kind);
    }
  });
});
