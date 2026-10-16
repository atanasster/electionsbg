// A10: the per-unit bars are coloured against the SAME-window national rate, and
// stay neutral when no matched baseline exists — never a fixed 35%/60% threshold.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TransportCompetitionTile } from "./TransportCompetitionTile";
import { bandOf } from "./competitionBand";
import type { TransportBodyAgg } from "@/data/transport/useTransportSector";

const body = (eik: string, name: string, share: number): TransportBodyAgg =>
  ({
    eik,
    name,
    totalEur: 1_000_000,
    contractCount: 10,
    bidKnownN: 10,
    singleBidN: Math.round(share * 10),
    singleBidShare: share,
  }) as TransportBodyAgg;

const UNITS = [body("1", "Под средното", 0.4), body("2", "Високо", 0.7)];

const pctSpan = (name: string, pct: string) =>
  screen
    .getByText(name)
    .closest("div")!
    .parentElement!.querySelector("span span")!.textContent === pct;

describe("bandOf — the boundaries, at the shown precision", () => {
  it("is green at or below the national rate, amber up to 15 points above, red beyond", () => {
    expect(bandOf(0.488, 0.488)).toBe("below");
    expect(bandOf(0.4884, 0.4876)).toBe("below"); // both read 48,8%
    expect(bandOf(0.5, 0.488)).toBe("above");
    expect(bandOf(0.638, 0.488)).toBe("above"); // exactly +15 points
    expect(bandOf(0.64, 0.488)).toBe("wellAbove");
    expect(bandOf(0.9, null)).toBe("neutral");
  });
});

const barOf = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("div.text-xs")]
    .find((d) => d.textContent?.includes(name))!
    .querySelector("div.h-full")!.className;

describe("TransportCompetitionTile", () => {
  it("colours each row by its own band and prints the national rate", () => {
    const { container } = render(
      <MemoryRouter>
        <TransportCompetitionTile
          units={[...UNITS, body("3", "Малко над", 0.55)]}
          national={0.488}
        />
      </MemoryRouter>,
    );
    expect(barOf(container, "Под средното")).toContain("bg-emerald-600");
    expect(barOf(container, "Малко над")).toContain("bg-amber-500");
    expect(barOf(container, "Високо")).toContain("bg-red-600");
    expect(screen.getByText(/48[.,]8%/)).toBeTruthy();
  });

  it("colours a 40% body green against a 48.8% national window", () => {
    const { container } = render(
      <MemoryRouter>
        <TransportCompetitionTile units={UNITS} national={0.488} />
      </MemoryRouter>,
    );
    expect(pctSpan("Под средното", "40%")).toBe(true);
    expect(container.querySelector(".bg-emerald-600")).toBeTruthy();
    expect(container.querySelector(".bg-red-600")).toBeTruthy(); // 70% > 48.8+15
    expect(container.querySelector(".bg-amber-500")).toBeNull();
  });

  it("stays neutral without a matched baseline", () => {
    const { container } = render(
      <MemoryRouter>
        <TransportCompetitionTile units={UNITS} national={null} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".bg-emerald-600, .bg-amber-500, .bg-red-600")).toBeNull(); // prettier-ignore
    expect(screen.getByText(/not coloured|не са оцветени/)).toBeTruthy();
  });
});
