import { describe, expect, it } from "vitest";
import {
  parseSqlQuestionUrl,
  sqlQuestionHref,
  writeSqlQuestionUrl,
} from "./url";

describe("SQL question URLs", () => {
  it("round-trips only allowlisted typed parameters", () => {
    const href = sqlQuestionHref("companyConnections", {
      company: "000012345",
    });
    const parsed = parseSqlQuestionUrl(
      new URLSearchParams(href.slice(href.indexOf("?") + 1)),
    );
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") throw new Error("expected valid URL");
    expect(parsed.rendered.recipeId).toBe("companyConnections");
    expect(parsed.rendered.parameters).toEqual({ company: "000012345" });
    expect(parsed.rendered.sql).toContain("'000012345'");
  });

  it("rejects unknown parameters and versions", () => {
    expect(
      parseSqlQuestionUrl(
        new URLSearchParams("q=companyConnections&p.sql=DROP+TABLE+x"),
      ),
    ).toMatchObject({ kind: "invalid" });
    expect(
      parseSqlQuestionUrl(
        new URLSearchParams("q=companyConnections&v=2&p.company=1"),
      ),
    ).toMatchObject({ kind: "invalid" });
    expect(parseSqlQuestionUrl(new URLSearchParams("q=unknown"))).toMatchObject(
      { kind: "invalid" },
    );
    expect(
      parseSqlQuestionUrl(
        new URLSearchParams("q=find-a-person&p.limit=999999"),
      ),
    ).toMatchObject({ kind: "invalid" });
    expect(
      parseSqlQuestionUrl(
        new URLSearchParams("q=find-a-person&p.name=a&p.name=b"),
      ),
    ).toMatchObject({ kind: "invalid" });
  });

  it("clears catalog identity while retaining unrelated URL state", () => {
    const cleared = writeSqlQuestionUrl(
      new URLSearchParams("q=companyConnections&v=1&p.company=1&lang=en"),
    );
    expect(cleared.toString()).toBe("lang=en");
  });

  it("accepts a legacy link without a version", () => {
    const parsed = parseSqlQuestionUrl(
      new URLSearchParams("q=top-contractors"),
    );
    expect(parsed).toMatchObject({
      kind: "valid",
      rendered: { recipeId: "top-contractors", version: 1 },
    });
  });
});
