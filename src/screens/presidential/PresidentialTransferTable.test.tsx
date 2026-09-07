// The three rules the table exists to keep, none of which a screenshot would show.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";
import {
  PresidentialTransferTable,
  SANKEY_MAX_FROM_NODES,
} from "./PresidentialTransferTable";

// ⚠ THE REAL CORPUS, and the UNION of its files — the table's keys live in the deferred
// `presidential` bundle, so a test reading `translation.json` alone renders every one of them
// as its own identifier and the assertions below pass against nonsense.
await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const node = (
  id: string,
  label: string,
  votes: number,
  pseudo?: true,
): VoteFlowMatrix["fromNodes"][number] => ({
  id,
  label,
  labelEn: label,
  color: "#111111",
  votes,
  ...(pseudo ? { pseudo } : {}),
});

/** A miniature of the real shape: two tickets and the abstain lane on the from side. */
const matrix: VoteFlowMatrix = {
  fromNodes: [
    node("t1", "Малък Кандидат", 200),
    node("t6", "Голям Кандидат", 1_000),
    node("__abstain__", "Не гласува", 50_000, true),
  ],
  toNodes: [
    node("t6", "Голям Кандидат", 1_200),
    node("__abstain__", "Не гласува", 50_000, true),
  ],
  flows: [
    { from: "t6", to: "t6", votes: 900 },
    { from: "t6", to: "__abstain__", votes: 100 },
    { from: "t1", to: "t6", votes: 150 },
    // ⚠ NO `t1 → __abstain__` EDGE. That cell must render as „—", never 0%.
    { from: "__abstain__", to: "__abstain__", votes: 49_000 },
    // 20 of 50,000 — a real flow that rounds to 0% at one decimal.
    { from: "__abstain__", to: "t6", votes: 20 },
  ],
};

const rowNames = (): string[] =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("rowheader")[0].textContent ?? "");

const mount = () =>
  render(
    <MemoryRouter>
      <PresidentialTransferTable matrix={matrix} />
    </MemoryRouter>,
  );

