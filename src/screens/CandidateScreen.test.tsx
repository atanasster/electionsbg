// Which body /candidate/:id renders, and — the part worth a gate — WHICH KIND of miss gets
// which answer (person-candidate-display-unification-v1 Tier 1).
//
// Before Tier 1 there was one miss branch: anything the person lookup refused fell through
// to the legacy `<Candidate>` body. That body reads the NAME-folder shards
// (data/{election}/candidates/{NAME}/), one folder per name — so for a name held by two
// people it publishes both their preference histories as one person's, at a 200, with
// nothing saying so. Measured 2026-09-03: 1,478 name folds cover 4,092 people, and the
// prerendered indexed candidate family is exactly this bare-name form.
//
// There are now FIVE answers and every wrong pairing is silent. Routing a genuinely unknown
// name to the chooser dead-ends an inbound link; routing a shared name — or a failed
// request, or a failed profile fetch for a person we DID resolve — to the legacy body
// publishes the conflation.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { initTestI18n } from "./dashboard/testI18n";
import type {
  CandidatePersonResolution,
  Namesake,
} from "@/data/candidates/useCandidatePerson";
import type { PersonProfileState } from "./person/usePersonProfile";

const resolution = vi.hoisted(() => ({
  current: {} as CandidatePersonResolution,
}));
const profile = vi.hoisted(() => ({
  current: { status: "missing" } as PersonProfileState,
}));
const seenElection = vi.hoisted(() => ({ current: undefined as unknown }));
const noindexed = vi.hoisted(() => ({ current: false }));

vi.mock("@/data/candidates/useCandidatePerson", () => ({
  useCandidatePerson: (_id?: string | null, election?: string | null) => {
    seenElection.current = election;
    return resolution.current;
  },
}));
vi.mock("./person/usePersonProfile", () => ({
  usePersonProfileState: () => profile.current,
}));
vi.mock("@/lib/useNoindex", () => ({
  useNoindex: () => {
    noindexed.current = true;
  },
}));
vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2024_10_27" }),
}));
// The two real bodies are heavy (each mounts a dozen data hooks); their own tests cover
// them. Here only WHICH one mounts is the subject.
vi.mock("./person/PersonProfileScreen", () => ({
  PersonDashboard: ({ p }: { p: { slug: string } }) => (
    <div data-testid="person-dashboard">{p.slug}</div>
  ),
}));
vi.mock("./components/candidates/Candidate", () => ({
  Candidate: ({ name }: { name: string }) => (
    <div data-testid="legacy-candidate">{name}</div>
  ),
}));
vi.mock("@/ux/SEO", () => ({ SEO: () => null }));
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useParams: () => ({ id: "Боян Иванов Бойчев" }) };
});

const { CandidateScreen } = await import("./CandidateScreen");

beforeAll(() => initTestI18n());
afterEach(() => {
  cleanup();
  noindexed.current = false;
});

const namesake = (slug: string, oblast: string): Namesake => ({
  personSlug: slug,
  displayName: "Боян Иванов Бойчев",
  latestElection: "2024_10_27",
  candidacies: [
    {
      election: "2024_10_27",
      partyNum: 28,
      partyNick: "БСП",
      partyColor: "rgb(237, 28, 36)",
      candidateSlug: `c-28-${slug}`,
      totalVotes: 18,
      oblast,
    },
  ],
});

const TWO = [
  namesake("boyan-boychev-1a9q2r", "S24"),
  namesake("boyan-boychev-1a9q2r-2", "S23"),
];

const resolve = (over: Partial<CandidatePersonResolution>) => {
  resolution.current = {
    personSlug: null,
    namesakes: [],
    failed: false,
    ...over,
  };
};

const show = () =>
  render(
    <MemoryRouter>
      <CandidateScreen />
    </MemoryRouter>,
  );

