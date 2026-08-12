// The `#declarations` anchor is a deep-link target (MpScorecardTile's net-worth metric
// drills to it) and the person page must carry exactly one element bearing it. Three
// components can open that section, which is how a duplicate shipped once already.
//
// What this file guards, and what it does NOT:
//
//   • STRUCTURAL (below): no component may write the anchor itself — DeclarationsSection is
//     the only site of the id and the heading. This is what stops a FOURTH opener appearing
//     and quietly reintroducing the duplicate, and it is a real guard because it reads the
//     source of every sibling rather than a list someone has to remember to update.
//   • DECISION-LAYER: which of the openers claims the section is one boolean,
//     `useMpOwnsDeclarations`, covered exhaustively in its own test — including the roster
//     window where it used to answer false for an MP who owns the section.
//
// It does not render the whole dashboard and count the elements. That would be the direct
// statement of the invariant; it needs a full PersonProfile fixture plus ~10 fetch-driven
// children, and the two layers above pin both halves of what such a test would assert.

import "@testing-library/jest-dom/vitest";
import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import {
  DeclarationsSection,
  DECLARATIONS_ANCHOR,
} from "./DeclarationsSection";

const DIR = path.join(process.cwd(), "src/screens/person");

/** Source files in this directory, comments STRIPPED. The anchor is discussed by name in
 *  several docblocks (including this file's own siblings), so a naive scan matches prose
 *  and the guard fails on the very comments that explain it. */
const sources = (): { file: string; code: string }[] =>
  fs
    .readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({
      file: f,
      code: fs
        .readFileSync(path.join(DIR, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1"),
    }));

describe("DeclarationsSection", () => {
  it("renders the anchor and the heading", () => {
    const { container } = render(
      <DeclarationsSection>
        <p>body</p>
      </DeclarationsSection>,
    );
    expect(container.querySelectorAll(`#${DECLARATIONS_ANCHOR}`)).toHaveLength(
      1,
    );
    expect(screen.getByText("mp_section_assets")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("is the ONLY place the anchor is written", () => {
    // A component that opens its own `<DashboardSection id="declarations">` is invisible to
    // the predicate that coordinates the others, so it can co-render and duplicate the id.
    // Reading the directory rather than a hard-coded list is the point: a new file is
    // covered the day it lands.
    const offenders = sources()
      .filter(({ file }) => file !== "DeclarationsSection.tsx")
      .filter(({ code }) => /id=\s*[{"']?["'`]?declarations/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("is the only definition of the deep-link href, so target and link cannot drift", () => {
    // `netWorth: "#declarations"` written as a literal beside an element whose id comes from
    // the constant is the drift this asserts against. The approved form is
    // `` `#${DECLARATIONS_ANCHOR}` ``, which this does not match.
    const withLiteralHref = sources()
      .filter(({ code }) => /["']#declarations["']/.test(code))
      .map(({ file }) => file);
    expect(withLiteralHref).toEqual([]);
  });

  it("the guards still discriminate", () => {
    // A scan that matches nothing because its regex is wrong passes identically to one that
    // matches nothing because the code is clean. Prove the difference on synthetic input.
    expect(/id=\s*[{"']?["'`]?declarations/.test('<X id="declarations">')).toBe(
      true,
    );
    expect(/["']#declarations["']/.test('href="#declarations"')).toBe(true);
    expect(/["']#declarations["']/.test("`#${DECLARATIONS_ANCHOR}`")).toBe(
      false,
    );
  });
});
