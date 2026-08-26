// Unit tests for the CR Deeds → company_persons projection. The invariant under
// test is the ADDITIVE merge: CR rows fill the owner gap without disturbing the
// daily feed's history rows. No PG (upsertFoundingDates is covered in the Step-6
// regression test); a temp state.sqlite + a temp CR store per test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { CrDeedsStore } from "./cr_deeds_store";
import {
  projectCrDeedsToState,
  deedToPersonRows,
  eligibleFounding,
  foundingChunkSql,
  foundingDatesFromStore,
  type FoundingAnswer,
} from "./project_cr_deeds";
import { parseCrDeed } from "./parse_cr_deeds";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "cr_deeds",
);
const loadFixture = (name: string) =>
  fs.readFileSync(path.join(fixtures, `${name}.json`), "utf8");

// The state.sqlite DDL this projection touches, matching sqlite_writer.ts. `companies`
// is here because the projection gap-fills `subject_of_activity` on it — production always
// has the table (reconstructState writes the whole schema before this runs), so a fixture
// without it modelled a database that cannot occur.
const STATE_SCHEMA = `
CREATE TABLE companies (
  uic TEXT PRIMARY KEY, name TEXT, legal_form TEXT, seat TEXT,
  subject_of_activity TEXT, funds_amount REAL, funds_currency TEXT, status TEXT,
  last_updated TEXT, objectives TEXT, means TEXT,
  public_benefit INTEGER, private_benefit INTEGER
);
CREATE TABLE company_persons (
  uic TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, name_norm TEXT NOT NULL,
  position_label TEXT, country TEXT, share_percent REAL, share_amount REAL,
  share_currency TEXT, record_id TEXT NOT NULL, group_id TEXT, field_ident TEXT NOT NULL,
  added_at TEXT, erased_at TEXT, persons_source TEXT,
  PRIMARY KEY (uic, record_id, field_ident)
);`;

let dir: string;
let statePath: string;
let store: CrDeedsStore;

const seedDailyRow = (
  db: DatabaseSync,
  uic: string,
  name: string,
  fieldIdent = "00070",
) =>
  db
    .prepare(
      `INSERT INTO company_persons
         (uic, role, name, name_norm, record_id, field_ident, added_at, persons_source)
       VALUES (?, 'manager', ?, ?, 'daily-1', ?, '2019-01-01', NULL)`,
    )
    .run(uic, name, name.toUpperCase(), fieldIdent);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-proj-"));
  statePath = path.join(dir, "state.sqlite");
  const s = new DatabaseSync(statePath);
  s.exec(STATE_SCHEMA);
  s.close();
  store = new CrDeedsStore(path.join(dir, "cr_deeds.sqlite"));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const rowsFor = (uic: string) => {
  const db = new DatabaseSync(statePath);
  const rows = db
    .prepare(`SELECT * FROM company_persons WHERE uic = ? ORDER BY record_id`)
    .all(uic) as Array<Record<string, unknown>>;
  db.close();
  return rows;
};

describe("deedToPersonRows", () => {
  it("gives each party a distinct cr:<i> record_id and 100% for a sole owner", () => {
    const parsed = parseCrDeed(loadFixture("eood1"))!;
    const rows = deedToPersonRows(parsed);
    expect(new Set(rows.map((r) => r.recordId)).size).toBe(rows.length); // unique
    expect(rows.every((r) => r.recordId.startsWith("cr:"))).toBe(true);
    const owner = rows.find((r) => r.role === "sole_owner");
    expect(owner?.sharePercent).toBe(100);
    expect(rows.find((r) => r.role === "manager")?.sharePercent).toBeNull();
  });

  // Substitute one trader name into the ЕТ fixture's CR_F_18_L and project it.
  const withTrader = (html: string) => {
    const body = JSON.parse(loadFixture("et")) as Record<string, unknown>;
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        const n = o as Record<string, unknown>;
        if (n.nameCode === "CR_F_18_L")
          n.htmlData =
            "<div class='record-container record-container--preview'>" +
            `<p class='field-text'>${html}</p></div>`;
        Object.values(n).forEach(walk);
      }
    };
    walk(body);
    return deedToPersonRows(parseCrDeed(JSON.stringify(body))!);
  };

  // ⚠️ BOTH DIRECTIONS, because either alone passes on a broken implementation: with the
  // filter deleted only the first moves, and with it widened to `p.role !== "sole_trader"`
  // — drop EVERY trader — only the second does. The second is not hypothetical caution:
  // the CR mapping exists so a future tier-2/3 ЕТ capture carries its trader on arrival,
  // and today that role has ZERO CR rows, so a regression dropping all of them would
  // restore the exact defect the mapping was added to fix with nothing to notice it.
  it("never projects the deleted-fact placeholder as a trader", () => {
    // Found by verifying the re-derived corpus, not by review: of 29,777 captures exactly
    // one (EIK 175238387) carries a CR_F_18_L holding „Заличено обстоятелство." — and it
    // is an EOOD, which cannot have a trader at all. Stored, it renders „едноличен
    // търговец: Заличено обстоятелство." on that company's page: false twice over.
    expect(
      withTrader("Заличено обстоятелство.").filter(
        (r) => r.role === "sole_trader",
      ),
    ).toHaveLength(0);
  });

  it("still projects a REAL trader — the filter is placeholder-scoped, not role-scoped", () => {
    const traders = withTrader("ИВАН ПЕТРОВ ГЕОРГИЕВ").filter(
      (r) => r.role === "sole_trader",
    );
    expect(traders).toHaveLength(1);
    expect(traders[0].name).toBe("ИВАН ПЕТРОВ ГЕОРГИЕВ");
  });
});

