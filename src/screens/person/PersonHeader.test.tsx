// The /person H1 must follow the locale, and the avatar lookup must NOT.
//
// The prerendered /en person page names the person in Latin (scripts/prerender/placeNameEn.ts
// + transliterateName). Before this component did the same, hydration replaced that Latin
// <h1> with the Cyrillic one — the /en page then disagreed with its own <title>, which is the
// mismatch data/funds/programmeNamesEn.ts was written for on the funds routes.
//
// The second half is the trap: MpAvatar's photo lookup keys on the BULGARIAN name, so
// localizing the H1 without passing `lookupName` silently drops every MP photo on /en.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersonHeader } from "./PersonHeader";
import type { PersonProfile } from "./usePersonProfile";

const lang = { current: "bg" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: {
      get language() {
        return lang.current;
      },
    },
  }),
}));
vi.mock("@/screens/components/candidates/MpAvatar", () => ({
  MpAvatar: ({ name }: { name?: string | null }) => (
    <span data-testid="avatar">{name}</span>
  ),
}));
vi.mock("@/data/parliament/useMpEntry", () => ({
  useMpEntry: () => ({ entry: null }),
}));
vi.mock("@/data/dashboard/usePersonElections", () => ({
  usePersonDataCycles: () => ({ rows: [], dataCycles: [] }),
}));
vi.mock("@/data/parties/usePartyInfo", () => ({
  usePartyInfo: () => ({ findParty: () => undefined }),
}));

const profile = {
  slug: "ivan-georgiev-takuchev-c39f00",
  name: "Иван Георгиев Такучев",
  facets: [],
  aliases: [],
} as unknown as PersonProfile;

const renderAt = (language: string) => {
  lang.current = language;
  return render(
    <MemoryRouter>
      <PersonHeader p={profile} mpId={null} />
    </MemoryRouter>,
  );
};

describe("PersonHeader", () => {
  beforeEach(() => {
    lang.current = "bg";
  });

  it("keeps the Cyrillic name on the Bulgarian route", () => {
    renderAt("bg");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Иван Георгиев Такучев",
    );
  });

  it("transliterates the H1 on the English route", () => {
    renderAt("en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Ivan Georgiev Takuchev",
    );
  });

  it("keeps the avatar lookup on the Bulgarian name in BOTH locales", () => {
    renderAt("bg");
    expect(screen.getByTestId("avatar").textContent).toBe(
      "Иван Георгиев Такучев",
    );
    screen.getByTestId("avatar").remove();
    renderAt("en");
    // Not the transliteration: the photo index is keyed on the Bulgarian form.
    expect(screen.getByTestId("avatar").textContent).toBe(
      "Иван Георгиев Такучев",
    );
  });
});
