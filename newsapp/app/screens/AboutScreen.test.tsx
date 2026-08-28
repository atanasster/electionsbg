import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AboutScreen } from "./AboutScreen";

describe("AboutScreen", () => {
  it("states mission, responsibility and editorial principles", () => {
    render(
      <MemoryRouter>
        <AboutScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "За Наясно Новини" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Кой носи отговорност" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Редакционни принципи" }),
    ).toBeVisible();
    expect(screen.getByText(/Мартин Стоянов и Атанас Стоянов/)).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Собственост и финансиране" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Поправки и право на отговор" }),
    ).toBeVisible();
    expect(screen.getByText(/не твърдим институционална/)).toBeVisible();
    expect(
      screen.getByText(/Началната страница показва само анализирани истории/),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Методология" })).toHaveAttribute(
      "href",
      "/methodology",
    );
  });

  it("publishes all transparency destinations with meaningful names", () => {
    render(
      <MemoryRouter>
        <AboutScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Отворен код" })).toHaveAttribute(
      "href",
      "https://github.com/atanasster/electionsbg",
    );
    expect(
      screen.getByRole("link", { name: "За екипа на electionsbg.com" }),
    ).toHaveAttribute("href", "https://electionsbg.com/about");
  });

  it("uses a public reporting channel and warns against sensitive data", () => {
    render(
      <MemoryRouter>
        <AboutScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Не изпращайте лични или чувствителни данни/),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Отвори сигнал/ })).toHaveAttribute(
      "href",
      "https://github.com/atanasster/electionsbg/issues",
    );
  });
});