describe("PresidentialTransferTable", () => {
  // ⚠ THE LANGUAGE IS GLOBAL i18next STATE. One `changeLanguage("en")` below would otherwise
  // leak into whichever test vitest happens to run next, and the Bulgarian assertions would
  // fail in an order-dependent way that looks like a component bug.
  beforeEach(async () => {
    await i18n.changeLanguage("bg");
  });

  it("ranks TICKETS by round-1 votes and keeps the structural lanes underneath", () => {
    // ⚠ NOT A PURE VOTES SORT. „Не гласува" is the largest from-node in every real cycle —
    // 4.5M against the winner's 1.02M in 2021 — so ranking on votes alone opens the table
    // with rows about nobody. Here it is 50x the largest ticket and must still come last.
    mount();
    expect(rowNames()).toEqual([
      "Голям Кандидат",
      "Малък Кандидат",
      "Не гласува",
    ]);
  });

  it("shows every cell as a share of ITS OWN ROW, not of the column", () => {
    // „Of Малък Кандидат's 200 round-1 voters, 75% went to Голям Кандидат" — 150/200. The
    // COLUMN share would be 150/1200 = 12,5%, a different and constantly confused claim.
    // ⚠ THE BULGARIAN DECIMAL COMMA, because `formatPct` is locale-aware and this suite runs
    // in bg — a `12.5%` here would pass against a column-share implementation.
    mount();
    const row = screen
      .getAllByRole("row")
      .find((r) => within(r).queryByText("Малък Кандидат"));
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText("75%")).toBeTruthy();
    expect(within(row as HTMLElement).queryByText("12,5%")).toBeNull();
  });

  it("renders a MISSING cell as a dash, never as 0%", () => {
    // ⚠ AN EDGE BELOW THE PRODUCER'S FLOOR WAS DROPPED, NOT MEASURED AT ZERO. „0%" asserts
    // that none of this candidate's voters went there, which the estimate does not say.
    mount();
    const row = screen
      .getAllByRole("row")
      .slice(1)
      .find((r) => within(r).queryByText("Малък Кандидат")) as HTMLElement;
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent);
    // ⚠ „0%", NOT „0.0%". `formatPct` sets `maximumFractionDigits` with no minimum, so it
    // never emits a trailing „.0" at all — a guard on „0.0%" passes against every possible
    // implementation, including the exact regression it is named for.
    expect(cells).not.toContain("0%");
    // ⚠ THE SHAPE TOO. One dashed cell among the row's own columns, so a renderer that dashed
    // everything — or emitted the wrong number of cells — cannot satisfy the glyph alone.
    // The row's own round-1 denominator, plus one cell per runoff column.
    expect(cells.length).toBe(1 + matrix.toNodes.length);
    expect(cells.filter((c) => c?.startsWith("—")).length).toBe(1);
  });

  it("reads a share that rounds to zero as a less-than, not as 0%", () => {
    // ⚠ THE SAME RULE AS THE DASH, ONE STEP FURTHER IN. On the real corpus Карадайъ →
    // недействителни is 121 estimated voters against 222,581, which prints „0%" at one
    // decimal — indistinguishable from the „—" two columns over, and a stronger claim than
    // either. Here it is 20 of 50,000.
    mount();
    // ⚠ `slice(1)` — „Не гласува" is BOTH a row header and a column header, so an unsliced
    // search matches the `<thead>` row, which has no `<td>` at all and yields an empty list
    // that `toContain` reports as a missing value rather than as the wrong row.
    const row = screen
      .getAllByRole("row")
      .slice(1)
      .find((r) => within(r).queryByText("Не гласува")) as HTMLElement;
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent);
    expect(cells).toContain("< 0,1%");
    expect(cells).not.toContain("0%");
  });

  it("prints each row's own denominator beside the shares", () => {
    // ⚠ THE DENOMINATOR IS WHAT MAKES „75%" CHECKABLE rather than a bare number, and the
    // header comment says so — but nothing asserted it, so deleting that column broke no test
    // while breaking the argument.
    mount();
    const row = screen
      .getAllByRole("row")
      .slice(1)
      .find((r) => within(r).queryByText("Малък Кандидат")) as HTMLElement;
    expect(within(row).getByText("200")).toBeTruthy();
  });

  it("gives every share cell the vote count as its ACCESSIBLE NAME", () => {
    // ⚠ NOT A `title`. The absolute flow is the evidence behind the percentage, and a tooltip
    // reaches a mouse and nothing else — the rule `PresidentialPersonName` records in its own
    // header. 150 of Малък Кандидат's 200 went to Голям Кандидат.
    mount();
    const row = screen
      .getAllByRole("row")
      .slice(1)
      .find((r) => within(r).queryByText("Малък Кандидат")) as HTMLElement;
    const named = [...row.querySelectorAll("td [aria-label]")].map((e) =>
      e.getAttribute("aria-label"),
    );
    expect(named.some((n) => n?.includes("150") && n?.includes("гласа"))).toBe(
      true,
    );
    expect(row.querySelector("[title]")).toBeNull();
  });

  it("says in words what a dash means, for a reader who cannot see the note", () => {
    mount();
    const row = screen
      .getAllByRole("row")
      .slice(1)
      .find((r) => within(r).queryByText("Малък Кандидат")) as HTMLElement;
    expect(within(row).getByText(/под прага на оценката/)).toBeTruthy();
  });

  it("interpolates the note's threshold rather than hardcoding it", async () => {
    // ⚠ AND THE EN DECIMAL POINT PROVES IT IS INTERPOLATED. A note typed as a literal would
    // carry the Bulgarian comma into the English corpus, or go stale against `PCT_DIGITS`.
    await i18n.changeLanguage("en");
    mount();
    // The NOTE, not a cell — both carry the threshold, which is the point. A note typed as a
    // literal would keep the Bulgarian comma here, or go stale against `PCT_DIGITS`.
    expect(
      screen.getByText(/A .< 0\.1%. cell is a real but very small flow/),
    ).toBeTruthy();
    const row = screen
      .getAllByRole("row")
      .slice(1)
      .find((r) => within(r).queryByText("Не гласува")) as HTMLElement;
    expect([...row.querySelectorAll("td")].map((c) => c.textContent)).toContain(
      "< 0.1%",
    );
  });

  it("keeps the chart threshold above the two cycles the Sankey still serves", () => {
    // 2001 has 8 from-nodes and 2006 has 9; 2011 has 20. A threshold at or below 9 would take
    // the chart away from the only cycles it reads well on, which is the opposite of the
    // change's point.
    expect(SANKEY_MAX_FROM_NODES).toBeGreaterThan(9);
    expect(SANKEY_MAX_FROM_NODES).toBeLessThan(20);
  });
});
