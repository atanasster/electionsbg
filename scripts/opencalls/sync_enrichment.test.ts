// The never-downgrade rule, and the boundary between what this tool owns and what the crawl
// owns. No database: the rule is a comparison over two row sets, and the SQL is a string.
//
// The property under test is the one that cannot be recovered from once it is wrong. A copy that
// misses a row leaves the target stale — visible, and fixed by re-running. A copy that OVERWRITES
// a promotion destroys the only record of a human's decision: the quotes it was made from live in
// `enrichment_meta`, which is part of the same overlay and goes with it.

import { describe, expect, it } from "vitest";
import {
  CARRIED,
  PAYLOAD_COLS,
  planSync,
  outranks,
  redact,
  updateSql,
  type EnrichmentRow,
} from "./sync_enrichment";
import { MONEY_FIELDS } from "./enrich_apply";
import { ENRICHMENT_RANK } from "../db/load_open_calls_pg";

const row = (
  enrichment: string,
  over: Partial<EnrichmentRow> = {},
): EnrichmentRow => ({
  source: "isun",
  source_key: "005e2518-07ea-410b-8995-cae8ae47f351",
  enrichment,
  enrichment_meta: { quotes: { budget_eur: "…127 000 000 евро…" } },
  beneficiaries_raw: "търговци по смисъла на Търговския закон",
  budget_eur: null,
  aid_rate_pct: null,
  grant_min_eur: null,
  grant_max_eur: null,
  ...over,
});

describe("never downgrade", () => {
  it("a `reviewed` row on the TARGET survives an `auto` row in the source", () => {
    // THE central property. The target is prod; somebody read the documents against it, which is
    // what CLAUDE.md tells them to do. A local `auto` extraction of the same procedure must not
    // undo that — and it would, silently, since both rows carry the same key and the same title.
    const plan = planSync(
      [row("auto")],
      [row("reviewed", { budget_eur: 127_000_000 })],
    );
    expect(plan[0].action).toBe("preserved");
    expect(plan[0].from).toBe("reviewed");
  });

  it("…and that verdict comes from the GUARD, not from some other filter", () => {
    // The mutation. Without it the assertion above is satisfied by any plan that happens not to
    // update — including one that skipped the row because the values matched, or because a key
    // comparison was broken. Removing only the rank predicate must flip it to an update.
    const plan = planSync(
      [row("auto")],
      [row("reviewed", { budget_eur: 127_000_000 })],
      { outranks: () => false },
    );
    expect(plan[0].action).toBe("update");
    // And it would have written the flag DOWN to 'auto' over a row still holding money — which
    // 142's open_calls_money_needs_provenance CHECK rejects, aborting the run rather than the row.
    expect(plan[0].to).toBe("auto");
    expect(plan[0].changed).toContain("budget_eur");
  });

  it("preserves against every weaker provenance, in both directions of the order", () => {
    for (const [stored, incoming] of [
      ["reviewed", "auto"],
      ["reviewed", "source"],
      ["source", "auto"],
    ])
      expect(
        planSync([row(incoming)], [row(stored)])[0].action,
        `${stored} vs ${incoming}`,
      ).toBe("preserved");
  });

  it("an UPGRADE is accepted — this tool has to be able to do its job", () => {
    // The converse matters as much: a guard that preserved everything would be a no-op that
    // reported success, which is the state before this file existed.
    const plan = planSync(
      [row("reviewed", { budget_eur: 127_000_000 })],
      [row("auto", { budget_eur: null })],
    );
    expect(plan[0].action).toBe("update");
    expect(plan[0].changed).toContain("budget_eur");
  });

  it("a TIE is not a downgrade — the source wins it, as in the loader's upsert", () => {
    // `auto → auto` with a different meta is a re-gated extraction, and freezing the first one
    // forever would be its own silent staleness. Same rule as load_open_calls_pg's CASE, whose
    // ELSE arm takes the incoming value on equal rank.
    const plan = planSync(
      [row("auto", { enrichment_meta: { quotes: { budget_eur: "new" } } })],
      [row("auto")],
    );
    expect(plan[0].action).toBe("update");
    expect(plan[0].changed).toEqual(["enrichment_meta"]);
  });

  it("the order is the LOADER's, imported rather than restated", () => {
    // Three copies of „reviewed beats source" is three chances to write one backwards, and the
    // two outside a CHECK constraint fail silently.
    expect(ENRICHMENT_RANK).toEqual({
      none: 0,
      auto: 1,
      source: 2,
      reviewed: 3,
    });
    expect(outranks("reviewed", "source")).toBe(true);
    expect(outranks("source", "reviewed")).toBe(false);
    // An unknown value ranks 0 rather than throwing: it can never outrank, so a provenance this
    // build has not heard of is treated as the weakest thing it could be.
    expect(outranks("bogus", "auto")).toBe(false);
    expect(outranks("auto", "bogus")).toBe(true);
  });
});

