import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { App } from "./App";

describe("news shell accessibility", () => {
  it("offers a skip link, identifies the theme action and distinguishes inline links", async () => {
    const setTheme = vi.fn();
    const user = userEvent.setup();
    render(
      <ThemeContext.Provider value={{ theme: themeDark, setTheme }}>
        <MemoryRouter initialEntries={["/missing"]}>
          <App />
        </MemoryRouter>
      </ThemeContext.Provider>,
    );

    expect(
      screen.getByRole("link", { name: "Към основното съдържание" }),
    ).toHaveAttribute("href", "#news-main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "news-main");
    expect(screen.getByRole("link", { name: "Към историите" })).toHaveClass(
      "underline",
    );

    await user.click(
      screen.getByRole("button", { name: "Включи светла тема" }),
    );
    expect(setTheme).toHaveBeenCalledWith(themeLight);
  });
});