describe("projectCrDeedsToState — additive merge", () => {
  it("adds the recovered owner WITHOUT touching the daily-feed rows", () => {
    // МБАЛ Разлог: daily feed has a manager; CR recovers ОБЩИНА РАЗЛОГ as owner.
    const db = new DatabaseSync(statePath);
    seedDailyRow(db, "000022044", "Existing Manager");
    db.close();
    store.putAnswer("000022044", loadFixture("eood2"), 200, "t");

    const stats = projectCrDeedsToState(statePath, store);
    expect(stats.companies).toBe(1);

    const rows = rowsFor("000022044");
    const daily = rows.filter((r) => r.persons_source === null);
    const cr = rows.filter((r) => r.persons_source === "cr");
    expect(daily.length).toBe(1); // the daily manager is untouched
    expect(daily[0].record_id).toBe("daily-1");
    expect(cr.some((r) => r.role === "sole_owner")).toBe(true);
    expect(cr.some((r) => String(r.name).includes("ОБЩИНА РАЗЛОГ"))).toBe(true);
  });

  it("is idempotent — re-running replaces only the CR rows, no duplicates", () => {
    store.putAnswer("121587769", loadFixture("eood1"), 200, "t");
    const first = projectCrDeedsToState(statePath, store);
    const second = projectCrDeedsToState(statePath, store);
    expect(second.parties).toBe(first.parties);
    // The CR row count for the uic is stable across runs.
    const cr = rowsFor("121587769").filter((r) => r.persons_source === "cr");
    expect(cr.length).toBe(first.parties);
  });

  it("stores a legal-entity owner as a row (Bridge B guards the person graph)", () => {
    store.putAnswer("000632256", loadFixture("ead"), 200, "t"); // EAD, owner = община
    projectCrDeedsToState(statePath, store);
    const owner = rowsFor("000632256").find((r) => r.role === "sole_owner");
    expect(String(owner?.name)).toContain("ОБЩИНА");
  });

  it("skips a 'no such company' capture (byte_len 0 — never yielded)", () => {
    store.putAnswer("999999999", null, 200, "t"); // empty-200
    const stats = projectCrDeedsToState(statePath, store);
    expect(stats.companies).toBe(0);
    expect(stats.parties).toBe(0);
  });

  it("collects a founding date (with the real capture status) even for a party-less capture", () => {
    store.putAnswer("020008257", loadFixture("et"), 200, "t"); // ET: no mapped parties
    const stats = projectCrDeedsToState(statePath, store);
    const et = stats.founding.find((f) => f.eik === "020008257");
    expect(et).toBeDefined();
    expect(et!.httpStatus).toBe(200);
  });

  it("a CR party sharing a field_ident with a daily row does not overwrite it", () => {
    // The load-bearing property of the whole additive design: even when a CR party
    // carries the SAME field_ident as a daily row, the distinct cr:<i> record_id
    // keeps them separate under the (uic, record_id, field_ident) PK.
    // eood1's managers are field_ident 00070 — seed a daily row on 00070 too.
    const db = new DatabaseSync(statePath);
    seedDailyRow(db, "121587769", "Daily Manager", "00070");
    db.close();
    store.putAnswer("121587769", loadFixture("eood1"), 200, "t");
    projectCrDeedsToState(statePath, store);
    const rows = rowsFor("121587769");
    expect(rows.filter((r) => r.persons_source === null)).toHaveLength(1);
    expect(rows.some((r) => r.record_id === "daily-1")).toBe(true);
  });

  it("a re-run removes a placeholder trader an earlier run stored", () => {
    // The pure-function tests prove the placeholder is never EMITTED. This proves the
    // consequence a reader cares about — that re-projecting over a state.sqlite which
    // already holds the bad row REMOVES it. That is the difference between „new corpora
    // are clean" and „the live corpus is repaired", and it rides entirely on the delCr /
    // ≥1-party interaction, which is the part of this change most able to break quietly.
    //
    // Mirrors the real capture: EIK 175238387 is an EOOD carrying the placeholder
    // CR_F_18_L alongside real parties, so the ≥1-party guard passes and delCr runs.
    const db = new DatabaseSync(statePath);
    db.prepare(
      `INSERT INTO company_persons
         (uic, role, name, name_norm, record_id, field_ident, persons_source)
       VALUES ('121587769','sole_trader','Заличено обстоятелство.','X','cr:9','00180','cr')`,
    ).run();
    db.close();

    store.putAnswer("121587769", loadFixture("eood1"), 200, "t");
    projectCrDeedsToState(statePath, store);

    const cr = rowsFor("121587769").filter((r) => r.persons_source === "cr");
    expect(cr.filter((r) => r.role === "sole_trader")).toHaveLength(0);
    expect(cr.length).toBeGreaterThan(0); // …and the real parties are still there
  });

  it("fills a NULL предмет на дейност and never overwrites the daily feed's", () => {
    // ⚠️ BOTH HALVES IN ONE TEST, because either alone passes on a broken implementation:
    // drop the `IS NULL` guard and only the second assertion moves; drop the UPDATE
    // entirely and only the first does. Mutation-verified — with the whole guard deleted
    // all 11 other tests in this file stayed green.
    //
    // The precedence is the OPPOSITE of this projection's persons, which are additive:
    // a scalar has no record_id namespace to coexist in, and the daily feed re-states the
    // field on every change while a capture is frozen at its fetched_at. So CR fills
    // silence and the feed always wins a contest.
    const db = new DatabaseSync(statePath);
    db.prepare(
      `INSERT INTO companies (uic, name, subject_of_activity) VALUES (?, ?, ?)`,
    ).run("121587769", "EOOD ONE", "ДАЙЛИ ДЕЙНОСТ");
    db.prepare(`INSERT INTO companies (uic, name) VALUES (?, ?)`).run(
      "203190680",
      "ЕТ WITH NO SUBJECT",
    );
    db.close();

    store.putAnswer("121587769", loadFixture("eood1"), 200, "t");
    store.putAnswer("203190680", loadFixture("ood"), 200, "t");
    const stats = projectCrDeedsToState(statePath, store);

    const read = new DatabaseSync(statePath);
    const subj = (uic: string) =>
      (
        read
          .prepare(
            `SELECT subject_of_activity AS s FROM companies WHERE uic = ?`,
          )
          .get(uic) as { s: string | null }
      ).s;
    // The daily feed's answer is untouched…
    expect(subj("121587769")).toBe("ДАЙЛИ ДЕЙНОСТ");
    // …and the silence is filled.
    expect(subj("203190680")).toBeTruthy();
    expect(subj("203190680")).not.toBe("ДАЙЛИ ДЕЙНОСТ");
    read.close();

    // And the stat counts the FILL, not the attempt: two captures carry a предмет на
    // дейност, one row moved.
    expect(stats.subjects).toBe(1);
  });

  it("a later capture that yields 0 parties leaves prior CR rows intact", () => {
    store.putAnswer("121587769", loadFixture("eood1"), 200, "t");
    const first = projectCrDeedsToState(statePath, store);
    expect(first.parties).toBeGreaterThan(0);
    // Replace with a parseable but party-less body (ET), re-project.
    store.putAnswer("121587769", loadFixture("et"), 200, "t2");
    projectCrDeedsToState(statePath, store);
    const cr = rowsFor("121587769").filter((r) => r.persons_source === "cr");
    expect(cr.length).toBe(first.parties); // the guard ran before any delete
  });
});

