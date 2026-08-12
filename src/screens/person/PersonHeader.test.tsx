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
import { cleanup, render, screen } from "@testing-library/react";
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
const mpEntry: { current: { name_en?: string } | null } = { current: null };
vi.mock("@/data/parliament/useMpEntry", () => ({
  useMpEntry: () => ({ entry: mpEntry.current }),
}));
vi.mock("@/data/dashboard/usePersonElections", () => ({
  usePersonDataCycles: () => ({ rows: [], dataCycles: [] }),
}));
vi.mock("@/data/parties/usePartyInfo", () => ({
  usePartyInfo: () => ({ findParty: () => undefined }),
}));
// The party badge's third tier (`electedWith`) resolves its label and colour through the
// canonical-parties fold, which is a real React Query hook. Stubbed rather than wrapped in a
// QueryClientProvider: this file is about the H1/avatar locale split, and a live query would
// make every case here depend on a fetch it does not care about.
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({
    findCanonicalNickName: () => undefined,
    colorFor: () => undefined,
    partyGroupShortLabel: (s?: string | null) => s ?? null,
  }),
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
    mpEntry.current = null;
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
    cleanup();
    renderAt("en");
    // Not the transliteration: the photo index is keyed on the Bulgarian form.
    expect(screen.getByTestId("avatar").textContent).toBe(
      "Иван Георгиев Такучев",
    );
  });

  // /en/candidate renders the curated parliament.bg spelling; without the hint /person would
  // transliterate and the two /en pages for one MP would disagree on their <h1>.
  it("prefers a curated parliament.bg name_en over the transliteration on /en", () => {
    mpEntry.current = { name_en: "Ivan G. Takutchev" };
    renderAt("en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Ivan G. Takutchev",
    );
  });

  it("ignores the curated name on the Bulgarian route", () => {
    mpEntry.current = { name_en: "Ivan G. Takutchev" };
    renderAt("bg");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Иван Георгиев Такучев",
    );
  });
});
