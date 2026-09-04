// The „Свързани анализи" rail must behave the same on both candidate surfaces — the last of
// the §1.2 differences in docs/plans/person-candidate-display-unification-v1.md.
//
// `/candidate/:id` had it and `/person/:slug` did not, so an article about a cycle was
// reachable from one URL for a person and not from the other. Three properties make it work,
// and every one of them fails SILENTLY on its own:
//
//   1. THE PROVIDER IS PRESENT, and every section that declares a topic is inside it.
//      `SectionArticlesStrip` falls back to filtering the article list per section when there
//      is none, so a rail still renders — against the HEADER's cycle, and double-listing an
//      article the provider had already placed elsewhere.
//   2. EACH SECTION DECLARES ITS OWN TOPIC. A pair, not a set: swapping two lists the wrong
//      cycle's analyses under the right heading, and `ElectoralSectionMeta`'s conditional type
//      deliberately does not constrain `articleTopic` for a `person-*` id, so this gate is the
//      only guard.
//   3. THE ORDER IS SHARED. It decides which section a multi-topic article lands in, so the
//      two surfaces must place articles identically or a reader's URL decides what they find.
//
// ⚠️ THE HISTORY OF THIS FILE IS WHY IT IS SHAPED LIKE THIS. Its first cut asserted that the
// provider existed and that the three topic STRINGS appeared in the file — which the
// provider's own `SECTION_TOPICS` array satisfied, on a person page where NO section declared
// a topic and the rail rendered nowhere. It typechecked, it passed, and it was found by
// opening the page. Every static assertion below is therefore about an `articleTopic`
// ASSIGNMENT or a source POSITION, never about a string being present somewhere.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SRC_DIR } from "@/../scripts/lib/module_graph";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { initTestI18n } from "./testI18n";
import { SectionArticlesProvider } from "./SectionArticlesContext";
import { SECTION_TOPICS } from "./sectionTopics";
import { DashboardSection } from "./DashboardSection";
import type { ArticleMeta } from "@/data/articles/useArticles";

const article = (
  slug: string,
  topics: ArticleMeta["topics"],
  election?: string,
): ArticleMeta =>
  ({
    slug,
    title: { bg: `БГ ${slug}`, en: `EN ${slug}` },
    publishedAt: "2026-07-21",
    topics,
    election,
  }) as ArticleMeta;

const ARTICLES = [
  // Tagged BOTH — the provider must place it once, under `votes`.
  article("both", ["geography", "votes"]),
  article("cycle-a", ["votes"], "2024_10_27"),
  article("cycle-b", ["votes"], "2022_10_02"),
];

vi.mock("@/data/articles/useArticles", () => ({
  useListedArticles: () => ({ data: ARTICLES }),
}));
vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2024_10_27" }),
}));

beforeAll(() => initTestI18n());

const read = (file: string): string =>
  stripComments(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));

/** Every `articleTopic` a file ASSIGNS, paired with the section it sits on. Comments are
 *  stripped first — a topic named only in prose must not satisfy this. */
const topicPairs = (file: string): Array<[string, string]> => {
  const src = read(file);
  const out: Array<[string, string]> = [];
  // The section-meta form (`id: "votes", articleTopic: "votes"`).
  for (const m of src.matchAll(
    /id:\s*"([a-z-]+)",\s*\n\s*articleTopic:\s*"([a-z-]+)"/g,
  ))
    out.push([m[1], m[2]]);
  // The inline JSX form.
  for (const m of src.matchAll(
    /<DashboardSection[^>]*?\bid="([a-z-]+)"[^>]*?\barticleTopic="([a-z-]+)"/gs,
  ))
    out.push([m[1], m[2]]);
  // The passed-down form: the financing section lives in PersonSelfFunding, so its topic is
  // declared by the caller that owns the provider.
  for (const m of src.matchAll(
    /<PersonSelfFunding[\s\S]*?articleTopic="([a-z-]+)"/g,
  ))
    out.push(["person-self-funding", m[1]]);
  return out.sort();
};

const railHrefs = (container: HTMLElement, id: string): string[] => {
  const section = container.querySelector(`[data-dashboard-section="${id}"]`);
  if (!section) return [];
  return [...section.querySelectorAll("a[href^='/articles/']")].map(
    (a) => a.getAttribute("href") ?? "",
  );
};

const show = (election?: string) =>
  render(
    <MemoryRouter>
      <SectionArticlesProvider order={SECTION_TOPICS} election={election}>
        <DashboardSection id="person-electoral" title="X" articleTopic="votes">
          <div>body</div>
        </DashboardSection>
        <DashboardSection
          id="person-geography"
          title="Y"
          articleTopic="geography"
        >
          <div>body</div>
        </DashboardSection>
      </SectionArticlesProvider>
    </MemoryRouter>,
  );

