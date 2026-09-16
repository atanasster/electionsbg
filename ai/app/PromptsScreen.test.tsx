import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatNavigationContext } from "./navigation";
import { PromptsScreen } from "./PromptsScreen";
import * as chatStorage from "./chatStorage";

describe("PromptsScreen", { timeout: 30_000 }, () => {
  const setup = (lang: "bg" | "en" = "bg") => {
    const navigate = vi.fn();
    const prefix = lang === "en" ? "/en" : "";
    const renderResult = render(
      <ChatNavigationContext.Provider
        value={{
          pathname: `${prefix}/chat/prompts`,
          search: "",
          lang,
          navigate,
        }}
      >
        <PromptsScreen integrated />
      </ChatNavigationContext.Provider>,
    );
    return { navigate, renderResult };
  };

  it("renders page header, TOC and starter prompts in Bulgarian", () => {
    setup("bg");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Примерни въпроси за Наясно AI/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Всички теми/i }),
    ).toBeInTheDocument();

    // Check that prompt cards are rendered
    const articles = screen.getAllByRole("article");
    expect(articles.length).toBeGreaterThan(10);
  });

  it("renders in English with correct translations", () => {
    setup("en");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Sample Prompts for Naiasno AI/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /All topics/i }),
    ).toBeInTheDocument();
  });

  it("filters prompts when a topic category is clicked", () => {
    setup("bg");

    // Click on "Избори" category in TOC navigation
    const nav = screen.getByRole("navigation");
    const electionsBtn = within(nav).getByRole("button", { name: "Избори" });
    fireEvent.click(electionsBtn);

    // Active filter banner should show "Покажи всички" button
    expect(
      screen.getByRole("button", { name: /Покажи всички/i }),
    ).toBeInTheDocument();
  });

  it("filters prompts when search input is typed into", () => {
    setup("bg");

    const searchInput = screen.getByRole("searchbox", {
      name: /Търсене на въпроси/i,
    });
    fireEvent.change(searchInput, { target: { value: "парламентарни" } });

    // Should find matching prompts
    const articles = screen.getAllByRole("article");
    expect(articles.length).toBeGreaterThan(0);

    // Clear search
    const clearBtn = screen.getByRole("button", { name: /Изчисти търсенето/i });
    fireEvent.click(clearBtn);
    expect(searchInput).toHaveValue("");
  });

  it("shows empty state when search has no matches", () => {
    setup("bg");

    const searchInput = screen.getByRole("searchbox", {
      name: /Търсене на въпроси/i,
    });
    fireEvent.change(searchInput, {
      target: { value: "абвгдежзийклмнопрстуфхцчшщъьюяненамирасе" },
    });

    expect(screen.getByText(/Няма намерени въпроси/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Изчисти филтрите/i }),
    ).toBeInTheDocument();

    // Click clear filters
    fireEvent.click(screen.getByRole("button", { name: /Изчисти филтрите/i }));
    expect(screen.queryByText(/Няма намерени въпроси/i)).toBeNull();
  });

  it("launches the prompt into chat when clicked", () => {
    const clearSpy = vi.spyOn(chatStorage, "clearSavedChat");
    const { navigate } = setup("bg");

    const tryLinks = screen.getAllByText("Пробвай в чата");
    expect(tryLinks.length).toBeGreaterThan(0);
    expect(tryLinks[0].closest("a")?.className).toContain(
      "text-popover-foreground",
    );

    const firstPrompt = screen.getAllByRole("article")[0];
    const promptText = firstPrompt.querySelector("p")?.textContent ?? "";
    expect(promptText).toBeTruthy();

    fireEvent.click(firstPrompt);

    expect(clearSpy).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      `/chat?q=${encodeURIComponent(promptText)}`,
    );
    clearSpy.mockRestore();
  });

  it("launches the prompt into /en/chat when in English", () => {
    const clearSpy = vi.spyOn(chatStorage, "clearSavedChat");
    const { navigate } = setup("en");

    const tryLinks = screen.getAllByText("Try in chat");
    expect(tryLinks.length).toBeGreaterThan(0);
    expect(tryLinks[0].closest("a")?.className).toContain(
      "text-popover-foreground",
    );

    const firstPrompt = screen.getAllByRole("article")[0];
    const promptText = firstPrompt.querySelector("p")?.textContent ?? "";
    expect(promptText).toBeTruthy();

    fireEvent.click(firstPrompt);

    expect(clearSpy).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      `/en/chat?q=${encodeURIComponent(promptText)}`,
    );
    clearSpy.mockRestore();
  });

  it("keeps the sidebar sticky and does not trap scrolling in the outer container", () => {
    const { renderResult } = setup("bg");
    const container = renderResult.container.firstElementChild as HTMLElement;
    expect(container.className).not.toContain("overflow-y-auto");

    const aside = screen.getByRole("complementary", {
      name: /Съдържание по теми/i,
    });
    expect(aside.className).toContain("lg:sticky");
    expect(aside.className).toContain("lg:self-start");

    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain("overflow-y-auto");
  });
});
