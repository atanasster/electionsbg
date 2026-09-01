import { render, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("link", { name: "за редакцията" })).toHaveAttribute(
      "href",
      "/about",
    );
    expect(screen.getByRole("link", { name: "поправки" })).toHaveAttribute(
      "href",
      "/corrections",
    );
    expect(screen.getAllByRole("link", { name: "Методология" })).toHaveLength(
      1,
    );
    const footer = within(screen.getByRole("contentinfo"));
    expect(
      footer.getByRole("link", { name: "electionsbg.com" }),
    ).toHaveTextContent("electionsbg.com");
    expect(
      footer.getByRole("link", { name: "за редакцията" }),
    ).toHaveTextContent("за редакцията");

    await user.click(
      screen.getByRole("button", { name: "Включи светла тема" }),
    );
    expect(setTheme).toHaveBeenCalledWith(themeLight);
  });

  it("keeps low-frequency destinations in an accessible compact menu", async () => {
    const user = userEvent.setup();
    render(
      <ThemeContext.Provider value={{ theme: themeLight, setTheme: vi.fn() }}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </ThemeContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Отвори менюто" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Истории" }),
    ).toHaveAttribute("href", "/");
    expect(
      within(menu).getByRole("menuitem", { name: "Методология" }),
    ).toHaveAttribute("href", "/methodology");
    expect(
      screen.getByRole("link", { name: "Търсене в новините" }),
    ).toHaveAttribute("href", "/#news-search");
  });

  it("renders the corrections workflow at its public route", () => {
    render(
      <ThemeContext.Provider value={{ theme: themeLight, setTheme: vi.fn() }}>
        <MemoryRouter initialEntries={["/corrections"]}>
          <App />
        </MemoryRouter>
      </ThemeContext.Provider>,
    );
    expect(
      screen.getByRole("heading", { name: "Поправки и право на отговор" }),
    ).toBeVisible();
  });

  it("renders a complete English shell with route-preserving language links", () => {
    render(
      <ThemeContext.Provider value={{ theme: themeLight, setTheme: vi.fn() }}>
        <MemoryRouter initialEntries={["/missing?from=test"]}>
          <App language="en" />
        </MemoryRouter>
      </ThemeContext.Provider>,
    );

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Страницата не е намерена"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toBeVisible();
    const switcher = screen.getByRole("group", { name: "Language" });
    expect(within(switcher).getByRole("link", { name: "BG" })).toHaveAttribute(
      "href",
      "/missing?from=test",
    );
    expect(within(switcher).getByRole("link", { name: "EN" })).toHaveAttribute(
      "href",
      "/en/missing?from=test",
    );
  });
});
