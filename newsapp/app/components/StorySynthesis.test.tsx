// StorySynthesisBlock — the cited synthesis at the top of a story.
//
// ⚠️ These assertions are about what the block may CLAIM: every rendered
// line carries its outlet and its quote; a single-outlet story is attributed
// to that outlet in its own words and never compared; an absent, failed or
// empty synthesis renders NOTHING — the page keeps its headlines rather than
// receiving an invented contrast.

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import type { StoryMember, StorySynthesis } from "../data";
import { NewsLocaleProvider } from "../i18n";
import { StorySynthesisBlock } from "./StorySynthesis";

const member = (domain: string, title: string): StoryMember => ({
  domain,
  article_id: domain,
  url: `https://${domain}/story`,
  title,
  published: "2026-09-20T08:00:00Z",
  leaning: null,
  russia_stance: null,
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
});

const outletNames = new Map([
  ["a.bg", "Медия А"],
  ["b.bg", "Медия Б"],
]);
const two = [
  member("a.bg", "Обвиниха Сандов"),
  member("b.bg", "Сандов е обвиняем"),
];

const ok = (): StorySynthesis => ({
  rubric_version: "story-synthesis-v1",
  status: "ok",
  generated_at: "2026-09-22T00:00:00Z",
  outlets: ["a.bg", "b.bg"],
  synthesis: {
    common: [
      {
        claim: "Прокуратурата е повдигнала обвинение на Сандов.",
        supports: [
          {
            url: "https://a.bg/story",
            domain: "a.bg",
            quote: "обвини бившия министър Сандов",
          },
          {
            url: "https://b.bg/story",
            domain: "b.bg",
            quote: "привлече Сандов като обвиняем",
          },
        ],
      },
    ],
    disputed: [
      {
        claim: "Дали обвинението е връчено.",
        positions: [
          {
            url: "https://a.bg/story",
            domain: "a.bg",
            attributed_to: "Сандов",
            quote: "не му е връчено обвинение",
          },
          {
            url: null,
            domain: "b.bg",
            attributed_to: "адвокатът му",
            quote: "призовка не е получавана",
          },
        ],
      },
    ],
    emphasis: [
      {
        url: "https://b.bg/story",
        domain: "b.bg",
        note: "Определя случая по мащаб.",
        quote: "престъпление на десетилетието",
      },
    ],
  },
  caveat_bg: "Съвпадението между източници не е доказателство за истинност.",
  caveat_en: "Agreement among sources is not proof of truth.",
  dropped: 1,
});

describe("StorySynthesisBlock", () => {
  afterEach(cleanup);

  it("cites an outlet and a quote on every line, and carries the caveat", () => {
    render(
      <StorySynthesisBlock
        synthesis={ok()}
        members={two}
        outletNames={outletNames}
      />,
    );
    const block = screen.getByTestId("story-synthesis");
    expect(block).toBeVisible();
    expect(screen.getByText("Съобщават еднакво")).toBeVisible();
    expect(screen.getByText("Разминават се")).toBeVisible();
    expect(screen.getByText("Различен акцент")).toBeVisible();
    // Each citation is a quote next to a named outlet; the disputed side is attributed.
    const quotes = block.querySelectorAll("q");
    expect(quotes).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Медия А" })).toHaveAttribute(
      "href",
      "https://a.bg/story",
    );
    expect(screen.getByText("Медия Б · адвокатът му")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("не е доказателство");
    expect(screen.queryByTestId("story-synthesis-single")).toBeNull();
  });

  it("keeps an article's own opening quote mark and adds none of its own; the English caveat under /en", () => {
    const withMark = ok();
    withMark.synthesis!.common[0].supports[0].quote =
      "„Лукойл“ има гарантиран нефт до ноември";
    render(
      <NewsLocaleProvider language="en">
        <StorySynthesisBlock
          synthesis={withMark}
          members={two}
          outletNames={outletNames}
        />
      </NewsLocaleProvider>,
    );
    const marked = screen.getByText("„Лукойл“ има гарантиран нефт до ноември");
    expect(marked.tagName).toBe("Q");
    // ⚠️ THE MUTATION THIS CATCHES: `<q>` adding „…“ around a quote that
    // already opens with one — doubled marks on ~4% of shipped quotes.
    expect(marked.className).toContain("[quotes:none]");
    const plain = screen.getByText("привлече Сандов като обвиняем");
    expect(plain.className).not.toContain("[quotes:none]");
    expect(screen.getByText("Reported in common")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Agreement among sources is not proof of truth.",
    );
    // Outbound citation links behave like the headline comparison beneath them.
    expect(screen.getByRole("link", { name: "Медия А" })).toHaveAttribute(
      "target",
      "_blank",
    );
    // Section headings sit under the page's <h1>, not two levels below it.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
  });

  it("does not repeat the page title as a single-source quote", () => {
    render(
      <StorySynthesisBlock
        synthesis={ok()}
        members={[member("a.bg", "Обвиниха Сандов")]}
        outletNames={outletNames}
        storyTitle="Обвиниха  Сандов"
      />,
    );
    const single = screen.getByTestId("story-synthesis-single");
    expect(single).toHaveTextContent("Според Медия А");
    expect(single.querySelector("q")).toBeNull();
    expect(single).toHaveTextContent("Само един източник");
  });

  it("attributes a single-outlet story to that outlet in its own words and compares nothing", () => {
    render(
      <StorySynthesisBlock
        synthesis={ok()}
        members={[member("a.bg", "Обвиниха Сандов")]}
        outletNames={outletNames}
        storyTitle="Сандов е обвинен от прокуратурата"
      />,
    );
    const single = screen.getByTestId("story-synthesis-single");
    expect(single).toHaveTextContent("Според Медия А:");
    expect(single.querySelector("q")).toHaveTextContent("Обвиниха Сандов");
    // ⚠️ THE MUTATION THIS CATCHES: rendering the cached three-way synthesis
    // for a story that today has one outlet.
    expect(screen.queryByTestId("story-synthesis")).toBeNull();
    expect(screen.queryByText("Съобщават еднакво")).toBeNull();
  });

  it("renders nothing when the synthesis is absent, failed or empty", () => {
    const { container: absent } = render(
      <StorySynthesisBlock members={two} outletNames={outletNames} />,
    );
    expect(absent).toBeEmptyDOMElement();
    cleanup();
    for (const status of ["failed", "empty"] as const) {
      const { container } = render(
        <StorySynthesisBlock
          synthesis={{ ...ok(), status, synthesis: null }}
          members={two}
          outletNames={outletNames}
        />,
      );
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    // ⚠️ THE MUTATION THIS CATCHES: rendering whatever items a non-`ok`
    // document happens to carry. Only `ok` may render; a document whose
    // status says the gate did not pass it is not evidence.
    const { container: notOk } = render(
      <StorySynthesisBlock
        synthesis={{ ...ok(), status: "failed" }}
        members={two}
        outletNames={outletNames}
      />,
    );
    expect(notOk).toBeEmptyDOMElement();
    cleanup();
    // `ok` with no surviving items is the same as empty — no heading, no caveat.
    const { container } = render(
      <StorySynthesisBlock
        synthesis={{
          ...ok(),
          synthesis: { common: [], disputed: [], emphasis: [] },
        }}
        members={two}
        outletNames={outletNames}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
