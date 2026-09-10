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
          ? ["New chat", "Tools", "Accuracy"]
          : ["Нов чат", "Инструменти", "Точност"];
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
        `${prefix}/chat/tools?area=56784`,
      );
      fireEvent.click(screen.getByRole("button", { name: labels[2] }));
      expect(navigate).toHaveBeenLastCalledWith(
        `${prefix}/chat/evals?area=56784`,
      );
      expect(screen.queryByRole("img")).toBeNull();
    });
  });
}
