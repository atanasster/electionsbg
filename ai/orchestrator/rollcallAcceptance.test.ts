import { expect, it } from "vitest";
import { route } from "./router";
import type { ToolContext } from "../tools/types";
const ctx = { lang: "bg", election: "2024_10_27" } as ToolContext;
// Screenshot and identity regressions must use the scoped legislative route.
it.each([
  ["покажи ми последните заседания на парламента", "parliamentSessions"],
  ["покажи ми последните гласувания в парламента", "parliamentVotes"],
  ["Кои са последните 10 гласувания на Бойко Рашков?", "parliamentCasts"],
  [
    "Покажи решенията на общинския съвет в Русе за бюджета през 2025",
    "councilResolutions",
  ],
])("captures legislative scope: %s", (prompt, corpus) => {
  const result = route(prompt, ctx);
  expect(result?.tool).toBe("rollcallQuestion");
  expect(result?.args).toMatchObject({ question: prompt, corpus });
});
it.each([
  ["Show me the latest parliament sittings.", "parliamentSessions"],
  ["Show me the latest votes in parliament.", "parliamentVotes"],
  ["What are Boyko Rashkov's last 10 votes?", "parliamentCasts"],
  [
    "Как гласува съветникът Иван Иванов в Русе за бюджета през 2025?",
    "councilCasts",
  ],
  [
    "How did councillor Ivan Ivanov vote in Ruse on the budget in 2025?",
    "councilCasts",
  ],
])("captures named and English legislative scope: %s", (prompt, corpus) => {
  expect(route(prompt, ctx)).toMatchObject({
    tool: "rollcallQuestion",
    args: { question: prompt, corpus },
  });
});
it.each([
  "Какви са резултатите от парламентарните избори през 2021?",
  "Колко места има ГЕРБ в общинския съвет в Русе?",
  "Как гласува Висшият съдебен съвет?",
  "Show parliamentary election results for 2021.",
  "Show municipal council election seats in Ruse.",
  "How did the Supreme Judicial Council vote?",
])("does not hijack electoral or judicial questions: %s", (prompt) => {
  expect(["rollcallQuestion", "rollcallQuery"]).not.toContain(
    route(prompt, ctx)?.tool,
  );
});
