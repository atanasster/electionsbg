import { describe, expect, it } from "vitest";
import { bareAcronym, mentionsQuery } from "./mentionsUnderstanding";
import { route } from "./router";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;

describe("mentionsQuery", () => {
  it.each([
    ["Покажи ми всички данни за INSAIT, ИНСАИТ", "INSAIT, ИНСАИТ"],
    ["покажи ми всички данни за INSAIT?", "INSAIT"],
    ["Дай ми цялата информация за Sofia Tech Park", "Sofia Tech Park"],
    ["Всички данни, които имате за Софарма", "Софарма"],
    ["Къде се споменава Sofia Tech Park?", "Sofia Tech Park"],
    ["Show me all data about INSAIT", "INSAIT"],
    ["everything about Sofia Tech Park", "Sofia Tech Park"],
    ["where is INSAIT mentioned", "INSAIT"],
  ])("%s → %s", (q, term) => {
    expect(mentionsQuery(q)).toBe(term);
  });

  it.each([
    "данни за безработицата",
    "всичко за Пловдив",
    "Покажи всички данни за едно лице",
    "show all data about a person",
    "всички данни за ab",
  ])("not a mentions request: %s", (q) => {
    expect(mentionsQuery(q)).toBeNull();
  });
});

describe("bareAcronym", () => {
  it.each(["INSAIT", "ИНСАИТ", "INSAIT, ИНСАИТ"])("%s qualifies", (q) => {
    expect(bareAcronym(q)).not.toBeNull();
  });
  it.each(["здравей", "как си", "Ab", "покажи ми нещо интересно днес"])(
    "%s does not",
    (q) => {
      expect(bareAcronym(q)).toBeNull();
    },
  );
});

describe("router → entityMentions", () => {
  it.each([
    ["покажи ми всички данни за INSAIT, ИНСАИТ", "INSAIT, ИНСАИТ"],
    ["Къде се споменава Sofia Tech Park?", "Sofia Tech Park"],
  ])("%s", (q, term) => {
    expect(route(q, ctx)).toEqual({ tool: "entityMentions", args: { term } });
  });

  it.each(["INSAIT", "ИНСАИТ"])("a bare acronym: %s", (q) => {
    expect(route(q, ctx)?.tool).toBe("entityMentions");
  });

  it("leaves the place dashboard alone", () => {
    expect(route("всичко за Пловдив", ctx)?.tool).not.toBe("entityMentions");
  });
});
