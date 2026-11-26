// Gate for the pitay.government.bg ЗДОИ corpus (migration 207, insait-gap-v1 §3).
//
// The thing most worth protecting is PRIVACY: the requester is a type, never a
// person, and contacts the platform printed (early pages) or a body quoted back
// must not reach a table. Then that the search and coverage functions answer from
// the same rows the table holds.

import { describe, expect, it } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM zdoi_request",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "zdoi_request is empty — run pnpm run zdoi:fetch, then pnpm run db:load:zdoi:pg"
    : null;
const d = skip ? describe.skip : describe;
reportSkip(import.meta.url, skip);
// The two INSAIT arms need application 8905, which a partial crawl may not have reached.
const has8905 =
  !skip &&
  (
    await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM zdoi_request WHERE app_id = 8905",
    )
  )[0].n !== "0";
const it8905 = it.skipIf(!has8905);

d("zdoi_request (207)", () => {
  it("stores the requester only as one of the two types, or not at all", async () => {
    const rows = await allRows<{ applicant_type: string | null; n: string }>(
      "SELECT applicant_type, count(*)::text n FROM zdoi_request GROUP BY 1",
    );
    for (const r of rows)
      expect([null, "Физическо лице", "Юридическо лице"]).toContain(
        r.applicant_type,
      );
  });

  it("holds no e-mail address or mobile number in the stored texts", async () => {
    // A bare domain („@sofia.bg") is not a contact and is allowed; an address with a
    // local part is.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM zdoi_request
        WHERE (subject || ' ' || coalesce(decision_text, ''))
              ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'
           OR (subject || ' ' || coalesce(decision_text, ''))
              ~ '(\\+359|\\m0)\\s?8[789]([\\s/-]?[0-9]){7}\\M'`,
    );
    expect(Number(r.n)).toBe(0);
  });

  it("coverage counts the same rows the table holds", async () => {
    const [r] = await allRows<{ rows: string; cov: string }>(
      `SELECT (SELECT count(*) FROM zdoi_request)::text rows,
              (SELECT requests FROM zdoi_coverage())::text cov`,
    );
    expect(r.cov).toBe(r.rows);
  });

  it8905(
    "search finds the INSAIT request a reader pointed us at (8905 loaded)",
    async () => {
      const hits = await allRows<{ app_id: number }>(
        "SELECT app_id FROM zdoi_search('INSAIT', 50)",
      );
      expect(hits.map((h) => h.app_id)).toContain(8905);
      // …and a Latin-typed query reaches the same Cyrillic text through the fold.
      const latin = await allRows<{ app_id: number }>(
        "SELECT app_id FROM zdoi_search('izchislitelen tsentar', 50)",
      );
      expect(latin.map((h) => h.app_id)).toContain(8905);
    },
  );

  it8905(
    "the mentions arm is whole-word, where the search is a prefix match",
    async () => {
      const ids = async (sql: string) =>
        (await allRows<{ app_id: number }>(sql)).map((r) => r.app_id);
      expect(
        await ids("SELECT app_id FROM zdoi_mentions('INSAIT', 50)"),
      ).toContain(8905);
      // „insa" is a prefix of „insait": the FTS arm takes it, the word check must not.
      expect(
        await ids("SELECT app_id FROM zdoi_search('insa', 100)"),
      ).toContain(8905);
      expect(
        await ids("SELECT app_id FROM zdoi_mentions('insa', 100)"),
      ).not.toContain(8905);
    },
  );

  it("every event and forward belongs to a stored request", async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT (
         (SELECT count(*) FROM zdoi_event e
           WHERE NOT EXISTS (SELECT 1 FROM zdoi_request r WHERE r.app_id = e.app_id))
       + (SELECT count(*) FROM zdoi_forward f
           WHERE NOT EXISTS (SELECT 1 FROM zdoi_request r WHERE r.app_id = f.app_id))
       )::text n`,
    );
    expect(Number(r.n)).toBe(0);
  });

  // The amounts an answer names are quoted, so a wrong cut publishes a sum the answer
  // never wrote: „000 лв." from „500 000 лв.", „00 лв." from „5850, 00 лв.".
  it("quotes whole amounts, each inside its own excerpt", async () => {
    const rows = await allRows<{ amount: string; excerpt: string }>(
      `SELECT x->>'amount' AS amount, x->>'excerpt' AS excerpt
         FROM zdoi_request, jsonb_array_elements(zdoi_money_mentions(decision_text, 9)) x`,
    );
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows.every((r) => r.excerpt.includes(r.amount))).toBe(true);
    // a leading zero followed by a digit is a cut number — the one survivor is the
    // source's own typo („ЗОО 000 евро", Cyrillic З and О for 300)
    const cut = rows.filter((r) => /^0[0-9]/.test(r.amount));
    expect(cut.length).toBeLessThanOrEqual(1);
    expect(
      rows.some((r) => /^евро[а-я]/i.test(r.amount.split(/\s/).pop() ?? "")),
    ).toBe(false);
  });

  it8905(
    "finds the 100 млн. лв. in the INSAIT answer — with the question it restates",
    async () => {
      const [r] = await allRows<{ m: { amount: string; excerpt: string }[] }>(
        "SELECT money_mentions AS m FROM zdoi_mentions('INSAIT', 20) WHERE app_id = 8905",
      );
      expect(r.m[0].amount).toBe("100 млн. лв.");
      expect(r.m[0].excerpt).toMatch(/За какво конкретно е предвидено/);
    },
  );
});

await end();
