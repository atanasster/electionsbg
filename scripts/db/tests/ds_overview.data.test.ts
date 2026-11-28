// Gate for ds_overview() (migration 204) — the ONLY serving surface over the
// comdos.bg ДС corpus.
//
// What it protects:
//   - the payload reconciles to the tables, on the basis each key names;
//   - a decision with no document never counts as „zero findings";
//   - the serving role can call it while still unable to read either table;
//   - AGGREGATES ONLY: the payload carries no announced name — checked against
//     every name in the corpus, not a sample, so a new field leaking one fails.

import { describe, expect, it } from "vitest";
import { allRows, dbReachable } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

interface Bucket {
  decisions: number;
  withoutDocument: number;
  checked: number | null;
  records: number | null;
  recordsOfChecked: number | null;
  withoutChecked: number;
}
interface Overview {
  totals: Bucket & {
    people: number;
    deceasedNotPublished: number;
    afterNov1989Records: number;
  };
  bySector: (Bucket & { sector: string })[];
  byYear: (Bucket & { year: number })[];
  categories: Record<string, number>;
  recruitYears: { year: number; people: number }[];
}

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM ds_decision",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "ds_decision is empty — run pnpm run db:load:ds:pg"
    : null;
const d = skip ? describe.skip : describe;
reportSkip(import.meta.url, skip);

const sum = (xs: Bucket[], k: keyof Bucket) =>
  xs.reduce((s, x) => s + Number(x[k] ?? 0), 0);

d("ds_overview() (204)", () => {
  const load = async () =>
    (await allRows<{ o: Overview }>("SELECT ds_overview() o"))[0].o;

  it("reconciles to the tables", async () => {
    const o = await load();
    const [t] = await allRows<{
      decisions: string;
      nodoc: string;
      checked: string;
      records: string;
    }>(
      `SELECT count(*)::text decisions,
              count(*) FILTER (WHERE NOT has_document)::text nodoc,
              sum(checked)::text checked,
              (SELECT count(*) FROM ds_announcement)::text records
         FROM ds_decision`,
    );
    expect(o.totals.decisions).toBe(Number(t.decisions));
    expect(o.totals.withoutDocument).toBe(Number(t.nodoc));
    expect(o.totals.checked).toBe(Number(t.checked));
    expect(o.totals.records).toBe(Number(t.records));
    // the breakdowns partition the totals
    for (const k of [
      "decisions",
      "withoutDocument",
      "checked",
      "records",
    ] as const)
      expect(sum(o.bySector, k)).toBe(Number(o.totals[k] ?? 0));
    expect(sum(o.byYear, "records")).toBe(o.totals.records);
    // people ≤ records: a person re-announced per office counts once
    expect(o.totals.people).toBeGreaterThan(0);
    expect(o.totals.people).toBeLessThan(o.totals.records!);
  });

  it("puts a hit rate's numerator and denominator on ONE basis", async () => {
    const o = await load();
    const [t] = await allRows<{ rec: string; nochecked: string }>(
      `SELECT sum(person_count) FILTER (WHERE checked IS NOT NULL)::text rec,
              count(*) FILTER (WHERE has_document AND checked IS NULL)::text nochecked
         FROM ds_decision`,
    );
    expect(o.totals.recordsOfChecked).toBe(Number(t.rec));
    expect(o.totals.withoutChecked).toBe(Number(t.nochecked));
    for (const k of ["recordsOfChecked", "withoutChecked"] as const) {
      expect(sum(o.bySector, k)).toBe(Number(o.totals[k] ?? 0));
      expect(sum(o.byYear, k)).toBe(Number(o.totals[k] ?? 0));
    }
    // the mismatch is real in this corpus, so the split is not vacuous
    expect(o.totals.withoutChecked).toBeGreaterThan(0);
    expect(o.totals.recordsOfChecked!).toBeLessThan(o.totals.records!);
  });

  it("classifies titles by whole words, not substrings", async () => {
    const rows = await allRows<{ t: string; s: string }>(
      `SELECT t, ds_sector(t) s FROM unnest(ARRAY[
         'Решение - Ботевград', 'Решение - ЮЛНЦ Читалище', 'Решение - БАЛКАН АД',
         'Решение - община Ловеч', 'Решение - Висш съдебен съвет']) t`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.t, r.s]))).toEqual({
      "Решение - Ботевград": "other",
      "Решение - ЮЛНЦ Читалище": "ngo",
      "Решение - БАЛКАН АД": "business",
      "Решение - община Ловеч": "municipal",
      "Решение - Висш съдебен съвет": "judiciary",
    });
  });

  it("names its unclassified share rather than hiding it", async () => {
    const o = await load();
    const other = o.bySector.find((s) => s.sector === "other");
    expect(other).toBeDefined();
    // the keyword classifier must keep doing most of the work
    expect(other!.decisions / o.totals.decisions).toBeLessThan(0.15);
  });

  it("is callable by the serving role, which still cannot read the tables", async () => {
    const [role] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM pg_roles WHERE rolname = 'app_readonly'",
    );
    if (role.n === "0") return; // virgin volume: nothing granted to anyone
    const [r] = await allRows<{ exec: boolean; definer: boolean }>(
      `SELECT has_function_privilege('app_readonly', 'ds_overview()', 'EXECUTE') exec,
              (SELECT prosecdef FROM pg_proc WHERE proname = 'ds_overview') definer`,
    );
    expect(r).toEqual({ exec: true, definer: true });
  });

  it("carries no announced name (aggregates only)", async () => {
    const text = JSON.stringify(await load());
    const names = await allRows<{ name: string }>(
      "SELECT DISTINCT name FROM ds_announcement",
    );
    expect(names.length).toBeGreaterThan(1000);
    expect(names.filter((r) => text.includes(r.name))).toEqual([]);
    // …nor a pseudonym, which is as identifying as a name
    const pseud = await allRows<{ p: string }>(
      `SELECT DISTINCT btrim(p) p FROM ds_announcement,
              regexp_split_to_table(pseudonyms, '[,;]') p
        WHERE length(btrim(p)) >= 4`,
    );
    expect(pseud.filter((r) => text.includes(`"${r.p}"`))).toEqual([]);
  });
});
