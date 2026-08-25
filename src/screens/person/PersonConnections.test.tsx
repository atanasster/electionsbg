// This component OWNED the „Свързани лица" section and self-hid when it found no ties —
// which took the connection CHECK down with it, on exactly the pages where a reader most
// wants one. Reported live on /person/mp-5254 (Бойко Илиев Рашков): `person_connections`
// returns `related: []` and `indirect: []`, so the whole section vanished and there was no
// way to check a specific name against him at all.
//
// The section is now owned by PersonProfileScreen, which renders the check beside this.
// So what this file pins is the split: the component contributes a BODY and nothing more,
// and it must not reintroduce a section wrapper — doing so would make the page render two.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import {
  PersonConnections,
  type PersonConnectionsData,
} from "./PersonConnections";

const data = (
  over: Partial<PersonConnectionsData> = {},
): PersonConnectionsData => ({
  subject: { slug: "mp-1", name: "Иван Петров" },
  related: [],
  indirect: [],
  disclaimer: "Връзките са по съвпадение на име и обща фирма.",
  ...over,
});

const show = (d: PersonConnectionsData) =>
  render(
    <MemoryRouter>
      <PersonConnections data={d} />
    </MemoryRouter>,
  );

describe("PersonConnections", () => {
  it("renders NO section wrapper of its own", () => {
    // The page owns the section so the check can share it. A wrapper here would give the
    // page two „Свързани лица" headings, one of them empty.
    const { container } = show(
      data({
        related: [
          {
            slug: "mp-2",
            name: "Георги Георгиев",
            party: null,
            partyColor: null,
            sharedCount: 1,
            companies: [{ eik: "1", name: "АКМЕ" }],
          },
        ],
      }),
    );
    expect(container.querySelector("[data-dashboard-section]")).toBeNull();
    expect(screen.getByText("Георги Георгиев")).toBeInTheDocument();
  });

  it("contributes nothing when it found no ties", () => {
    // Still self-hides — but only its own body now, so the section and the check survive.
    const { container } = show(data());
    expect(container.firstChild).toBeNull();
  });

  it("renders for an INDIRECT tie alone", () => {
    // The rarer arm: a path through a shared partner, with no direct company in common.
    show(
      data({
        indirect: [
          {
            slug: "mp-3",
            name: "Мария Иванова",
            party: null,
            partyColor: null,
            partnerSlug: "p-1",
            partnerName: "Петър Петров",
            c1: { eik: "1", name: "АКМЕ" },
            c2: { eik: "2", name: "БЕТА" },
          },
        ],
      }),
    );
    expect(screen.getByText("Мария Иванова")).toBeInTheDocument();
    expect(screen.getByText("Петър Петров")).toBeInTheDocument();
  });

  it("always carries its own name-match disclaimer when it renders", () => {
    show(
      data({
        related: [
          {
            slug: "mp-2",
            name: "Георги Георгиев",
            party: null,
            partyColor: null,
            sharedCount: 1,
            companies: [{ eik: "1", name: "АКМЕ" }],
          },
        ],
        disclaimer: "насока, не категорично доказателство",
      }),
    );
    expect(
      screen.getByText(/насока, не категорично доказателство/),
    ).toBeInTheDocument();
  });
});
