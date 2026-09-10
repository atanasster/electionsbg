// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { navigateView, parseToolsLocation } from "./urlState";
it("delegates integrated transitions to the host and retains active tool settings", () => {
  const navigate = vi.fn();
  const navigation = {
    pathname: "/en/chat/tools",
    search: "?v=1&tool=budgetVariance&area=68134",
    lang: "en" as const,
    navigate,
  };
  navigateView("tools", "tools", navigation);
  expect(navigate).not.toHaveBeenCalled();
  navigateView("tools", "chat", navigation);
  expect(navigate).toHaveBeenCalledWith("/en/chat?area=68134");
});
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
