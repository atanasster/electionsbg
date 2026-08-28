import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { correctionIssueUrl } from "../corrections";
import { CorrectionsScreen } from "./CorrectionsScreen";

describe("corrections workflow", () => {
  it("publishes the process, privacy warning, public channel and empty log honestly", () => {
    render(
      <MemoryRouter>
        <CorrectionsScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Поправки и право на отговор" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Не изпращайте лични или чувствителни данни/),
    ).toBeVisible();
    expect(screen.getByText(/Няма публикувани поправки/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Сигнализирай проблем/ }),
    ).toHaveAttribute("href", correctionIssueUrl());
  });

  it("prefills only a safe first-party page address", () => {
    expect(decodeURIComponent(correctionIssueUrl("/story/a"))).toContain(
      "https://news.electionsbg.com/story/a",
    );
    expect(
      decodeURIComponent(correctionIssueUrl("//hostile.example")),
    ).not.toContain("hostile.example");
    for (const unsafe of [
      "/story/a?email=person@example.com",
      "/story/a#token",
      "/story/a%0Asecret",
      "/story/a\\secret",
      "https://hostile.example/story/a",
      "/outlets",
    ]) {
      const body = new URL(correctionIssueUrl(unsafe)).searchParams.get("body");
      expect(body).toContain("(добавете точния адрес)");
      expect(body).not.toContain(unsafe);
    }
  });

  it("renders ordered registry entries with affected-page provenance", () => {
    render(
      <MemoryRouter>
        <CorrectionsScreen
          entries={[
            {
              id: "one",
              date: "2026-08-27",
              path: "/story/a",
              kind: "поправка",
              note: "Първа промяна",
            },
            {
              id: "two",
              date: "2026-08-28",
              path: "/story/a",
              kind: "оттегляне",
              note: "Втора промяна",
            },
          ]}
        />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link", {
      name: "Засегната страница",
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/story/a");
    const log = screen.getByRole("heading", {
      name: "Публичен регистър",
    }).parentElement!;
    expect(log.querySelectorAll("li")[0]).toHaveTextContent(
      "2026-08-28 · оттегляне — Втора промяна",
    );
  });
});
