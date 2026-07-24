// Router precedence gate for the person tools (plan §7d, risk #1b — a new branch must not
// hijack an incumbent intent). Hermetic: route() is a pure heuristic function.

import { describe, it, expect } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2026_04_19" } as ToolContext;
const tool = (q: string): string | null => route(q, ctx)?.tool ?? null;

describe("person-tool routing", () => {
  // personConnections — a name + a "connected people" cue, no EIK, no procurement word.
  it.each([
    "С кого е свързан Бойко Борисов?",
    "Кои са свързаните лица на Делян Пеевски?",
    "Какви са връзките на Бойко Борисов?",
    "Who is Boyko Borisov connected to?",
  ])("routes to personConnections: %s", (q) => {
    const r = route(q, ctx);
    expect(r?.tool).toBe("personConnections");
    expect(r?.args.name).toBeTruthy();
  });

  // personProfile — a name + a profile / business cue.
  it.each([
    "Какъв е профилът на Бойко Борисов?",
    "Какви фирми притежава Делян Пеевски?",
    "Покажи фирмите на Бойко Борисов",
    "Кои дружества притежава Корнелия Нинова?",
    "Санкциониран ли е Делян Пеевски?",
    "Is Boyko Borisov under sanctions?",
    "Има ли досие Георги Първанов?",
    "Бил ли е агент на ДС Ахмед Доган?",
    "Was Georgi Parvanov an agent of State Security?",
    "В кой независим орган е Павлина Панова?",
    "Член ли е на регулатор Димитър Радев?",
  ])("routes to personProfile: %s", (q) => {
    const r = route(q, ctx);
    expect(r?.tool).toBe("personProfile");
    expect(r?.args.name).toBeTruthy();
  });

  // personWealth — a name + a declared-wealth cue. Must win over the generic profile.
  it.each([
    "Какво имущество е декларирал Бойко Борисов?",
    "Каква е нетната стойност на Делян Пеевски?",
    "Покажи активите и задълженията на Кирил Петков",
    "Колко е декларирал Иван Демерджиев?",
    "What wealth has Boyko Borisov declared?",
    "What is the declared net worth of Delyan Peevski?",
  ])("routes to personWealth: %s", (q) => {
    const r = route(q, ctx);
    expect(r?.tool).toBe("personWealth");
    expect(r?.args.name).toBeTruthy();
  });

  // A wealth-adjacent word must NOT hijack a procurement question — "спечелил от
  // поръчки" is public money won, not declared personal wealth.
  it("leaves a procurement question on its own branch", () => {
    expect(tool("Колко е спечелил от поръчки Бойко Борисов?")).not.toBe(
      "personWealth",
    );
  });
});

describe("no-hijack: incumbent intents route unchanged", () => {
  // A frozen corpus whose vocabulary overlaps the new branches ("свързан", "профил",
  // "фирми", a person name) but must still reach the SAME incumbent tool as before.
  const frozen: [string, string][] = [
    // company-connections stays on the EIK path (a 9+ digit number present)
    ["Какви политически връзки има фирма 831646048?", "companyConnections"],
    // procurement + a person name + "свързан" stays on mpProcurement (procurement word)
    [
      "Какви обществени поръчки са спечелили свързани с Бойко Борисов фирми?",
      "mpProcurement",
    ],
    // roll-call "профил" stays on the voting profile
    ["Как гласува Бойко Борисов в парламента?", "mpVotingProfile"],
    // "гласува като" stays on similarity
    ["Кой депутат гласува като Бойко Борисов?", "mpSimilarity"],
  ];
  it.each(frozen)("%s -> %s", (q, expected) => {
    expect(tool(q)).toBe(expected);
  });

  // These have overlapping words but NO person name -> must NOT be grabbed by the person
  // branches (they route wherever they did before — the point is they are not person*).
  it.each([
    "Кои са свързаните фирми в обществените поръчки?",
    "Какъв е профилът на социологическите агенции по точност?",
  ])("not a person tool: %s", (q) => {
    expect(tool(q)).not.toBe("personProfile");
    expect(tool(q)).not.toBe("personConnections");
  });
});