describe("the crawl owns row existence", () => {
  it("a source row with no counterpart is reported, never turned into an insert", () => {
    const plan = planSync([row("reviewed")], []);
    expect(plan[0].action).toBe("missing");
    expect(plan[0].from).toBeNull();
  });

  it("the write statement is an UPDATE with no INSERT path at all", () => {
    const sql = updateSql();
    expect(sql).toMatch(/^UPDATE open_calls/);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bON CONFLICT\b/i);
    // …and no DELETE either: 142's central invariant is that this table never loses a row.
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});

describe("the payload is derived from the writer, not restated", () => {
  it("every money column Stage 7 can write is carried", () => {
    // The tie to `enrich_apply.MONEY_FIELDS` is the point, and it is the same tie
    // load_open_calls_pg.test.ts makes: a fifth money column added to the writer joins this
    // payload automatically instead of being enriched locally and silently left behind on prod.
    for (const c of MONEY_FIELDS)
      expect(PAYLOAD_COLS as readonly string[]).toContain(c);
  });

  it("the flag and its evidence travel with the figures", () => {
    // `enrichment` without `enrichment_meta` would publish a number whose quotes stayed behind —
    // a figure on the site with nothing to check it against, which is the one thing the Stage 7
    // gate exists to prevent.
    for (const c of ["enrichment", "enrichment_meta", "beneficiaries_raw"])
      expect(PAYLOAD_COLS as readonly string[]).toContain(c);
  });

  it("the SQL sets EVERY payload column — a partial write mixes two provenances", () => {
    const sql = updateSql();
    const set = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
    for (const c of PAYLOAD_COLS) expect(set, c).toContain(`${c} = $`);
    expect(set).toContain("enrichment_meta = $4::jsonb");
  });

  it("carries only the two provenances the loader cannot carry itself", () => {
    // 'source' is excluded because db:load:open-calls:pg:cloud already reproduces it from the
    // committed snapshot; copying it would be a second writer for a value that is not ours.
    expect([...CARRIED]).toEqual(["auto", "reviewed"]);
  });
});

describe("the write statement's guards", () => {
  const sql = updateSql().replace(/\s+/g, " ");

  it("is keyed on the FULL unique key, never source_key alone", () => {
    // `(source, source_key)` is 142's unique constraint. On source_key alone a ДФЗ row sharing a
    // key shape would take an ИСУН row's enrichment.
    expect(sql).toContain("WHERE source = $1 AND source_key = $2");
  });

  it("carries the rank guard in SQL, ranked on BOTH sides", () => {
    // Not only in planSync: the plan is computed from a read taken seconds earlier, so a
    // promotion landing on the target in between would otherwise be overwritten by a stale
    // decision. Ranking one side only would compare 3 > 'auto' — a type error in Postgres.
    expect(sql).toContain("CASE enrichment WHEN 'reviewed' THEN 3");
    expect(sql).toContain("CASE $3::text WHEN 'reviewed' THEN 3");
    expect(sql).toContain("ELSE 0 END <=");
  });

  it("RETURNS, so the caller counts writes that landed", () => {
    expect(sql).toContain("RETURNING source_key");
  });
});

describe("redact", () => {
  it("keeps the host and database, drops any password", () => {
    expect(
      redact("postgres://postgres:postgres@localhost:5433/electionsbg"),
    ).toBe("postgres://postgres@localhost:5433/electionsbg");
    expect(redact("postgres://postgres@127.0.0.1:5434/electionsbg")).toBe(
      "postgres://postgres@127.0.0.1:5434/electionsbg",
    );
  });
});
