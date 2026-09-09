import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifySql } = require("./sql_statement.js") as {
  classifySql: (sql: string) => {
    statementCount: number;
    firstKeyword: string;
    normalized: string;
    cursorable: boolean;
    complete: boolean;
  };
};

describe("SQL statement classification", () => {
  it.each([
    "-- source note\nSELECT * FROM contracts;",
    "/* source; note */ WITH rows AS (SELECT 1) SELECT * FROM rows;",
    "SELECT ';' AS punctuation;",
    "SELECT E'backslash\\\\;apostrophe'';' AS value;",
    "SELECT $$semi;colon$$ AS value; -- trailing; comment",
    "VALUES ('one;value');",
  ])("keeps one commented or quoted read cursorable", (sql) => {
    const result = classifySql(sql);
    expect(result.statementCount).toBe(1);
    expect(result.cursorable).toBe(true);
    expect(result.normalized).not.toMatch(/;\s*$/);
  });

  it("does not classify two statements as one read", () => {
    const result = classifySql("SELECT 1; /* separator; */ SELECT 2;");
    expect(result.statementCount).toBe(2);
    expect(result.cursorable).toBe(false);
  });

  it("does not let a plain-string backslash hide a second statement", () => {
    const result = classifySql("SELECT 'x\\\\'; SELECT 2;");
    expect(result.statementCount).toBe(2);
    expect(result.cursorable).toBe(false);
  });

  it("honours backslash escaping only in PostgreSQL escape strings", () => {
    expect(
      classifySql(String.raw`SELECT E'x\';still one' AS value;`),
    ).toMatchObject({
      statementCount: 1,
      complete: true,
      cursorable: true,
    });
    expect(classifySql("SELECT 'it''s; one' AS value;")).toMatchObject({
      statementCount: 1,
      complete: true,
      cursorable: true,
    });
  });

  it.each(["SELECT 'open", 'SELECT "open', "SELECT 1 /* open", "SELECT $$open"])(
    "rejects an unterminated lexical mode: %s",
    (sql) => {
      expect(classifySql(sql)).toMatchObject({ complete: false, cursorable: false });
    },
  );

  it("distinguishes EXPLAIN from an executed read", () => {
    const result = classifySql("-- plan\nEXPLAIN SELECT * FROM contracts;");
    expect(result.firstKeyword).toBe("explain");
    expect(result.cursorable).toBe(false);
  });
});
