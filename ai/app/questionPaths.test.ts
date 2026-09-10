// @vitest-environment jsdom
import { createElement } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmptyHero } from "./hero/EmptyHero";
import { questionById } from "../../src/lib/questions/catalog";
import { route } from "../orchestrator/router";
import { followUps } from "./followups";
import type { Envelope } from "../tools/types";
afterEach(cleanup);
for (const lang of ["bg", "en"] as const) {
  it(`hero buttons dispatch intended question identities in ${lang}`, () => {
    const pick = vi.fn();
    const view = render(createElement(EmptyHero, { lang, onPick: pick }));
    for (const id of [
      "nationalResults",
      "turnoutSeries",
      "regionResults",
      "parliamentSeats",
      "budgetOverview",
    ]) {
      fireEvent.click(
        view.getByRole("button", { name: questionById(id)!.question[lang] }),
      );
      expect(pick).toHaveBeenLastCalledWith(id);
    }
  });
  it(`functional spending works without acronym in ${lang}`, () => {
    const text =
      lang === "bg"
        ? "Разходи на държавното управление по функции през 2024?"
        : "Government spending by function in 2024?";
    expect(route(text, { lang, election: "2026_04_19" })).toEqual({
      tool: "budgetByFunction",
      args: { year: 2024 },
    });
  });
}
it("budget follow-ups stay in the budget topic", () => {
  const prompts = followUps({
    tool: "budgetByFunction",
    facts: {},
  } as Envelope);
  expect(prompts.length).toBeGreaterThan(0);
  for (const p of prompts)
    for (const lang of ["bg", "en"] as const)
      expect(
        route(p[lang], { lang, election: "2026_04_19" })?.tool,
      ).not.toMatch(/nationalResults|turnout/);
});
