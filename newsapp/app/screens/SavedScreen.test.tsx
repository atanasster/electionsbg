import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_NEWS_KEY, savedStoryIds } from "../components/savedNews";
import { SavedScreen } from "./SavedScreen";

// ⚠️ The screen no longer reads `useStories` — it fetches one ~1.4 KB
// detail file per saved id instead of the 1,456 KB corpus. This mock
// stands in for that hook; `titles` deliberately distinguishes THREE
// states, because the screen must too: absent = still loading, null = the
// story no longer exists (stories merge), a value = the title.
const savedTitles = vi.hoisted(() => ({
  current: {
    titles: new Map<string, unknown>([
      ["a", { id: "a", title_bg: "Проверена история", title_en: null }],
    ]),
    loading: false,
  },
  // ⚠️ RECORDED, because the mock ignoring its arguments is exactly how
  // these tests were vacuous about the change's whole point: every one of
  // them passed on a screen that asked for the wrong ids, or did not call
  // the hook at all.
  asked: [] as string[][],
}));

vi.mock("../data", () => ({
  useStoryTitles: (ids: string[]) => {
    savedTitles.asked.push([...ids]);
    return savedTitles.current;
  },
  useLatest: () => ({
    data: {
      articles: [
        { domain: "example.bg", id: "x", title: "Първа статия" },
        { domain: "example.bg", id: "y", title: "Втора статия" },
        {
          domain: "pik.bg",
          id: "20260821-българия-a1",
          title: "Статия с кирилски адрес",
        },
      ],
    },
  }),
}));

describe("SavedScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    savedTitles.asked = [];
    savedTitles.current = {
      titles: new Map<string, unknown>([
        ["a", { id: "a", title_bg: "Проверена история", title_en: null }],
      ]),
      loading: false,
    };
  });

  const renderSaved = (paths: string[]) => {
    localStorage.setItem(SAVED_NEWS_KEY, JSON.stringify(paths));
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
  };

  it("asks only for the stories that were saved", () => {
    // ⚠️ THE WHOLE POINT OF THE CHANGE, asserted against what the SCREEN
    // requests rather than against the helper alone. This was the last
    // screen downloading the entire 1,456 KB corpus to read a handful of
    // titles, and a helper test cannot tell whether the screen uses it —
    // the mock ignored its arguments, so every test here passed on a
    // screen that asked for the wrong ids or never called the hook.
    renderSaved(["/story/a", "/article/example.bg/x", "/story/a", "/story/b"]);
    expect(savedTitles.asked.at(-1)).toEqual(["a", "b"]);
  });

  it("asks for nothing when only articles are saved", () => {
    renderSaved(["/article/example.bg/x"]);
    expect(savedTitles.asked.at(-1)).toEqual([]);
  });

  it("stops asking for a story the reader removes", () => {
    renderSaved(["/story/a", "/story/b"]);
    fireEvent.click(
      screen.getByRole("button", { name: /Премахни Проверена история/ }),
    );
    expect(savedTitles.asked.at(-1)).toEqual(["b"]);
  });

  it("derives the ids from the saved paths", () => {
    expect(
      savedStoryIds(["/story/a", "/article/x/y", "/story/a", "/story/b"]),
    ).toEqual(["a", "b"]);
    expect(savedStoryIds(["/article/example.bg/x"])).toEqual([]);
  });

  it("says a story is loading rather than calling it gone", () => {
    // ⚠️ Collapsing "not yet fetched" into "no longer available" tells a
    // reader their saved item has disappeared every time the page opens.
    savedTitles.current = { titles: new Map(), loading: true };
    renderSaved(["/story/a"]);
    expect(screen.getByRole("link", { name: "Зарежда се…" })).toBeVisible();
  });

  it("does not call an unreachable story merged away", () => {
    // ⚠️ THE DEFECT THIS REPLACED. A bare `catch` rendered EVERY failure
    // as "no longer a separate story", so an offline reader was told
    // every story they had saved was gone. A 404 is the release stating
    // an absence; a 502 is us failing to ask.
    savedTitles.current = {
      titles: new Map<string, unknown>([["a", "failed"]]),
      loading: false,
    };
    renderSaved(["/story/a"]);
    expect(
      screen.getByRole("link", { name: "Заглавието не можа да се зареди" }),
    ).toHaveAttribute("href", "/story/a");
  });

  it("says a merged-away story is no longer separate", () => {
    // Stories merge, so a saved id can stop existing and its file 404s.
    // The row stays, with an explanation — dropping it would make a
    // reader's saved item vanish silently.
    savedTitles.current = {
      titles: new Map<string, unknown>([["a", "gone"]]),
      loading: false,
    };
    renderSaved(["/story/a"]);
    expect(
      screen.getByRole("link", { name: "Историята вече не е отделна" }),
    ).toHaveAttribute("href", "/story/a");
  });

  it("explains empty browser-local storage", () => {
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText(/само в този браузър/)).toBeVisible();
    expect(screen.getByText(/Още няма запазени/)).toBeVisible();
  });

  it("resolves links and supports per-item and clear-all deletion", () => {
    localStorage.setItem(
      SAVED_NEWS_KEY,
      JSON.stringify(["/story/a", "/article/example.bg/x"]),
    );
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "Проверена история" }),
    ).toHaveAttribute("href", "/story/a");
    fireEvent.click(
      screen.getByRole("button", { name: /Премахни Проверена история/ }),
    );
    expect(JSON.parse(localStorage.getItem(SAVED_NEWS_KEY) ?? "[]")).toEqual([
      "/article/example.bg/x",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Изчисти всички" }));
    expect(screen.getByText(/Още няма запазени/)).toBeVisible();
  });

  it("gives same-outlet articles distinct titles and removal names", () => {
    localStorage.setItem(
      SAVED_NEWS_KEY,
      JSON.stringify(["/article/example.bg/x", "/article/example.bg/y"]),
    );
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Първа статия" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Втора статия" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Премахни Първа статия" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Премахни Втора статия" }),
    ).toBeVisible();
  });

  it("announces denied removal and preserves the list", () => {
    localStorage.setItem(SAVED_NEWS_KEY, JSON.stringify(["/story/a"]));
    render(
      <MemoryRouter>
        <SavedScreen persistSaved={() => false} />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Премахни Проверена история" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Браузърът не позволи промяната",
    );
    expect(
      screen.getByRole("link", { name: "Проверена история" }),
    ).toBeVisible();
  });

  it("renders a saved article whose corpus id contains Cyrillic", () => {
    localStorage.setItem(
      SAVED_NEWS_KEY,
      JSON.stringify(["/article/pik.bg/20260821-българия-a1"]),
    );
    render(
      <MemoryRouter>
        <SavedScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "Статия с кирилски адрес" }),
    ).toHaveAttribute("href", "/article/pik.bg/20260821-българия-a1");
  });
});
