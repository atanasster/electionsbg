// Gate for the comdos.bg ДС decision corpus (migration 203,
// docs/plans/comdos-ds-ingest-v1.md). Three things are worth protecting:
//   - the database is a lossless load of the COMMITTED corpus;
//   - the plan's §4 rules are structural, not conventions: no recruiter/handler
//     name anywhere, and the named rows are not readable by the serving role;
//   - a decision with no document carries UNKNOWN counts, never zero findings.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allRows, dbReachable } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { OFFICER_LABEL } from "../../comdos/parse";

const DATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/comdos",
);

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

d("ds_decision / ds_announcement (203)", () => {
  it("is a lossless load of the committed corpus", async () => {
    const decisions = JSON.parse(
      fs.readFileSync(path.join(DATA, "decisions.json"), "utf8"),
    ) as {
      hasDocument: boolean;
      checked: number | null;
      deceased: number;
      persons: number;
    }[];
    const persons = fs
      .readFileSync(path.join(DATA, "persons.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean).length;
    const [r] = await allRows<{
      decisions: string;
      checked: string;
      deceased: string;
      announced: string;
    }>(
      `SELECT (SELECT count(*) FROM ds_decision)::text decisions,
              (SELECT coalesce(sum(checked), 0) FROM ds_decision)::text checked,
              (SELECT coalesce(sum(deceased), 0) FROM ds_decision)::text deceased,
              (SELECT count(*) FROM ds_announcement)::text announced`,
    );
    expect(Number(r.decisions)).toBe(decisions.length);
    expect(Number(r.checked)).toBe(
      decisions.reduce((s, x) => s + (x.checked ?? 0), 0),
    );
    expect(Number(r.deceased)).toBe(
      decisions.reduce((s, x) => s + x.deceased, 0),
    );
    // Upsert-only, so the table may hold MORE than the corpus (a decision the
    // site stopped listing) — never fewer.
    expect(Number(r.announced)).toBeGreaterThanOrEqual(persons);
  });

  it("stores no recruiting or handling officer (plan §4 rule 4)", async () => {
    const cols = await allRows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ds_announcement'`,
    );
    expect(
      cols.filter((c) =>
        /recruit(?!_year)|handler|officer/.test(c.column_name),
      ),
    ).toEqual([]);
    // …and no stored text carries an officer label either — the write guard's
    // own definition, over every text column.
    const rows = await allRows<{ t: string }>(
      `SELECT concat_ws(' ', name, birth_place, quality_raw, pseudonyms, structures,
                        office, party, mir, array_to_string(categories, ' '),
                        array_to_string(prior_decisions, ' ')) t
         FROM ds_announcement`,
    );
    expect(rows.filter((r) => OFFICER_LABEL.test(r.t)).length).toBe(0);
  });

  it("is not readable by the serving role (plan §4 rule 2)", async () => {
    const [role] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM pg_roles WHERE rolname = 'app_readonly'",
    );
    if (role.n === "0") return; // nothing to grant to on a virgin volume
    // ds_decision too: the чл. 28 decisions are titled with a person's name
    const rows = await allRows<{ t: string; ok: boolean }>(
      `SELECT t, has_table_privilege('app_readonly', t, 'SELECT') ok
         FROM unnest(ARRAY['ds_decision', 'ds_announcement']) t`,
    );
    expect(rows.filter((r) => r.ok).map((r) => r.t)).toEqual([]);
  });

  it("never reads a decision with no document as „announced nobody“", async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM ds_decision
        WHERE NOT has_document
          AND (person_count IS NOT NULL OR deceased IS NOT NULL OR checked IS NOT NULL)`,
    );
    expect(Number(r.n)).toBe(0);
    const [a] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM ds_announcement a
         JOIN ds_decision d USING (decision_id) WHERE NOT d.has_document`,
    );
    expect(Number(a.n)).toBe(0);
  });

  it("links every re-disclosure to the decision it cites", async () => {
    const [r] = await allRows<{ already: string; linked: string }>(
      `SELECT count(*)::text already,
              count(*) FILTER (WHERE cardinality(prior_decisions) > 0)::text linked
         FROM ds_announcement WHERE section = 'already'`,
    );
    expect(Number(r.already)).toBeGreaterThan(0);
    expect(Number(r.linked) / Number(r.already)).toBeGreaterThan(0.9);
  });
});