describe("CandidateScreen", () => {
  it("renders the shared person dashboard once the URL resolves to one person", () => {
    resolve({ personSlug: "boyan-boychev-1a9q2r" });
    profile.current = {
      status: "ok",
      profile: { slug: "boyan-boychev-1a9q2r", name: "Боян" },
    } as PersonProfileState;
    show();
    expect(screen.getByTestId("person-dashboard")).toHaveTextContent(
      "boyan-boychev-1a9q2r",
    );
    expect(screen.queryByTestId("legacy-candidate")).toBeNull();
  });

  it("DISCLOSES a shared name above the dashboard, and links to the others", () => {
    // 385 folds resolve because exactly one of several same-named people stood in the cycle
    // the page defaults to. The dashboard is the right body; asserting a single identity
    // under a name that means nine people, with no route to the rest, is not.
    resolve({ personSlug: "boyan-boychev-1a9q2r", namesakes: TWO });
    profile.current = {
      status: "ok",
      profile: { slug: "boyan-boychev-1a9q2r", name: "Боян" },
    } as PersonProfileState;
    show();
    expect(screen.getByTestId("person-dashboard")).toBeInTheDocument();
    // The OTHER person is reachable; the one on screen is not offered as an alternative to
    // itself.
    const links = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/person/boyan-boychev-1a9q2r-2"]);
  });

  it("does not disclose anything when the name is that person's alone", () => {
    resolve({
      personSlug: "boyan-boychev-1a9q2r",
      namesakes: [namesake("boyan-boychev-1a9q2r", "S24")],
    });
    profile.current = {
      status: "ok",
      profile: { slug: "boyan-boychev-1a9q2r", name: "Боян" },
    } as PersonProfileState;
    show();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("offers a CHOICE when the name is several public people", () => {
    // Not the legacy body: that one would merge both people's shards onto one page.
    resolve({ namesakes: TWO });
    profile.current = { status: "missing" };
    show();
    expect(screen.queryByTestId("legacy-candidate")).toBeNull();
    // One link per person, pointing at the PERSON page — the identity is what is being
    // disambiguated, not a ballot line.
    expect(
      screen.getAllByRole("link").map((a) => a.getAttribute("href")),
    ).toEqual([
      "/person/boyan-boychev-1a9q2r",
      "/person/boyan-boychev-1a9q2r-2",
    ]);
    // A disambiguation page under a head that describes ONE person, and thin by
    // construction — both reasons to keep it out of the index.
    expect(noindexed.current).toBe(true);
  });

  it("falls through to the legacy body when NO public person answers to the name", () => {
    // An unknown name, or a private / review-state person. A chooser here would dead-end an
    // inbound link that used to render something.
    resolve({});
    profile.current = { status: "missing" };
    show();
    expect(screen.getByTestId("legacy-candidate")).toHaveTextContent(
      "Боян Иванов Бойчев",
    );
    expect(noindexed.current).toBe(false);
  });

  it("does NOT offer a choice of one — that is a resolved person the lookup declined", () => {
    // A single namesake means the refusal came from somewhere else (a private person, say),
    // so there is nothing to choose between and the legacy body is the honest answer.
    resolve({ namesakes: [namesake("boyan-boychev-1a9q2r", "S24")] });
    profile.current = { status: "missing" };
    show();
    expect(screen.getByTestId("legacy-candidate")).toBeInTheDocument();
  });

  it("holds the page blank when the LOOKUP failed, rather than mounting the legacy body", () => {
    // A 500 / dead pool / offline dev server is not a fact about the name. Reading it as
    // "no such person" is how a transient fault publishes a conflation at a 200.
    resolve({ failed: true, namesakes: TWO });
    profile.current = { status: "missing" };
    const { container } = show();
    expect(screen.queryByTestId("legacy-candidate")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("holds the page blank when the PROFILE fetch failed for a resolved person", () => {
    // We know this URL is one person; the person-profile call fell over. The old code fell
    // through to the legacy body here — for a name we had already resolved.
    resolve({ personSlug: "boyan-boychev-1a9q2r", namesakes: TWO });
    profile.current = { status: "failed" };
    const { container } = show();
    expect(screen.queryByTestId("legacy-candidate")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("falls through when a resolved slug has no profile at all", () => {
    // `missing` is an ANSWER (a 200 with no body), unlike `failed` — so the legacy body is
    // the right fallback and this must not be collapsed into the branch above.
    resolve({ personSlug: "boyan-boychev-1a9q2r" });
    profile.current = { status: "missing" };
    show();
    expect(screen.getByTestId("legacy-candidate")).toBeInTheDocument();
  });

  it("renders nothing while the lookup is still in flight", () => {
    // `undefined` is "resolving". Painting either body here and swapping it out is the CLS
    // shape /candidate/<name> is in both perf gates for.
    resolve({ personSlug: undefined });
    profile.current = { status: "loading" };
    const { container } = show();
    expect(screen.queryByTestId("legacy-candidate")).toBeNull();
    expect(screen.queryByTestId("person-dashboard")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("passes the page's election to the lookup", () => {
    // The disambiguator that costs nothing. ⚠️ It must NARROW, never exclude — a filtering
    // implementation dropped 19,649 of 25,621 resolving folds, because the default cycle is
    // the newest one and a prerendered URL carries no `?elections=` at all. That property
    // lives in the SQL and is gated in person_elections.data.test.ts; what is asserted here
    // is only that the screen still supplies it.
    resolve({});
    show();
    expect(seenElection.current).toBe("2024_10_27");
  });
});
