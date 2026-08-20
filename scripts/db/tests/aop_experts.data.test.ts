// Gate for the АОП external-experts register (migration 174, plan P4).
//
// The thing most worth protecting here is the REFUSAL. The register publishes two
// names where `person` holds three, so a link is made on a weaker key than
// anything else in this repo joins on — and naming the wrong individual as a
// state-approved procurement expert is a claim about a real person. Two of these
// tests exist only to prove the refusal still discriminates.

import { describe, expect, it } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM aop_expert",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
// A DISTINCT skip reason per state: „no database" and „the register is not loaded"
// must never read as „the refusal is enforced".
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "aop_expert is empty — run npm run db:load:aop-experts:pg"
    : null;
const d = skip ? describe.skip : describe;
if (skip) console.warn(`aop_experts.data.test: skipped — ${skip}`);

d("aop_expert (174)", () => {
  it("is loaded", async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM aop_expert",
    );
    expect(Number(r.n)).toBeGreaterThan(50);
  });

  it("agrees with its own coverage row", async () => {
    // The coverage row is what every surface quotes instead of inferring the window
    // from whatever rows it happens to hold. If the two disagree, the quoted window
    // describes a different corpus than the one being shown.
    const [r] = await allRows<{ rows: string; declared: string }>(
      `SELECT (SELECT count(*) FROM aop_expert)::text rows,
              (SELECT expert_count FROM aop_expert_coverage WHERE id=1)::text declared`,
    );
    expect(r.rows).toBe(r.declared);
  });

  it("is HISTORICAL — the corpus carries no currently-valid expert", async () => {
    // Not a brittle assertion about a number: it is the claim the whole dataset's
    // copy rests on. If АОП ever reopens the register this fails, and it SHOULD —
    // every present-tense caveat in 174 and CLAUDE.md would then need rewriting.
    const [r] = await allRows<{ cur: string; latest: string }>(
      `SELECT count(*) FILTER (WHERE is_current)::text cur,
              max(valid_until)::text latest FROM aop_expert_table`,
    );
    expect(Number(r.cur)).toBe(0);
    expect(r.latest < new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("never returns an expert linked to more than one person", async () => {
    const rows = await allRows<{ une: string; n: string }>(
      `SELECT une, count(DISTINCT person_id)::text n
         FROM aop_expert_person_links() GROUP BY une HAVING count(DISTINCT person_id) > 1`,
    );
    expect(rows).toEqual([]);
  });

  it("REFUSES a real, non-trivial number of shared names", async () => {
    // Non-vacuity. If `refused_ambiguous` were 0 the previous test would pass
    // against an implementation that simply matched nothing — and the refusal
    // would be untested rather than working.
    const [s] = await allRows<{
      experts: number;
      matched_any: number;
      unambiguous: number;
      refused_ambiguous: number;
    }>("SELECT * FROM aop_expert_link_stats()");
    expect(s.refused_ambiguous).toBeGreaterThan(5);
    expect(s.unambiguous).toBeGreaterThan(0);
    expect(s.unambiguous + s.refused_ambiguous).toBe(s.matched_any);
  });

  it("the refusal DISCRIMINATES — dropping it would admit more experts", async () => {
    // Mutation check: the same query without the `HAVING count(DISTINCT …) = 1`
    // guard must return strictly more experts. Without this, a guard that had
    // silently stopped filtering would pass every assertion above.
    const [r] = await allRows<{ guarded: string; unguarded: string }>(
      `WITH cand AS (
         SELECT e.une, p.person_id FROM aop_expert e
           JOIN person p ON p.given_fold=e.given_fold AND p.family_fold=e.family_fold
          WHERE e.given_fold IS NOT NULL AND p.status='active')
       SELECT (SELECT count(DISTINCT une) FROM aop_expert_person_links())::text guarded,
              (SELECT count(DISTINCT une) FROM cand)::text unguarded`,
    );
    expect(Number(r.unguarded)).toBeGreaterThan(Number(r.guarded));
  });

  it("keeps validity at the (expert, area) grain, not on the expert", async () => {
    // The register admits an expert to a second area later, with its own window.
    // Storing one pair per expert publishes one of two true answers, chosen by
    // crawl order. This asserts the finer grain still exists AND still varies —
    // without the second clause the test passes on a table that flattened it.
    const [r] = await allRows<{
      pairs: string;
      experts: string;
      varying: string;
    }>(
      `SELECT (SELECT count(*) FROM aop_expert_area)::text pairs,
              (SELECT count(*) FROM aop_expert)::text experts,
              (SELECT count(*) FROM (
                 SELECT une FROM aop_expert_area
                  GROUP BY une
                 HAVING count(DISTINCT (valid_from, valid_until)) > 1) z)::text varying_n`,
    );
    expect(Number(r.pairs)).toBeGreaterThan(Number(r.experts));
    expect(Number(r.varying_n)).toBeGreaterThan(0);
  });

  it("the expert-level window is the UNION of its areas', never one of them", async () => {
    const rows = await allRows<{ une: string }>(
      `SELECT e.une FROM aop_expert e
         JOIN (SELECT une, min(valid_from) f, max(valid_until) u
                 FROM aop_expert_area GROUP BY une) a USING (une)
        WHERE e.valid_from IS DISTINCT FROM a.f OR e.valid_until IS DISTINCT FROM a.u`,
    );
    expect(rows).toEqual([]);
  });

  it("every folded name is Latin — a Cyrillic fold can never match `person`", async () => {
    // person.given_fold is transliterated. A fold left in Cyrillic does not error;
    // it silently matches nothing, which reads as „this expert is not a public
    // figure" rather than as a broken join.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM aop_expert
        WHERE given_fold ~ '[а-яА-Я]' OR family_fold ~ '[а-яА-Я]'`,
    );
    expect(r.n).toBe("0");
  });
});

await end();
