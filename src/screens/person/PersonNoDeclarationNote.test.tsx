// The note exists to keep "not required to file" from reading as "did not file".
//
// Getting the CONDITION wrong is worse than not having it: shown too widely it becomes an
// excuse for a genuine missing declaration, which is precisely the signal /person exists to
// carry. See docs/plans/village-mayor-attribution-v1.md §T4a.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PersonNoDeclarationNote } from "./PersonNoDeclarationNote";

const village = { source: "local", role: "village_mayor" };

const shows = (roles: { source: string; role: string }[]): boolean => {
  const { container } = render(<PersonNoDeclarationNote roles={roles} />);
  return container.textContent !== "";
};

describe("PersonNoDeclarationNote", () => {
  it("explains the exemption for a village mayor", () => {
    render(<PersonNoDeclarationNote roles={[village]} />);
    expect(screen.getByText(/кметства/i)).toBeTruthy();
  });

  // THE CASE THAT MATTERS. These are чл. 6 offices, and the person holds them ALONGSIDE a
  // village-mayor seat — so the note must stay silent even though nothing here proves they
  // filed. An earlier draft suppressed on the officials/mp/magistrate SOURCES instead, which
  // is circular: those sources are minted from the register scrape itself, so a чл. 6 office
  // known only from the election results carried no suppressing role. Measured live: 191
  // people, 187 общински съветници and 4 кметове на общини, all with zero declarations, each
  // of whom would have been told their office carries no filing duty.
  it.each([
    ["a mayor of a municipality", { source: "local", role: "mayor" }],
    ["a councillor", { source: "local", role: "councillor" }],
    ["a район mayor", { source: "local", role: "rayon_mayor" }],
  ])("hides for a village mayor who is ALSO %s", (_case, other) => {
    expect(shows([village, other])).toBe(false);
  });

  // The same rule via the roster-derived sources, which is what the first draft tested.
  // Correct outcome, just no longer the mechanism.
  it.each([
    ["an MP", { source: "mp", role: "mp" }],
    ["a municipal official", { source: "official_muni", role: "mayor" }],
    ["an executive official", { source: "official_exec", role: "minister" }],
    ["a magistrate", { source: "magistrate", role: "judge" }],
    ["a president", { source: "president", role: "president" }],
    ["an MEP", { source: "mep", role: "mep" }],
    ["a diplomat", { source: "diplomat", role: "ambassador" }],
  ])("hides for a village mayor who is ALSO %s", (_case, other) => {
    expect(shows([village, other])).toBe(false);
  });

  // An office nobody has classified yet must NOT be treated as exempt — the allowlist fails
  // safe towards saying nothing rather than towards excusing.
  it("hides for a village mayor holding an unclassified office", () => {
    expect(shows([village, { source: "regulator", role: "member" }])).toBe(
      false,
    );
  });

  it.each([
    ["a mayor of a municipality", { source: "local", role: "mayor" }],
    ["a councillor", { source: "local", role: "councillor" }],
    ["an MP", { source: "mp", role: "mp" }],
  ])("hides for %s who was never a village mayor", (_case, role) => {
    expect(shows([role])).toBe(false);
  });

  it("hides for someone with no roles at all", () => {
    expect(shows([])).toBe(false);
  });

  // A company, an NGO seat, a candidacy and a donation are not OFFICES: none creates a
  // filing duty, so none may suppress the note the way a чл. 6 post does.
  it.each([
    ["a company officer", { source: "tr", role: "manager" }],
    ["an NGO board member", { source: "ngo", role: "ngo_board" }],
    ["a candidate", { source: "candidate", role: "candidate" }],
    ["a donor", { source: "donor", role: "donor" }],
  ])("still shows for a village mayor who is also %s", (_case, other) => {
    expect(shows([village, other])).toBe(true);
  });

  // A candidacy alone is not an office, so there is no exempt office to explain.
  it("hides for a candidate who holds nothing", () => {
    expect(shows([{ source: "candidate", role: "candidate" }])).toBe(false);
  });

  it("shows for someone who held the same exempt seat across cycles", () => {
    expect(shows([village, village])).toBe(true);
  });
});
