import { expect, it } from "vitest";
import { containsChatState } from "./chatAnalyticsPrivacy";

it("recognizes prompt and tool state even on navigation away from chat", () => {
  const base = "https://electionsbg.com";
  for (const value of [
    "/chat?q=hello",
    "/en/chat/tools?args=%7B%7D",
    "https://ai.electionsbg.com/?q=hello",
    "/?q=",
  ])
    expect(containsChatState(value, base)).toBe(true);
  for (const value of [
    "/chat",
    "/chat?area=68134",
    "",
    "/articles/chat-launch",
  ])
    expect(containsChatState(value, base)).toBe(false);
});
