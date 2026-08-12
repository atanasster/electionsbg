// The whole design rests on one comparison — `rollcallCoverage(...) !== false` — and the
// distinction it enforces (`null` is not `false`) is invisible to TypeScript: both branches
// are valid, so a change from `!== false` to a truthiness check type-checks, lints and, with
// only a helper-level test, keeps the suite green while 1,263 MPs with no published
// parliament list start receiving a claim about themselves.
//
// This is the test that can tell those apart, because it renders.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o ? `${k}|${o.firstNs}|${o.since}` : k,
    i18n: { language: "bg" },
  }),
}));

import { PersonNoRollcallNote } from "./PersonNoRollcallNote";

const note = () => screen.queryByText(/mp_rollcall_out_of_corpus/);

describe("PersonNoRollcallNote", () => {
  it.each([
    {
      why: "proven absent — every term predates the corpus AND no seat exists",
      nsFolders: ["39", "40"],
      hasRollcall: false,
      shown: true,
    },
    {
      why: "in the corpus by the roster",
      nsFolders: ["44", "45"],
      hasRollcall: true,
      shown: false,
    },
    {
      why: "in the corpus under a DIFFERENT seat id — the 70-MP case",
      nsFolders: ["42", "43"],
      hasRollcall: true,
      shown: false,
    },
    {
      why: "no parliament list published — not evidence of anything",
      nsFolders: [],
      hasRollcall: false,
      shown: false,
    },
    {
      why: "route predates hasRollcall — unknown, so say nothing",
      nsFolders: ["39", "40"],
      hasRollcall: undefined,
      shown: false,
    },
    {
      why: "still loading",
      nsFolders: undefined,
      hasRollcall: undefined,
      shown: false,
    },
  ])("renders the note only on a proven negative ($why)", (c) => {
    render(
      <PersonNoRollcallNote
        nsFolders={c.nsFolders}
        hasRollcall={c.hasRollcall}
      />,
    );
    expect(!!note()).toBe(c.shown);
  });

  it("ordinalises the boundary rather than hard-coding a suffix", () => {
    // BG takes four different endings and EN four; a literal „-то" in the string is right
    // for 44 and wrong for most values a backfill would produce, so the number and its
    // suffix have to move together. The date comes from the same constant for the same
    // reason — otherwise half the sentence follows a backfill and half does not.
    render(<PersonNoRollcallNote nsFolders={["39"]} hasRollcall={false} />);
    const rendered = note()?.textContent ?? "";
    expect(rendered).toContain("44-то");
    expect(rendered).not.toMatch(/\|44\|/);
    // "окт. 2020 г." in bg-BG short form — derived, not spelled in the copy.
    expect(rendered).toMatch(/2020/);
  });
});
