// The basis mark on „Управа на ЮЛНЦ".
//
// What is under test is a CAVEAT, so the failure mode is not a blank block — it is a named
// organisation printed beside a named person with nothing saying the link rests on a folded
// name. That is what this block did until 2026-08-25 for 5,670 of its 5,727 seats, while the
// companies list directly above it marked every row of its own.
//
// The cases mirror PersonCompanies' „the link basis" suite deliberately: the two blocks
// answer the same question about the same person via the same `isNameMatch`, so a divergence
// between the two suites is itself the defect (LinkBasisMark's header).
//
// ⚠️ THESE CASES COVER ONE DIRECTION ONLY, and it is the safe one. The component is correct
// to trust the server, so nothing here can catch a basis that is WRONG rather than absent —
// invert 082's CASE and every seat renders as register-confirmed with these tests green. The
// other direction is gated in scripts/db/tests/person_company_basis.data.test.ts ("082's
// per-seat ngos linkBasis agrees with the view"). That gate did not exist until 2026-08-25,
// and this comment claimed it did.

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import type { NgoSeat } from "./usePersonProfile";
import { PersonNgoSeats } from "./PersonNgoSeats";

const seat = (
  name: string,
  linkBasis?: NgoSeat["linkBasis"],
  eik = name,
): NgoSeat => ({
  eik,
  name,
  legalForm: "ASSOC",
  seat: "БЪЛГАРИЯ, гр. София",
  roles: ["ngo_board"],
  linkBasis,
});

const draw = (ngos: NgoSeat[], foldPeopleN?: number | null) =>
  render(
    <MemoryRouter>
      <PersonNgoSeats ngos={ngos} foldPeopleN={foldPeopleN} />
    </MemoryRouter>,
  );

describe("PersonNgoSeats — the link basis", () => {
  const NAMESAKE = /Лицата в Търговския регистър се идентифицират/;

  it("marks a name-matched board seat and caveats the block", () => {
    draw([seat("ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА", "name_match")]);
    expect(screen.getAllByText("по име").length).toBe(1);
    expect(screen.getByText(NAMESAKE)).toBeTruthy();
  });

  it("leaves a fully declared block unmarked and uncaveated", () => {
    // Only 57 of 5,727 seats earn this. The reassurance has to be earned: every seat here is
    // register-confirmed, so there is nothing for the namesake sentence to qualify.
    draw([seat("Български Червен кръст", "declared")]);
    expect(screen.queryByText("по име")).toBeNull();
    expect(screen.queryByText(NAMESAKE)).toBeNull();
  });

  it("marks only the name-matched half of a mixed block", () => {
    // The real shape of the page this was found on: Илия Петров Раев holds four seats, one
    // of which (Червен кръст) his executive-branch filing confirms and three of which rest
    // on the fold. A block-level caveat alone either over-qualifies the confirmed seat or
    // under-qualifies the rest, which is why the mark is per seat.
    draw([
      seat("Български Червен кръст", "declared"),
      seat("ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА", "name_match"),
      seat("БЪЛГАРСКО ДРУЖЕСТВО ЗА ПРИЯТЕЛСТВО С ЯПОНИЯ", "name_match"),
    ]);
    expect(screen.getAllByText("по име").length).toBe(2);
    expect(screen.getByText(NAMESAKE)).toBeTruthy();
  });

  it("treats a MISSING linkBasis as a name match, never as declared", () => {
    // A cloud database on an 082 older than this change omits the field entirely — which is
    // every serving database until the migration ships. The two ways to be wrong are not
    // symmetric: a needless caveat costs nothing, printing an unconfirmed board seat as
    // confirmed is the claim this mark exists to prevent.
    draw([seat("ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА", undefined)]);
    expect(screen.getAllByText("по име").length).toBe(1);
    expect(screen.getByText(NAMESAKE)).toBeTruthy();
  });

  it("states the registry's own people-count when it has one", () => {
    // Matched WITHOUT the numeral: i18next is not initialised in jsdom, so `t` returns the
    // defaultValue verbatim and {{n}} is not substituted. What this asserts is the rendering
    // RULE — that the sentence appears at all when the fold is measured and shared.
    draw([seat("ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА", "name_match")], 3);
    expect(screen.getByText(/различни лица с това име/)).toBeTruthy();
  });

  it("says nothing when the fold is UNMEASURED — absence is not reassurance", () => {
    draw([seat("ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА", "name_match")], null);
    expect(screen.queryByText(/различни лица с това име/)).toBeNull();
    draw([seat("ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА", "name_match")], 1);
    expect(screen.queryByText(/различни лица с това име/)).toBeNull();
  });

  it("renders nothing at all when the person holds no board seat", () => {
    // The block used to be gated by `p.ngos.length > 0` at the call site; moving that inside
    // the component is what lets PersonProfileScreen render it unconditionally, so this is
    // the assertion that keeps an empty „Управа на ЮЛНЦ" heading off every other profile.
    const { container } = draw([]);
    expect(container.firstChild).toBeNull();
  });
});
