import { expect, it } from "vitest";
import { chatView, normalizeChatUrl } from "./chatRoute";

it("normalizes explicit legacy language both ways without losing question, tool or fragment state", () => {
  for (const view of ["chat", "chat/tools", "chat/evals"]) {
    const state = "q=hello&area=68134&args=%7B%7D#source";
    expect(
      normalizeChatUrl(`https://electionsbg.com/en/${view}/?lang=bg&${state}`),
    ).toBe(`https://electionsbg.com/${view}?${state}`);
    expect(
      normalizeChatUrl(`https://electionsbg.com/${view}?lang=en&${state}`),
    ).toBe(`https://electionsbg.com/en/${view}?${state}`);
    const matching = `https://electionsbg.com/en/${view}?${state}`;
    expect(normalizeChatUrl(matching)).toBe(matching);
    expect(
      normalizeChatUrl(`https://electionsbg.com/en/${view}?lang=en&${state}`),
    ).toBe(matching);
  }
});

it("selects the same screen for slash and language variants", () => {
  for (const language of ["", "/en"])
    for (const slash of ["", "/"]) {
      expect(chatView(`${language}/chat${slash}`)).toBe("chat");
      expect(chatView(`${language}/chat/tools${slash}`)).toBe("tools");
      expect(chatView(`${language}/chat/evals${slash}`)).toBe("evals");
    }
});
