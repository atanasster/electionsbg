import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatNavigationContext } from "./navigation";
import { chatToolbarPath } from "./navigationPaths";
import { ChatToolbar } from "./ChatToolbar";

for (const lang of ["bg", "en"] as const) {
  describe(`integrated toolbar ${lang}`, () => {
    it("offers only new chat, tools and accuracy with site language and routes", () => {
      const navigate = vi.fn();
      const onNewChat = vi.fn();
      const prefix = lang === "en" ? "/en" : "";
      render(
        <ChatNavigationContext.Provider
          value={{
            pathname: `${prefix}/chat`,
            search: "?area=56784&q=private&tool=old",
            lang,
            navigate,
          }}
        >
          <ChatToolbar onNewChat={onNewChat} />
        </ChatNavigationContext.Provider>,
      );
      const labels =
        lang === "en"
          ? ["New chat", "Prompts", "Tools", "Accuracy"]
          : ["Нов чат", "Въпроси", "Инструменти", "Точност"];
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(
        labels,
      );
      fireEvent.click(screen.getByRole("button", { name: labels[0] }));
      expect(onNewChat).toHaveBeenCalledOnce();
      expect(
        chatToolbarPath("chat", `${prefix}/chat`, "?area=56784&q=private"),
      ).toBe(`${prefix}/chat?area=56784`);
      fireEvent.click(screen.getByRole("button", { name: labels[1] }));
      expect(navigate).toHaveBeenLastCalledWith(
        `${prefix}/chat/prompts?area=56784`,
      );
      fireEvent.click(screen.getByRole("button", { name: labels[2] }));
      expect(navigate).toHaveBeenLastCalledWith(
        `${prefix}/chat/tools?area=56784`,
      );
      fireEvent.click(screen.getByRole("button", { name: labels[3] }));
      expect(navigate).toHaveBeenLastCalledWith(
        `${prefix}/chat/evals?area=56784`,
      );
      expect(screen.queryByRole("img")).toBeNull();
      // Ensure buttons contain only clean text without svg icons
      for (const btn of screen.getAllByRole("button")) {
        expect(btn.querySelector("svg")).toBeNull();
      }
    });

    it("highlights active tab matching the current route", () => {
      const prefix = lang === "en" ? "/en" : "";
      const { rerender } = render(
        <ChatNavigationContext.Provider
          value={{
            pathname: `${prefix}/chat/prompts`,
            search: "",
            lang,
            navigate: vi.fn(),
          }}
        >
          <ChatToolbar onNewChat={vi.fn()} />
        </ChatNavigationContext.Provider>,
      );

      const promptBtn = screen.getByRole("button", {
        name: lang === "en" ? "Prompts" : "Въпроси",
      });
      expect(promptBtn.getAttribute("aria-current")).toBe("page");
      expect(promptBtn.className).toContain("border-primary/50");

      rerender(
        <ChatNavigationContext.Provider
          value={{
            pathname: `${prefix}/chat/tools`,
            search: "",
            lang,
            navigate: vi.fn(),
          }}
        >
          <ChatToolbar onNewChat={vi.fn()} />
        </ChatNavigationContext.Provider>,
      );

      const toolsBtn = screen.getByRole("button", {
        name: lang === "en" ? "Tools" : "Инструменти",
      });
      expect(toolsBtn.getAttribute("aria-current")).toBe("page");
      expect(toolsBtn.className).toContain("border-primary/50");
    });

    it("keeps z-index below the fixed header (z-10) so the search dropdown is not occluded", () => {
      render(
        <ChatNavigationContext.Provider
          value={{
            pathname: "/chat",
            search: "",
            lang,
            navigate: vi.fn(),
          }}
        >
          <ChatToolbar onNewChat={vi.fn()} />
        </ChatNavigationContext.Provider>,
      );
      const toolbar = screen.getByRole("navigation", {
        name: lang === "en" ? "Chat actions" : "Действия за чата",
      });
      expect(toolbar.className).toContain("z-[9]");
      expect(toolbar.className).not.toContain("z-20");
      expect(toolbar.className).not.toMatch(/\bz-(1\d|[2-9]\d)\b/);
    });
  });
}
