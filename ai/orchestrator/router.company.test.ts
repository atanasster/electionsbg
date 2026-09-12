import { describe, expect, it } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;

describe("company-profile routing", () => {
  it.each([
    ["Фирма провиотик", "провиотик"],
    ["Кажи ми за фирма ПроВиотик", "ПроВиотик"],
    ["Разкажи ми за компания Провиотик", "Провиотик"],
    ["Tell me about company Proviotic", "Proviotic"],
    ["Покажи профила на фирма 202930997", "202930997"],
  ])("routes a general company question: %s", (question, company) => {
    expect(route(question, ctx)).toEqual({
      tool: "companyProfile",
      args: { company },
    });
  });

  it("keeps a 9-digit company EIK out of the polling-section route", () => {
    expect(route("Покажи профила на фирма 202930997", ctx)?.tool).not.toBe(
      "sectionResults",
    );
  });

  it.each([
    ["Покажи договорите на фирма Провиотик", "contractSearch"],
    ["Какви политически връзки има фирма 202930997?", "companyConnections"],
  ])("preserves the narrower intent: %s", (question, expected) => {
    expect(route(question, ctx)?.tool).toBe(expected);
  });
});

it.each([
  "Свързана ли е Метро кеш енд кери България ЕООД - София с лица от властта?",
  "Is Metro Cash and Carry Bulgaria connected to public officials?",
])("resolves a typed chain connections follow-up by EIK: %s", (q) => {
  expect(route(q, ctx)).toEqual({
    tool: "companyConnections",
    args: { company: "121644736" },
  });
});

it("prefers an explicit company EIK over a chain alias for political connections", () => {
  expect(
    route("Свързана ли е фирма Метро ЕИК 202930997 с лица от властта?", ctx),
  ).toEqual({
    tool: "companyConnections",
    args: { company: "202930997" },
  });
});
