// Entity chips — a link only where the name earned one.
//
// ⚠️ These chips sit beside a named individual's name on a public page. A
// chip that looks like a link and goes nowhere, or one that links to the
// wrong person, is the harm the whole mention layer is built to avoid.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EntityChips } from "./EntityChips";
import type { EntityCandidate, EntityLink } from "../data";

const link = (over: Partial<EntityLink> = {}): EntityLink => ({
  kind: "person",
  id: "mp-3931",
  canonical: "Иван Маркос Христанов",
  form_kind: "two_part",
  href: "https://electionsbg.com/person/mp-3931",
  ...over,
});

describe("linking", () => {
  it("links a resolved name and leaves the rest plain", () => {
    render(
      <EntityChips
        title="Хора"
        names={["Иван Христанов", "Размиг Чакърян-Ами"]}
        links={{ "Иван Христанов": link() }}
      />,
    );
    // ⚠️ The FIXTURE carries the retired host, deliberately: that is what a
    // release published before the rebrand holds, and the rendered href must
    // be the serving domain regardless.
    expect(
      screen.getByRole("link", { name: /Иван Христанов/ }),
    ).toHaveAttribute("href", "https://naiasno.bg/person/mp-3931");
    // ⚠️ The unresolved one must NOT be a link. „We could not tell who this
    // is" and „here is their profile" are different statements.
    expect(screen.queryByRole("link", { name: /Размиг/ })).toBeNull();
    expect(screen.getByText("Размиг Чакърян-Ами")).toBeVisible();
  });

  it("shows the registry's own spelling", () => {
    // ⚠️ All eight people this resolves matched on a TWO-PART form („Иван
    // Христанов" → Иван Маркос Христанов). The reader is the last check on
    // whether we picked the right person, and they can only perform it if
    // they can see who we picked.
    render(
      <EntityChips
        title="Хора"
        names={["Иван Христанов"]}
        links={{ "Иван Христанов": link() }}
      />,
    );
    const a = screen.getByRole("link", { name: /Иван Христанов/ });
    expect(a.getAttribute("title")).toContain("Иван Маркос Христанов");
    // …and reachable without hovering.
    expect(a.textContent).toContain("Иван Маркос Христанов");
  });

  it("does not repeat the canonical name when it is the same", () => {
    render(
      <EntityChips
        title="Места"
        names={["София"]}
        links={{
          София: link({
            kind: "place",
            id: "68134",
            canonical: "София",
            href: "https://electionsbg.com/settlement/68134",
          }),
        }}
      />,
    );
    const a = screen.getByRole("link", { name: /София/ });
    expect(a.textContent).toBe("София");
  });

  it("is a plain anchor, not a router link", () => {
    // ⚠️ The news app is a different origin from the main site, so these
    // must leave the SPA. Rendered through react-router's <Link> they would
    // be routed inside this app and 404.
    render(
      <EntityChips
        title="Хора"
        names={["Иван Христанов"]}
        links={{ "Иван Христанов": link() }}
      />,
    );
    const a = screen.getByRole("link", { name: /Иван Христанов/ });
    expect(a.getAttribute("href")).toMatch(/^https:\/\/naiasno\.bg\//);
    expect(a.getAttribute("rel")).toContain("noreferrer");
  });

  it("caps a long list, and the cap counts the whole list", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Име ${i}`);
    render(<EntityChips title="Хора" names={names} />);
    expect(screen.getByText("+4")).toBeVisible();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<EntityChips title="Хора" names={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("inline mode drops the heading and the cap", () => {
    // The article page groups them under its own label and shows them all.
    const names = Array.from({ length: 12 }, (_, i) => `Име ${i}`);
    render(<EntityChips title="Хора" names={names} inline />);
    expect(screen.queryByText("Хора")).toBeNull();
    expect(screen.queryByText("+4")).toBeNull();
    expect(screen.getByText("Име 11")).toBeVisible();
  });
});

describe("candidates — the choice we will not make", () => {
  const asparuhovo: EntityCandidate[] = [
    {
      kind: "place",
      id: "rayon:VAR06-05",
      canonical: "Аспарухово",
      detail: "район, общ. Варна, обл. Варна",
      href: "https://electionsbg.com/governance/VAR06-05",
    },
    {
      kind: "place",
      id: "settlement:00775",
      canonical: "Аспарухово",
      detail: "населено място, общ. Карнобат, обл. Бургас",
      href: "https://naiasno.bg/settlement/00775",
    },
  ];

  it("offers every candidate, on the serving host", async () => {
    render(
      <EntityChips
        title="Места"
        names={["Аспарухово"]}
        candidates={{ Аспарухово: asparuhovo }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Аспарухово/ }));
    const hrefs = screen
      .getAllByRole("menuitem")
      .map((item) => item.getAttribute("href"));
    // ⚠️ The район is IN the list. A settlements-only menu would offer four
    // villages for a story about a Varna district — four wrong answers
    // presented as a choice.
    expect(hrefs).toContain("https://naiasno.bg/governance/VAR06-05");
    expect(hrefs).toContain("https://naiasno.bg/settlement/00775");
  });

  it("tells the candidates apart", async () => {
    // ⚠️ Two entries both reading „Аспарухово" are not a choice.
    render(
      <EntityChips
        title="Места"
        names={["Аспарухово"]}
        candidates={{ Аспарухово: asparuhovo }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Аспарухово/ }));
    expect(screen.getByText("район, общ. Варна, обл. Варна")).toBeVisible();
    expect(
      screen.getByText("населено място, общ. Карнобат, обл. Бургас"),
    ).toBeVisible();
  });

  it("does not assert which one is meant", async () => {
    // ⚠️⚠️ THE COPY IS THE RISK. „Виж профила" over an unverified list turns
    // a refusal into a claim by wording alone.
    render(
      <EntityChips
        title="Места"
        names={["Аспарухово"]}
        candidates={{ Аспарухово: asparuhovo }}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Аспарухово/ });
    expect(trigger.getAttribute("title")).toContain("възможни съвпадения");
    await userEvent.click(trigger);
    expect(screen.getByText(/Не избираме вместо вас/)).toBeVisible();
  });

  it("a resolution outranks an offer", () => {
    // A name in both sidecars renders as the LINK. They are disjoint
    // server-side; if that ever slips, the stronger statement wins.
    render(
      <EntityChips
        title="Хора"
        names={["Иван Христанов"]}
        links={{ "Иван Христанов": link() }}
        candidates={{
          "Иван Христанов": [
            { ...asparuhovo[0]!, kind: "person", canonical: "Друг човек" },
            { ...asparuhovo[1]!, kind: "person", canonical: "Трети човек" },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Иван Христанов/ }),
    ).toHaveAttribute("href", "https://naiasno.bg/person/mp-3931");
    expect(screen.queryByRole("button", { name: /Иван Христанов/ })).toBeNull();
  });

  it("a name with no link and no candidates is still plain text", () => {
    render(
      <EntityChips
        title="Хора"
        names={["Размиг Чакърян-Ами"]}
        candidates={{}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Размиг Чакърян-Ами")).toBeVisible();
  });
});
