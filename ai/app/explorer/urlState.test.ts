import { expect, it } from "vitest";
import { parseToolsLocation, toolsHref, recentIds } from "./urlState";
import { navigationPath } from "./workspace";
it("uses integrated language routes while retaining area and typed settings", () => {
  const href = toolsHref(
    "contractSearch",
    "en",
    "?area=68134",
    { company: "Test & Co" },
    "/en/chat",
  );
  expect(href.startsWith("/en/chat/tools?")).toBe(true);
  const query = href.slice(href.indexOf("?"));
  expect(new URLSearchParams(query).has("lang")).toBe(false);
  expect(parseToolsLocation(query).args?.company).toBe("Test & Co");
  expect(navigationPath("chat", "?area=68134&lang=en", "/en/chat/tools")).toBe(
    "/en/chat?area=68134",
  );
  expect(navigationPath("tools", "?lang=en", "/")).toBe("/tools?lang=en");
});
it("round trips typed settings, language and area", () => {
  const href = toolsHref("contractSearch", "en", "?area=68134", {
    company: "Test & Co",
    count: "12",
  });
  const query = href.slice(href.indexOf("?"));
  expect(parseToolsLocation(query)).toEqual({
    tool: "contractSearch",
    args: { company: "Test & Co", count: 12 },
  });
  expect(new URLSearchParams(query).get("lang")).toBe("en");
  expect(new URLSearchParams(query).get("area")).toBe("68134");
});
it("rejects invalid, unknown, hidden and oversized inputs", () => {
  for (const query of [
    "?tool=constructor&v=1",
    "?tool=nationalResults&v=2",
    "?tool=nationalResults&v=1&args=[]",
    '?tool=candidateResult&v=1&args={"partyNum":2}',
    '?tool=contractSearch&v=1&args={"company":"X","count":999}',
    "?args={}",
    "?" + "x".repeat(6001),
  ])
    expect(parseToolsLocation(query)).toEqual({ error: true });
  expect(parseToolsLocation("?tool=contractSearch&v=1")).toEqual({
    tool: "contractSearch",
  });
  expect(() => toolsHref("contractSearch", "bg", "", {})).toThrow();
});
it("retains only known recent IDs in first-seen order", () => {
  expect(
    recentIds([
      "budgetVariance",
      "no",
      "constructor",
      "budgetVariance",
      "agencyPolls",
    ]),
  ).toEqual(["budgetVariance", "agencyPolls"]);
  expect(recentIds({ name: "budgetVariance" })).toEqual([]);
});

it("refuses oversized valid text before creating a share link", () => {
  expect(() =>
    toolsHref("contractSearch", "bg", "", { company: "Ж".repeat(2000) }),
  ).toThrow(/oversized/);
});