describe("the section articles rail", () => {
  it("places a multi-topic article once, in the FIRST declared topic", () => {
    const { container } = show();
    expect(railHrefs(container, "person-electoral")).toContain(
      "/articles/both",
    );
    expect(railHrefs(container, "person-geography")).not.toContain(
      "/articles/both",
    );
    // ANTI-VACUITY: the geography section must have rendered at all.
    expect(
      container.querySelector('[data-dashboard-section="person-geography"]'),
    ).toBeInTheDocument();
  });

  it("WITHOUT a provider the same article double-lists — the anti-property", () => {
    // What the provider is for. The strip's fallback filters per section, so an article
    // tagged both topics appears under both headings. This is the state a section declaring a
    // topic OUTSIDE a provider silently reverts to.
    const { container } = render(
      <MemoryRouter>
        <DashboardSection id="person-electoral" title="X" articleTopic="votes">
          <div>body</div>
        </DashboardSection>
        <DashboardSection
          id="person-geography"
          title="Y"
          articleTopic="geography"
        >
          <div>body</div>
        </DashboardSection>
      </MemoryRouter>,
    );
    expect(railHrefs(container, "person-electoral")).toContain(
      "/articles/both",
    );
    expect(railHrefs(container, "person-geography")).toContain(
      "/articles/both",
    );
  });

  it("matches an election-scoped article against the BLOCK's cycle, not the header's", () => {
    // The header is mocked at 2024_10_27 throughout. With the block on 2022_10_02 the rail
    // must list that cycle's article and drop the other — the property a person page needs,
    // since its electoral block rides ?pelect.
    const blockCycle = show("2022_10_02");
    expect(railHrefs(blockCycle.container, "person-electoral")).toContain(
      "/articles/cycle-b",
    );
    expect(railHrefs(blockCycle.container, "person-electoral")).not.toContain(
      "/articles/cycle-a",
    );
    blockCycle.unmount();

    // An EMPTY override is not an override — a caller computing the cycle from a URL param
    // can hand one over, and `??` would have taken it.
    const empty = show("");
    expect(railHrefs(empty.container, "person-electoral")).toContain(
      "/articles/cycle-a",
    );
    empty.unmount();

    // And with no override it follows the header, which is right for a page whose whole body
    // is that cycle (the candidate surface).
    const { container } = show();
    expect(railHrefs(container, "person-electoral")).toContain(
      "/articles/cycle-a",
    );
    expect(railHrefs(container, "person-electoral")).not.toContain(
      "/articles/cycle-b",
    );
  });

  it("renders the rail's own heading, and no unresolved placeholder", () => {
    const { container } = show();
    const section = container.querySelector(
      '[data-dashboard-section="person-electoral"]',
    ) as HTMLElement;
    expect(within(section).getByText("Свързани анализи")).toBeInTheDocument();
    // The whole class, not one key: a plural-suffix key called without a count returns
    // „{{count}} …" verbatim, which is how the self-funding history came to announce a raw
    // placeholder to screen readers.
    expect(container.textContent ?? "").not.toMatch(/\{\{/);
  });
});

describe("both candidate surfaces declare the rail", () => {
  // Static, because the two callers are pages: mounting either would need the whole data
  // layer. What must hold is that neither has quietly lost the provider, a topic, or the
  // containment — each of which makes the rail misbehave on ONE url and not the other.
  const CANDIDATE = "screens/dashboard/CandidateDashboardCards.tsx";
  const PERSON = "screens/person/PersonElectoralSection.tsx";

  it.each([CANDIDATE, PERSON])("%s wires a provider", (file) => {
    expect(read(file)).toMatch(/<SectionArticlesProvider\b/);
  });

  it("binds each candidate-page section to its OWN topic", () => {
    // Pairs, not a set: a swap lists the wrong cycle's analyses under the right heading and
    // the type system does not stop it.
    expect(topicPairs(CANDIDATE)).toEqual([
      ["financing", "financing"],
      ["geography", "geography"],
      ["votes", "votes"],
    ]);
  });

  it("binds each person-page section to the matching topic", () => {
    expect(topicPairs(PERSON)).toEqual([
      ["person-electoral", "votes"],
      ["person-geography", "geography"],
      ["person-self-funding", "financing"],
    ]);
  });

  it("declares the financing topic INSIDE the provider, not across a boundary", () => {
    // The financing section lives in PersonSelfFunding, so its topic is passed down from
    // here. A topic declared in the child cannot say whether the child is inside this
    // provider — and outside one the rail reverts to the fallback silently.
    const src = read(PERSON);
    const open = src.indexOf("<SectionArticlesProvider");
    const close = src.indexOf("</SectionArticlesProvider>");
    const mount = src.indexOf("<PersonSelfFunding");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    expect(mount, "PersonSelfFunding is not mounted here").toBeGreaterThan(
      open,
    );
    expect(
      mount,
      "PersonSelfFunding is mounted OUTSIDE the provider",
    ).toBeLessThan(close);
    // And PersonSelfFunding must not declare one of its own, which would be exactly the
    // cross-boundary declaration this arrangement removes.
    expect(read("screens/person/PersonSelfFunding.tsx")).not.toMatch(
      /articleTopic="/,
    );
  });

  it("shares ONE placement order, so a reader's URL cannot decide what they find", () => {
    // The order decides which section a multi-topic article lands in. Both surfaces import it
    // from sectionTopics.ts; a second hand-written copy is what this asserts against.
    for (const file of [CANDIDATE, PERSON]) {
      const src = read(file);
      expect(src).toMatch(/from "[^"]*sectionTopics"/);
      expect(src, `${file} declares its own topic order`).not.toMatch(
        /const SECTION_TOPICS\s*[:=]/,
      );
    }
    expect([...SECTION_TOPICS]).toEqual(["votes", "geography", "financing"]);
  });
});
