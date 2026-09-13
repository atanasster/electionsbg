import { describe, expect, it } from "vitest";
import { isCommentOnlyDrift, withoutSqlComments } from "./sqlCommentDrift";

const fn = (body: string, language = "sql", suffix = "") => ({
  body,
  language,
  def: `CREATE FUNCTION f() RETURNS text LANGUAGE ${language} STABLE AS $function$${body}$function$${suffix}`,
});

describe("SQL comment drift", () => {
  it("classifies the person_by_slug documentation edit as comment-only", () => {
    expect(
      isCommentOnlyDrift(
        fn("SELECT 1 -- (person-candidate-merge-v1): money\n"),
        fn("SELECT 1 -- on the merged dashboard: money\n"),
      ),
    ).toBe(true);
  });
  it("handles nested block comments in SQL and PLpgSQL", () => {
    expect(
      isCommentOnlyDrift(
        fn("BEGIN /* old /* nested */ text */ RETURN 1; END", "plpgsql"),
        fn("BEGIN /* new */ RETURN 1; END", "plpgsql"),
      ),
    ).toBe(true);
  });
  it.each([
    ["SELECT '--old'", "SELECT '--new'"],
    ['SELECT "/*old*/"', 'SELECT "/*new*/"'],
    ["SELECT 'it''s --old'", "SELECT 'it''s --new'"],
    [String.raw`SELECT E'it\'s --old'`, String.raw`SELECT E'it\'s --new'`],
    ["SELECT $$--old$$", "SELECT $$--new$$"],
    [
      "EXECUTE $query$SELECT 1 --old$query$",
      "EXECUTE $query$SELECT 1 --new$query$",
    ],
    ["SELECT 1 --old", "SELECT 2 --new"],
    ["SELECT 'a'\n'b' --old", "SELECT 'a' 'b' --new"],
  ])("retains executable/quoted differences: %s", (a, b) => {
    expect(isCommentOnlyDrift(fn(a), fn(b))).toBe(false);
  });
  it("retains function metadata and unsupported language changes", () => {
    expect(
      isCommentOnlyDrift(
        fn("SELECT 1 --old"),
        fn("SELECT 1 --new", "sql", " SECURITY DEFINER"),
      ),
    ).toBe(false);
    expect(
      isCommentOnlyDrift(fn("--old", "plpython3u"), fn("--new", "plpython3u")),
    ).toBe(false);
  });
  it("keeps token boundaries and fails conservatively on unfinished quotes/comments", () => {
    expect(withoutSqlComments("SELECT/*x*/1")).toBe("SELECT 1");
    expect(withoutSqlComments("SELECT /* unterminated")).toBe(
      "SELECT /* unterminated",
    );
    expect(withoutSqlComments("SELECT $tag$-- literal")).toBe(
      "SELECT $tag$-- literal",
    );
    expect(withoutSqlComments("SELECT 'a--b'")).toBe("SELECT 'a--b'");
  });
});
