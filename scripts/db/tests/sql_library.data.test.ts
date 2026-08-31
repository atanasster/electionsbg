// Every /db library query must RUN. A library of samples nobody executed is
// worse than no library: it teaches wrong SQL with the site's authority.
//
// Not hypothetical — 12 of the 31 entries failed on their first run, all on
// guessed column names (contractor_rank has `eik`/`division`, not
// `contractor_eik`/`cpv_division`; person_wealth_year has `net_eur`, not
// `net_worth_eur`; nzok_hospital_payments has `cumulative_eur`, not
// `amount_eur`). Two more returned zero rows, which teaches nothing.
import { describe, expect, it } from "vitest";
import { ALL_QUERIES, LIBRARY } from "../../../src/screens/dev/sqlLibrary";
import { LINKS } from "../../data_map/model";
import { getPool, pinLocalDatabase, dbReachable } from "../lib/pg";

pinLocalDatabase();

const reachable = await dbReachable();

describe.skipIf(!reachable)("/db query library", () => {
  it("has a distinct label for every query", () => {
    const labels = ALL_QUERIES.map((q) => q.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every query a plain-language question it answers", () => {
    const weak = ALL_QUERIES.filter(
      (q) => q.answers.trim().length < 20 || /^select /i.test(q.answers),
    ).map((q) => q.label);
    expect(weak).toEqual([]);
  });

  it("bounds every query", () => {
    // The console caps rows itself, but an unbounded aggregate still scans;
    // open_calls_list's NULL limit means UNBOUNDED, which is the trap.
    const unbounded = ALL_QUERIES.filter((q) => {
      // Strip the leading comment block first — several entries open with the
      // trap they document, so an anchored match never reached the SQL.
      const body = q.sql
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join(" ")
        .trim();
      if (/\bLIMIT\b/i.test(body)) return false;
      // A bare function call is bounded by the function itself: it either takes
      // a limit argument or returns a fixed shape.
      return !/\bFROM\s+\w+\s*\(/i.test(body);
    }).map((q) => q.label);
    expect(unbounded).toEqual([]);
  });

  it.each(ALL_QUERIES.map((q) => [q.purpose, q.label, q.sql] as const))(
    "%s — %s runs and returns rows",
    async (_purpose, _label, sql) => {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        // The same 8s ceiling the console applies, so a query that would time
        // out for a visitor fails here instead.
        await client.query("SELECT set_config('statement_timeout','8s',true)");
        const r = await client.query(sql);
        const last = Array.isArray(r) ? r[r.length - 1] : r;
        // A sample that returns nothing teaches nothing — it reads as "no such
        // data" rather than "this is how you ask".
        expect(last.rowCount ?? 0).toBeGreaterThan(0);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
    20_000,
  );
});

describe.skipIf(!reachable)("the documented traps are load-bearing", () => {
  // "Every query runs and returns rows" cannot see a query that dropped its
  // guard — a review removed the trap from five entries and all five still
  // passed. These compare the guarded answer against the unguarded one and
  // fail if they agree, which is only true while the guard is doing work.
  const differs = async (guarded: string, unguarded: string) => {
    const pool = getPool();
    const one = async (sql: string) => {
      const r = await pool.query<{ v: string }>(sql);
      return String(r.rows[0]?.v ?? "");
    };
    const [a, b] = [await one(guarded), await one(unguarded)];
    expect(a).not.toBe(b);
    return [a, b];
  };

  it("tag = 'contract' changes the contractor total", async () => {
    // Amendments carry their own rows; summing all tags double-counts them.
    await differs(
      `SELECT ROUND(SUM(amount_eur))::text AS v FROM contracts WHERE tag = 'contract'`,
      `SELECT ROUND(SUM(amount_eur))::text AS v FROM contracts`,
    );
  });

  it("superseded_by IS NULL changes the roll-call item count", async () => {
    // ~10% of items are re-votes the chamber took twice.
    await differs(
      `SELECT count(*)::text AS v FROM vote_item WHERE superseded_by IS NULL`,
      `SELECT count(*)::text AS v FROM vote_item`,
    );
  });

  it("division = 'ALL' changes the contractor leaderboard", async () => {
    // Without the sentinel a contractor appears once per CPV division.
    await differs(
      `SELECT count(*)::text AS v FROM contractor_rank WHERE scope_key = 'all' AND division = 'ALL'`,
      `SELECT count(*)::text AS v FROM contractor_rank WHERE scope_key = 'all'`,
    );
  });

  it("interreg_eur is INSIDE public_money_eur, not beside it", async () => {
    // The library comment says adding the two double-counts; prove the overlap
    // is real rather than trusting the prose.
    const r = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM company_public_money
        WHERE interreg_eur > 0 AND public_money_eur >= interreg_eur`,
    );
    expect(Number(r.rows[0].n)).toBeGreaterThan(0);
  });
});

describe("library shape (no database needed)", () => {
  it("gives every query a stable, unique id", () => {
    // `/db?q=<id>` is a shareable URL and the map links to it, so an id that
    // churns breaks a published link.
    const ids = ALL_QUERIES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((i) => !/^[a-z0-9-]+$/.test(i))).toEqual([]);
  });

  it("only ONE query claims each link", () => {
    // build_manifest resolves with .find(), so a second claim on the same link
    // is silently dropped — and the one dropped was the query that actually
    // spanned both corpora.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const q of ALL_QUERIES.filter((x) => x.walks)) {
      const { a, b, key } = q.walks!;
      const [x, y] = [a, b].sort();
      const k = `${x}|${y}|${key}`;
      if (seen.has(k)) dupes.push(`${k}: ${seen.get(k)} and ${q.id}`);
      else seen.set(k, q.id);
    }
    expect(dupes).toEqual([]);
  });

  it("actually WALKS the link it claims", () => {
    // The first cut tagged 9 queries and not one touched both sides of its
    // link — "who owns a company" was tagged connections↔procurement while
    // reading only tr_owner_share for a single hardcoded EIK. The gate checked
    // that the LINK existed, which every wrong tag also satisfies. This checks
    // the query mentions both of the link's measured tables.
    const bad: string[] = [];
    for (const q of ALL_QUERIES.filter((x) => x.walks)) {
      const { a, b, key } = q.walks!;
      const [x, y] = [a, b].sort();
      const link = LINKS.find(
        (l) => l.a === x && l.b === y && (l.key ?? "boundary") === key,
      );
      if (!link?.measure) continue; // a boundary link has no tables to touch
      for (const ref of [link.measure.left, link.measure.right]) {
        const tbl = ref.split(".")[0];
        if (!new RegExp(`\\b${tbl}\\b`, "i").test(q.sql))
          bad.push(`${q.id} does not read ${tbl}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("only claims to walk links that exist", () => {
    // A `walks` tag naming no declared link would render a dead "run this
    // query" affordance — or worse, silently none, which is how it would go
    // unnoticed.
    const declared = new Set(
      LINKS.map((l) => `${l.a}|${l.b}|${l.key ?? "boundary"}`),
    );
    const bogus = ALL_QUERIES.filter((q) => q.walks).filter((q) => {
      const { a, b, key } = q.walks!;
      const [x, y] = [a, b].sort();
      return !declared.has(`${x}|${y}|${key}`);
    });
    expect(bogus.map((q) => q.id)).toEqual([]);
  });

  it("covers the corpora the console previously ignored", () => {
    // The old 10 samples were Contracts / Tenders / Registry / Search only.
    const purposes = LIBRARY.map((g) => g.purpose)
      .join(" ")
      .toLowerCase();
    for (const topic of [
      "interreg",
      "health",
      "eu money",
      "parliament",
      "places",
    ])
      expect(purposes).toContain(topic);
  });
});
