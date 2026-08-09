// The upsert's column rules — the boundary between what a CRAWL owns and what ENRICHMENT owns.
//
// This file exists because getting that boundary wrong is invisible. Measured 2026-08-09: with
// `beneficiaries_raw` in SOURCE_OWNED, one ordinary `db:load:open-calls:pg` took a promoted row
// from its eligibility text to NULL while leaving `enrichment='reviewed'` and the quotes sitting
// in `enrichment_meta` — a row asserting that a human signed off on text that is no longer
// there, with 66 → 66 rows and nothing red anywhere.
//
// No database needed: the rules are data, and the SQL is a string.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FILL_NEVER_BLANK,
  SOURCE_OWNED,
  upsertSql,
} from "./load_open_calls_pg";
import { MONEY_FIELDS } from "../opencalls/enrich_apply";

/** Everything the Stage 7 writer can put in a column. Derived from the writer, not restated. */
const ENRICHMENT_WRITTEN = [...MONEY_FIELDS, "beneficiaries_raw"];

describe("open_calls upsert — crawl vs enrichment ownership", () => {
  it("no enrichment-written column is SOURCE_OWNED", () => {
    // The tie to `enrich_apply.MONEY_FIELDS` is the point: adding a fifth money column to the
    // writer without protecting it here turns this red instead of silently blanking it daily.
    for (const c of ENRICHMENT_WRITTEN)
      expect(SOURCE_OWNED as readonly string[]).not.toContain(c);
  });

  it("every enrichment-written column is fill-never-blank", () => {
    for (const c of ENRICHMENT_WRITTEN)
      expect(FILL_NEVER_BLANK as readonly string[]).toContain(c);
  });

  it("fill-never-blank columns use COALESCE(EXCLUDED, stored) — never a bare assignment", () => {
    const sql = upsertSql();
    for (const c of FILL_NEVER_BLANK) {
      expect(sql, c).toContain(
        `${c} = COALESCE(EXCLUDED.${c}, open_calls.${c})`,
      );
      // The bare form is what the generic upsert would emit, and it is the defect.
      expect(sql, c).not.toContain(`${c} = EXCLUDED.${c},`);
    }
  });

  it("source-owned columns ARE bare assignments — a crawl is authoritative for them", () => {
    // The converse matters too: COALESCE-ing a title would freeze the first one ИСУН ever
    // published, so the protection must not spread.
    const sql = upsertSql();
    for (const c of SOURCE_OWNED)
      expect(sql, c).toContain(`${c} = EXCLUDED.${c}`);
  });

  it("`audience` stays source-owned — ИСУН derives it from the title at crawl time", () => {
    // And the Stage 7 writer deliberately never touches it: overwriting a source-derived facet
    // value with an unreviewed inference would be a downgrade disguised as an enrichment.
    expect(SOURCE_OWNED as readonly string[]).toContain("audience");
    expect(FILL_NEVER_BLANK as readonly string[]).not.toContain("audience");
  });

  it("the enrichment rule is a TOTAL ORDER over all four values", () => {
    // Not a name list. Both earlier drafts guarded a subset and read as correct:
    // `IN ('reviewed','source')` let 'auto' fall back to 'none'; `EXCLUDED = 'none'` then left
    // `reviewed → source` (a silent downgrade) and `reviewed → auto` (which sets 'auto' on a row
    // that still holds money, and 142's CHECK aborts the WHOLE load, not the row).
    const sql = upsertSql().replace(/\s+/g, " ");
    for (const v of [
      "'reviewed' THEN 3",
      "'source' THEN 2",
      "'auto' THEN 1",
      "ELSE 0",
    ])
      expect(sql, v).toContain(v);
  });

  it("the rank is applied to BOTH sides of the comparison", () => {
    // Ranking only the stored side would compare 3 > 'source' — a type error in Postgres, and
    // in a looser dialect a comparison that always went one way.
    const sql = upsertSql().replace(/\s+/g, " ");
    expect(sql).toContain("CASE open_calls.enrichment WHEN 'reviewed' THEN 3");
    expect(sql).toContain("CASE EXCLUDED.enrichment WHEN 'reviewed' THEN 3");
  });

  it("the truth table: preserve on a downgrade, accept on an upgrade", () => {
    // Re-derived from the same expression the SQL uses, so this table cannot drift from it.
    const RANK: Record<string, number> = {
      none: 0,
      auto: 1,
      source: 2,
      reviewed: 3,
    };
    const result = (stored: string, incoming: string) =>
      RANK[stored] > RANK[incoming] ? stored : incoming;

    // Nothing is ever lowered by a crawl that reports no provenance of its own.
    for (const stored of ["auto", "source", "reviewed"])
      expect(result(stored, "none"), stored).toBe(stored);
    // A human's sign-off outranks everything, including a source that starts publishing figures.
    for (const incoming of ["none", "auto", "source"])
      expect(result("reviewed", incoming), incoming).toBe("reviewed");
    // …but a crawl CAN raise a row: this is what lets money ever be filled from the source.
    expect(result("none", "source")).toBe("source");
    expect(result("auto", "source")).toBe("source");
  });

  it("the LOADER contains no DELETE — 142's central invariant", () => {
    // Asserted against the loader's own source, not against `upsertSql()`: an INSERT builder
    // could never emit a DELETE, so checking it there proved nothing. A call that CLOSES stops
    // being listed by the crawl, so an anti-join delete would erase precisely the closed calls
    // that make base rates, „затвори наскоро" and the archive possible.
    const src = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "load_open_calls_pg.ts",
      ),
      "utf8",
    );
    // Strip comments — the header explains at length why there is no DELETE.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Matched as SQL STATEMENT FORMS, not as English words: the shrink guard's own error message
    // says „this loader must never delete", and a check that trips on its own warning is a check
    // nobody keeps.
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?\w/i);
    expect(code).not.toMatch(/\bUSING\s+\w+\s+WHERE\b/i); // the anti-join delete's tail
    // And the merge really is the upsert form.
    expect(upsertSql()).toContain(
      "ON CONFLICT (source, source_key) DO UPDATE SET",
    );
  });
});
