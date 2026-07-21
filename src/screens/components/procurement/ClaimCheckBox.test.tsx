// Component-level guard for the fact-check on-ramp: the "Провери" button is
// disabled until the pasted claim yields a distinctive term, and pressing it
// navigates to the seeded /procurement/project?q= dossier. The extraction itself
// is covered by claimSeed.test.ts; this pins the disabled→enabled→navigate wiring.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigateMock };
});

import { ClaimCheckBox } from "./ClaimCheckBox";

const renderBox = () =>
  render(
    <MemoryRouter>
      <ClaimCheckBox />
    </MemoryRouter>,
  );

describe("ClaimCheckBox", () => {
  beforeEach(() => navigateMock.mockClear());

  it("keeps the button disabled until a distinctive term is entered", () => {
    renderBox();
    const btn = screen.getByRole("button", { name: "Провери" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Твърдение за проверка"), {
      target: { value: "Видин–Ботевград взе 35% аванс" },
    });
    expect(btn).toBeEnabled();
  });

  it("navigates to the seeded dossier on submit", () => {
    renderBox();
    fireEvent.change(screen.getByLabelText("Твърдение за проверка"), {
      target: { value: "Видин–Ботевград взе 35% аванс" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Провери" }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const to = navigateMock.mock.calls[0][0] as string;
    expect(to).toMatch(/^\/procurement\/project\?q=/);
    expect(decodeURIComponent(to)).toContain("Видин–Ботевград");
  });
});