describe("foundingDatesFromStore", () => {
  it("returns one entry per real capture, carrying date + real status", () => {
    store.putAnswer("121587769", loadFixture("eood1"), 200, "t");
    store.putAnswer("999999999", null, 200, "t"); // empty-200 — not a real capture
    const founding = foundingDatesFromStore(store);
    expect(founding.map((f) => f.eik)).toEqual(["121587769"]);
    expect(founding[0]).toMatchObject({ httpStatus: 200 });
    expect(founding[0].date).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
});

describe("eligibleFounding + foundingChunkSql (DB-free)", () => {
  const mk = (eik: string): FoundingAnswer => ({
    eik,
    date: "2020-01-01",
    httpStatus: 200,
  });

  it("drops a non-9-digit (branch) eik from the company-level upsert", () => {
    const rows = eligibleFounding([mk("121587769"), mk("1234567890123")]);
    expect(rows.map((r) => r.eik)).toEqual(["121587769"]);
  });

  it("emits 3 placeholders per row, numbered correctly, with the real status bound", () => {
    const { values, params } = foundingChunkSql([
      mk("111111111"),
      mk("222222222"),
    ]);
    expect(values).toContain(
      "($1, $2, 'registryagency:CR/Deeds', now(), $3, 1)",
    );
    expect(values).toContain(
      "($4, $5, 'registryagency:CR/Deeds', now(), $6, 1)",
    );
    expect(params).toEqual([
      "111111111",
      "2020-01-01",
      200,
      "222222222",
      "2020-01-01",
      200,
    ]);
  });
});
