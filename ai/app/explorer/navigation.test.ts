// @vitest-environment jsdom
import { expect, it } from "vitest";
import { navigateView, parseToolsLocation } from "./urlState";
it("keeps active Tools unchanged and coordinates Chat to catalogue navigation", () => {
  window.history.replaceState(null, "", "/tools?v=1&tool=budgetVariance");
  let visible = parseToolsLocation(window.location.search).tool;
  const restore = () => {
    visible = parseToolsLocation(window.location.search).tool;
  };
  window.addEventListener("popstate", restore);
  navigateView("tools", "tools");
  expect(visible).toBe("budgetVariance");
  expect(parseToolsLocation(window.location.search).tool).toBe(visible);
  navigateView("tools", "chat");
  navigateView("chat", "tools");
  expect(window.location.pathname).toBe("/tools");
  expect(visible).toBeUndefined();
  expect(parseToolsLocation(window.location.search).tool).toBe(visible);
  window.removeEventListener("popstate", restore);
});
