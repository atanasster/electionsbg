import { describe, expect, it } from "vitest";
import rawPrompts from "./starterPrompts.json";
import { toChatQuestionIntent } from "./questionAdapter";
import { questionById } from "../../src/lib/questions/catalog";

describe("chat question adapter", () => {
  it.each(rawPrompts)("preserves $id chat intent", (prompt) => {
    for (const lang of ["bg", "en"] as const) {
      const intent = toChatQuestionIntent(prompt.id, lang, prompt.args[lang]);
      const expectedArgs = {
        ...prompt.args[lang],
        ...(prompt.id === "openTenders" ? { year: 2025 } : {}),
      };
      expect(intent).toEqual({
        questionId: prompt.id,
        text: prompt[lang],
        tool: prompt.tool,
        args: expectedArgs,
      });
    }
  });

  it.each(rawPrompts)(
    "preserves $id legacy scope through selector dispatch",
    (prompt) => {
      for (const lang of ["bg", "en"] as const) {
        const intent = toChatQuestionIntent(prompt.id, lang, {});
        const expectedArgs = {
          ...prompt.args[lang],
          ...(prompt.id === "openTenders" ? { year: 2025 } : {}),
        };
        expect(intent.args).toEqual(expectedArgs);
      }
    },
  );

  it("uses the language-specific compatibility fixture when no values are supplied", () => {
    expect(questionById("partyResult")?.defaults).toEqual({});
    expect(toChatQuestionIntent("partyResult", "bg").args).toEqual({
      party: "герб",
    });
    expect(toChatQuestionIntent("partyResult", "en").args).toEqual({
      party: "gerb",
    });
  });

  it("overlays a selector value and shows the exact executed entity", () => {
    const intent = toChatQuestionIntent("companyConnections", "bg", {
      company: "000012345",
    });
    expect(intent.args.company).toBe("000012345");
    expect(intent.text).toContain("000012345");
    expect(intent.text).not.toContain("831646048");
  });
});
