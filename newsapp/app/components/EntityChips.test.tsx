// Entity chips — a link only where the name earned one.
//
// ⚠️ These chips sit beside a named individual's name on a public page. A
// chip that looks like a link and goes nowhere, or one that links to the
// wrong person, is the harm the whole mention layer is built to avoid.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntityChips } from "./EntityChips";
import type { EntityLink } from "../data";

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
    expect(
      screen.getByRole("link", { name: /Иван Христанов/ }),
    ).toHaveAttribute("href", "https://electionsbg.com/person/mp-3931");
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
    // ⚠️ The news app is a different origin from electionsbg.com, so these
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
    expect(a.getAttribute("href")).toMatch(/^https:\/\/electionsbg\.com\//);
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
