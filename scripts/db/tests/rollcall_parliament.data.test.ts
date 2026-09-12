import { afterAll, it, expect } from "vitest";
import { createRequire } from "node:module";
import { pinLocalDatabase, withClient, end } from "../lib/pg";
import { encodeRollcallQuery } from "../../../src/lib/rollcallQuery";
const { runRollcallQuery, rollcallEntities } = createRequire(import.meta.url)(
  "../../../functions/rollcall_query.js",
);
pinLocalDatabase();
afterAll(end);
it("parliament scopes preserve composite identity, attempts, chronology and complete parents", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE SCHEMA rollcall_parliament_fixture;SET LOCAL search_path=rollcall_parliament_fixture,public;
CREATE TABLE vote_day(ns int,date date,pdf_url text,scraped_at timestamptz);
CREATE TABLE vote_item(item_id int,ns int,date date,item_no int,title text,superseded_by int,yes int,no int,abstain int,absent int);
CREATE TABLE vote_cast(item_id int,ns int,mp_id int,vote text,party_id int);
CREATE TABLE mp_seat(ns int,mp_id int,name text);
CREATE TABLE party_dim(party_id int,short text);
CREATE TABLE person(person_id int,display_name text,status text);
CREATE TABLE person_role(person_id int,source text,ref text,confidence text);
CREATE TABLE rollcall_query_revisions(resource text,generation int);
INSERT INTO rollcall_query_revisions VALUES('fixture',1);
INSERT INTO vote_day VALUES(51,'2025-12-31','https://example.test/51',now()),(52,'2026-01-01','https://example.test/52',now()),(52,'2026-01-02','https://example.test/52',now()),(52,'2026-01-03','https://example.test/empty',now());
INSERT INTO vote_item VALUES(1,52,'2026-01-01',1,'Бюджет',2,1,1,0,0),(2,52,'2026-01-01',2,'Бюджет',null,2,0,0,0),(3,52,'2026-01-02',1,null,null,0,1,1,0),(4,51,'2025-12-31',1,'Здравеопазване',null,1,0,0,0);
INSERT INTO mp_seat VALUES(52,7,'БОЙКО ИЛИЕВ РАШКОВ'),(52,8,'ДРУГ ЧОВЕК'),(51,7,'СЪВСЕМ ДРУГ ЧОВЕК');
INSERT INTO party_dim VALUES(1,'A'),(2,'B');
INSERT INTO vote_cast VALUES(1,52,7,'y',1),(1,52,8,'n',1),(2,52,7,'y',1),(2,52,8,'y',1),(3,52,7,'n',2),(3,52,8,'a',1),(4,51,7,'y',2);
INSERT INTO person VALUES(10,'Бойко Илиев Рашков','active'),(11,'Съвсем Друг Човек','active');
INSERT INTO person_role VALUES(10,'mp','7:52','exact_id'),(11,'mp','7:51','exact_id');`);
      const db = async (sql: string, p: unknown[]) =>
        (await c.query(sql, p)).rows;
      const run = async (q: Record<string, unknown>) =>
        (await runRollcallQuery(db, q)).body;
      const attempts = await run({
        corpus: "parliamentVotes",
        assemblyIds: ["52"],
        basis: "attempts",
      });
      expect(
        attempts.rows.find((r: { key: string }) => r.key === "52:2026-01-01:1")
          .revote,
      ).toBe("linked");
      expect(
        attempts.rows.find((r: { key: string }) => r.key === "52:2026-01-01:2")
          .revote,
      ).toBe("linked");
      expect(
        attempts.rows.find((r: { key: string }) => r.key === "52:2026-01-02:1")
          .revote,
      ).toBe("none");
      const share = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        basis: "attempts",
        metric: "choiceShare",
        operation: "share",
        choice: "for",
        limit: 1,
      });
      expect(share.metrics).toMatchObject({ numerator: 2, denominator: 3 });
      expect(share.metrics.percentage).toBeCloseTo(200 / 3);
      const agreement = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        comparatorSeatIds: ["52:8"],
        basis: "attempts",
        metric: "agreement",
        minOverlap: 1,
      });
      expect(agreement.metrics).toMatchObject({ numerator: 1, denominator: 3 });
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            comparatorSeatIds: ["52:8"],
            metric: "agreement",
            minOverlap: 5,
          })
        ).metrics.percentage,
      ).toBeNull();
      const alignment = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        basis: "attempts",
        metric: "alignment",
        minOverlap: 1,
      });
      expect(alignment.metrics).toMatchObject({
        numerator: 3,
        denominator: 3,
        percentage: 100,
      });
      const trend = await run({
        corpus: "parliamentVotes",
        assemblyIds: ["51", "52"],
        operation: "trend",
        order: "asc",
      });
      expect(trend.groups).toEqual([
        { key: "2025-12", records: 1 },
        { key: "2026-01", records: 2 },
      ]);
      const compare = await run({
        corpus: "parliamentVotes",
        operation: "compare",
        from: "2026-01-01",
        toExclusive: "2026-01-03",
        compareFrom: "2025-12-01",
        compareToExclusive: "2026-01-01",
      });
      expect(
        compare.comparisons.map(
          (r: { totals: { records: number } }) => r.totals.records,
        ),
      ).toEqual([2, 1]);
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            from: "2026-01-03",
            toExclusive: "2026-01-04",
            metric: "choiceShare",
            operation: "share",
            choice: "for",
          })
        ).metrics.percentage,
      ).toBeNull();
      await c.query(
        "INSERT INTO vote_item VALUES(5,52,'2026-01-03',1,'Отсъствие',null,1,0,0,1);INSERT INTO vote_cast VALUES(5,52,7,'x',2),(5,52,8,'y',1)",
      );
      const recorded = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        basis: "attempts",
        metric: "choiceShare",
        choice: "for",
        denominator: "recorded",
      });
      expect(recorded.metrics.denominator).toBe(4);
      const participating = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        basis: "attempts",
        metric: "choiceShare",
        choice: "for",
        denominator: "participating",
      });
      expect(participating.metrics.denominator).toBe(3);
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            comparatorSeatIds: ["52:8"],
            basis: "attempts",
            metric: "agreement",
            minOverlap: 1,
          })
        ).metrics.denominator,
      ).toBe(3);
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            basis: "attempts",
            metric: "alignment",
            minOverlap: 1,
          })
        ).metrics.denominator,
      ).toBe(3);
      await c.query(
        "DELETE FROM vote_cast WHERE item_id=5;DELETE FROM vote_item WHERE item_id=5",
      );
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            comparatorSeatIds: ["52:8"],
            basis: "attempts",
            choice: "against",
            metric: "agreement",
            minOverlap: 1,
          })
        ).metrics,
      ).toMatchObject({ numerator: 0, denominator: 1, percentage: 0 });
      const ranked = await run({
        corpus: "parliamentVotes",
        assemblyIds: ["51", "52"],
        operation: "rank",
        groupBy: "body",
        limit: 1,
      });
      expect(ranked.groups).toEqual([{ key: "52", records: 2 }]);
      expect(ranked.groupCount).toBe(2);
      expect(
        (
          await run({
            ...ranked.query,
            offset: 1,
            expectedRevision: ranked.revision,
          })
        ).groups,
      ).toEqual([{ key: "51", records: 1 }]);
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            comparatorSeatIds: ["51:7"],
            metric: "agreement",
            minOverlap: 1,
          })
        ).metrics,
      ).toMatchObject({ denominator: 0, percentage: null });
      await c.query("DELETE FROM vote_cast WHERE item_id=2 AND mp_id=8");
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            comparatorSeatIds: ["52:8"],
            basis: "attempts",
            metric: "agreement",
            minOverlap: 1,
          })
        ).metrics.denominator,
      ).toBe(2);
      await c.query("INSERT INTO vote_cast VALUES(2,52,8,'y',1)");
      const uneven = await run({
        corpus: "parliamentVotes",
        operation: "compare",
        from: "2030-01-01",
        toExclusive: "2031-01-01",
        compareFrom: "2026-01-01",
        compareToExclusive: "2026-01-03",
      });
      expect(uneven.status).toBe("partial");
      expect(
        uneven.comparisons.map((x: { status: string }) => x.status),
      ).toEqual(["unavailable", "success"]);
      await c.query("UPDATE vote_day SET pdf_url=NULL WHERE ns=51");
      const quality = await run({
        corpus: "parliamentVotes",
        operation: "compare",
        from: "2026-01-01",
        toExclusive: "2026-01-03",
        compareFrom: "2025-12-01",
        compareToExclusive: "2026-01-01",
      });
      expect(quality.status).toBe("partial");
      expect(quality.comparisons[1].status).toBe("partial");
      await c.query(
        "UPDATE vote_day SET pdf_url='https://example.test/51' WHERE ns=51",
      );
      await c.query(
        "INSERT INTO mp_seat VALUES(52,9,'Трети Човек');INSERT INTO vote_cast VALUES(1,52,9,'a',1)",
      );
      const tie = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        key: "52:2026-01-01:1::7",
        basis: "attempts",
        metric: "alignment",
        minOverlap: 1,
      });
      expect(tie.metrics).toMatchObject({
        numerator: 1,
        denominator: 1,
        percentage: 100,
        tiePolicy: "for_then_against_then_abstain",
      });
      await c.query(
        "DELETE FROM vote_cast WHERE mp_id=9;DELETE FROM mp_seat WHERE mp_id=9",
      );
      const recent = await run({ corpus: "parliamentVotes" });
      expect(recent.totals.records).toBe(3);
      expect(recent.rows.map((r: { key: string }) => r.key)).toEqual([
        "52:2026-01-02:1",
        "52:2026-01-01:2",
        "52:2026-01-01:1",
      ]);
      expect(
        (await run({ corpus: "parliamentVotes", operation: "count" })).totals
          .records,
      ).toBe(2);
      const sessions = await run({ corpus: "parliamentSessions" });
      expect(sessions.rows[0]).toMatchObject({
        key: "52:2026-01-03",
        item_count: 0,
      });
      const person = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        latestN: 2,
        limit: 1,
      });
      expect(person.totals.records).toBe(2);
      expect(person.rows[0]).toMatchObject({
        choice: "against",
        faction: "B",
        person_key: "52:7",
      });
      const page = await run({
        corpus: "parliamentCasts",
        seatIds: ["52:7"],
        latestN: 2,
        limit: 1,
        offset: 1,
        expectedRevision: person.revision,
      });
      expect(page.totals.records).toBe(2);
      expect(page.rows[0].choice).toBe("for");
      expect(
        (
          await run({
            corpus: "parliamentVotes",
            from: "2025-12-31",
            toExclusive: "2026-01-01",
          })
        ).rows[0].body,
      ).toBe("51");
      const health = await run({
        corpus: "parliamentVotes",
        assemblyIds: ["51", "52"],
        topicIds: ["health"],
      });
      expect(health.totals.records).toBe(1);
      expect(health.status).toBe("partial");
      const parentQuery = encodeRollcallQuery({
        corpus: "parliamentVotes",
        limit: 1,
      });
      const child = await run({
        corpus: "parliamentCasts",
        parentQuery,
        relationship: "voteCasts",
      });
      expect(child.totals.records).toBe(6);
      const resolved = (await rollcallEntities(db, { name: "Boyko Rashkov" }))
        .body;
      expect(resolved.candidates).toEqual([
        {
          label: "БОЙКО ИЛИЕВ РАШКОВ",
          seatIds: ["52:7"],
          assemblies: [52],
          verified: true,
        },
      ]);
      expect(
        (await run({ corpus: "parliamentSessions", topicIds: ["budget"] }))
          .totals.records,
      ).toBe(1);
      expect(
        (
          await run({
            corpus: "parliamentSessions",
            keyword: "несъществуваща тема",
          })
        ).status,
      ).toBe("empty");
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            seatIds: ["52:7"],
            from: "2026-01-03",
            toExclusive: "2026-01-04",
          })
        ).status,
      ).toBe("empty");
      expect(
        (await run({ corpus: "parliamentVotes", key: "52:2026-01-02:99" }))
          .reason,
      ).toBe("record_not_found");
      expect(
        (
          await run({
            corpus: "parliamentVotes",
            from: "2030-01-01",
            toExclusive: "2031-01-01",
          })
        ).status,
      ).toBe("unavailable");
      await c.query(
        "INSERT INTO vote_day VALUES(53,'2026-01-04','https://example.test/new',now())",
      );
      expect(
        (await run({ corpus: "parliamentVotes" })).query.assemblyIds,
      ).toEqual(["52"]);
      expect((await run({ corpus: "parliamentCasts" })).rows[0].body).toBe(
        "52",
      );
      expect((await run({ corpus: "parliamentSessions" })).rows[0].body).toBe(
        "53",
      );
      await c.query(
        "UPDATE vote_item SET yes=1,no=0,abstain=1 WHERE item_id=3",
      );
      const contested = await run({
        corpus: "parliamentVotes",
        metric: "contested",
        operation: "rank",
      });
      expect(contested.rows[0]).toMatchObject({
        key: "52:2026-01-02:1",
        contested: 50,
      });
      await c.query("UPDATE vote_item SET yes=99 WHERE item_id=3");
      expect(
        (await run({ corpus: "parliamentVotes" })).rows[0].tally_mismatch,
      ).toBe(true);
      await c.query("UPDATE rollcall_query_revisions SET generation=2");
      expect(
        (
          await run({
            corpus: "parliamentVotes",
            expectedRevision: recent.revision,
          })
        ).status,
      ).toBe("stale");
      const pinnedParent = encodeRollcallQuery({
        corpus: "parliamentVotes",
        expectedRevision: recent.revision,
      });
      expect(
        (
          await run({
            corpus: "parliamentCasts",
            parentQuery: pinnedParent,
            relationship: "voteCasts",
          })
        ).status,
      ).toBe("stale");
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
