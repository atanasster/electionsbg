import { afterAll, it, expect } from "vitest";
import { createRequire } from "node:module";
import { pinLocalDatabase, withClient, end } from "../lib/pg";
import { encodeRollcallQuery } from "../../../src/lib/rollcallQuery";
const { runRollcallQuery, rollcallEntities, rollcallCapabilities } =
  createRequire(import.meta.url)("../../../functions/rollcall_query.js");
pinLocalDatabase();
afterAll(end);
it("council source identities, body bridges, date quality and named-roll gaps stay explicit", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE SCHEMA rollcall_council_fixture;SET LOCAL search_path=rollcall_council_fixture,public;
CREATE TABLE council_muni(obshtina_code text,name text);
CREATE TABLE council_muni_code(frontend_code text,obshtina_code text);
CREATE TABLE council_resolution(id text,obshtina_code text,decided_on date,session text,title text,result text,tally_method text,has_named_votes boolean,source_url text,last_seen_at timestamptz,tally_for int,tally_against int,tally_abstain int);
CREATE TABLE council_vote(resolution_id text,norm_key text,councillor text,vote text,person_id int);
CREATE TABLE rollcall_query_revisions(resource text,generation int);
CREATE TABLE rollcall_query_meta(key text,value jsonb);
INSERT INTO rollcall_query_revisions VALUES('fixture',1);
INSERT INTO rollcall_query_meta VALUES('catalog','{"yearOnlyCouncils":["HKV34"]}');
INSERT INTO council_muni VALUES('BGS01','Бургас'),('SOF','София'),('HKV34','Хасково'),('VAR06','Aggregate');
INSERT INTO council_muni_code VALUES('BGS04','BGS01'),('SOF01','SOF');
INSERT INTO council_resolution VALUES
('a','BGS01','2026-01-02','1','Бюджет','adopted','named',true,'https://example.test/a',now(),1,1,0),
('b','BGS01','2026-01-02','1','Пътища','adopted','open',false,'https://example.test/b',now(),null,null,null),
('c','SOF','2026-01-03','2','Здравеопазване','rejected','named',true,'https://example.test/c',now(),0,1,0),
('d','HKV34','2022-01-01','3','Бюджет','unknown','none',false,'https://example.test/d',now(),null,null,null),
('e','VAR06','2026-01-01',null,'Secret','unknown','secret',false,'https://example.test/e',now(),null,null,null);
INSERT INTO council_vote VALUES('a','ivan_petrov','Иван Петров','for',null),('a','maria','Мария Иванова','against',2),('c','ivan_petrov','Иван Петров','against',3);`);
      const db = async (sql: string, p: unknown[]) =>
        (await c.query(sql, p)).rows;
      const run = async (q: Record<string, unknown>) =>
        (await runRollcallQuery(db, q)).body;
      const a = await run({
        corpus: "councilResolutions",
        councilIds: ["BGS01"],
      });
      expect(a.totals.records).toBe(2);
      expect(a.rows.find((r: { key: string }) => r.key === "b").yes).toBeNull();
      expect(
        (await run({ corpus: "councilCasts", councilIds: ["BGS01"] })).status,
      ).toBe("partial");
      expect(
        (
          await run({
            corpus: "councilCasts",
            councilIds: ["BGS01"],
            operation: "count",
          })
        ).coverage.missingRolls,
      ).toBe(1);
      expect(
        (
          await run({
            corpus: "councilCasts",
            councilIds: ["BGS01"],
            topicIds: ["roads"],
          })
        ).reason,
      ).toBe("named_roll_not_published");
      expect(
        (
          await run({
            corpus: "councilCasts",
            parentQuery: encodeRollcallQuery({
              corpus: "councilResolutions",
              key: "b",
            }),
            relationship: "voteCasts",
          })
        ).reason,
      ).toBe("named_roll_not_published");
      expect(
        (await run({ corpus: "councilResolutions", operation: "count" })).query
          .basis,
      ).toBe("attempts");
      expect(
        (await run({ corpus: "councilResolutions", basis: "standing" })).status,
      ).toBe("unsupported");
      const sessions = await run({
        corpus: "councilSessions",
        councilIds: ["BGS01"],
        topicIds: ["budget"],
      });
      expect(sessions.rows[0].item_count).toBe(2);
      const child = await run({
        corpus: "councilResolutions",
        parentQuery: encodeRollcallQuery({
          corpus: "councilSessions",
          councilIds: ["BGS01"],
          limit: 1,
        }),
        relationship: "sessionVotes",
      });
      expect(child.totals.records).toBe(2);
      const casts = await run({
        corpus: "councilCasts",
        councilIds: ["BGS01"],
        councilCastKeys: ["a::ivan_petrov"],
      });
      expect(casts.rows).toHaveLength(1);
      expect(casts.rows[0].choice).toBe("for");
      const person = (
        await rollcallEntities(db, {
          corpus: "councilCasts",
          council: "BGS04",
          namespace: "frontend",
          name: "Ivan Petrov",
        })
      ).body;
      expect(person.status).toBe("clarify");
      expect(person.sourceRows.map((r: { key: string }) => r.key)).toEqual([
        "a::ivan_petrov",
      ]);
      expect(
        (
          await rollcallEntities(db, {
            corpus: "councilCasts",
            council: "SOF01",
            namespace: "frontend",
            name: "Иван Петров",
          })
        ).body.sourceRows[0].key,
      ).toBe("c::ivan_petrov");
      expect(
        (
          await rollcallEntities(db, {
            corpus: "councilCasts",
            council: "BGS01",
            name: "Иван Петров",
            from: "2026-02-30",
            toExclusive: "2026-03-02",
          })
        ).status,
      ).toBe(400);
      expect(
        (await run({ corpus: "councilCasts", councilIds: ["VAR06"] })).reason,
      ).toBe("named_roll_not_published");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            councilIds: ["BGS01"],
            from: "2026-01-03",
            toExclusive: "2026-01-04",
          })
        ).status,
      ).toBe("unavailable");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            councilIds: ["BGS01"],
            keyword: "missing",
          })
        ).status,
      ).toBe("empty");
      expect(
        (await run({ corpus: "councilSessions", councilIds: ["HKV34"] }))
          .reason,
      ).toBe("source_year_only");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            councilIds: ["HKV34"],
            from: "2022-01-01",
            toExclusive: "2022-02-01",
          })
        ).reason,
      ).toBe("source_year_only");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            councilIds: ["HKV34"],
            from: "2022-01-01",
            toExclusive: "2023-01-01",
          })
        ).status,
      ).toBe("partial");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            councilIds: ["HKV34"],
            from: "2022-02-01",
            toExclusive: "2022-03-01",
          })
        ).reason,
      ).toBe("source_year_only");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            parentQuery: encodeRollcallQuery({
              corpus: "councilSessions",
              councilIds: ["HKV34"],
            }),
            relationship: "sessionVotes",
          })
        ).reason,
      ).toBe("source_year_only");
      await c.query("UPDATE council_resolution SET tally_for=10 WHERE id='a'");
      expect(
        (await run({ corpus: "councilResolutions", key: "a" })).rows[0]
          .tally_mismatch,
      ).toBe(true);
      await c.query(
        "UPDATE council_vote SET person_id=99 WHERE resolution_id='a'",
      );
      expect(
        (
          await run({
            corpus: "councilCasts",
            councilIds: ["BGS01"],
            councilCastKeys: ["a::ivan_petrov"],
          })
        ).rows[0].key,
      ).toBe("a::ivan_petrov");
      const cap = (await rollcallCapabilities(db)).body;
      expect(
        cap.councils.find((b: { id: string }) => b.id === "HKV34").year_only,
      ).toBe(true);
      expect(cap.corpora.councilCasts.ready).toBe(true);
      await c.query("UPDATE rollcall_query_revisions SET generation=2");
      expect(
        (
          await run({
            corpus: "councilResolutions",
            expectedRevision: a.revision,
          })
        ).status,
      ).toBe("stale");
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
