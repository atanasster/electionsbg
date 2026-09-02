// The pill's behaviour, not its class string. The contrast fix that motivated
// this component is a colour change, and a colour change cannot convey state to
// anyone who does not perceive it — so the ARIA half is the half worth pinning.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Pill, PillGroup, PillLink } from "./Pill";
import { pillClass } from "./pillClass";

describe("Pill", () => {
  it("announces its selected state", () => {
    render(<Pill selected>Всичко</Pill>);
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
      "Всичко",
    );
  });

  it("announces the unselected state too, rather than omitting it", () => {
    // `aria-pressed={false}` is not the same as no attribute: without it a
    // screen reader announces a plain button and the row has no state at all.
    render(<Pill>Избори</Pill>);
    expect(screen.getByRole("button", { pressed: false })).toBeInTheDocument();
  });

  it("is a button, so it never submits a form it happens to sit in", () => {
    render(<Pill>x</Pill>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("forwards click and the rest of the button props", () => {
    render(
      <Pill disabled title="hint">
        x
      </Pill>,
    );
    const b = screen.getByRole("button");
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "hint");
  });

  it("calls onClick", async () => {
    let hits = 0;
    render(<Pill onClick={() => hits++}>x</Pill>);
    await userEvent.click(screen.getByRole("button"));
    expect(hits).toBe(1);
  });
});

describe("PillLink", () => {
  it("uses aria-current, not aria-pressed", () => {
    // It moves you somewhere; it does not toggle. `pressed` on a link is not a
    // valid state and screen readers ignore it.
    render(
      <MemoryRouter>
        <PillLink to="/data" selected>
          Карта
        </PillLink>
      </MemoryRouter>,
    );
    const a = screen.getByRole("link", { current: "page" });
    expect(a).toHaveAttribute("href", "/data");
    expect(a).not.toHaveAttribute("aria-pressed");
  });

  it("omits aria-current when not selected", () => {
    render(
      <MemoryRouter>
        <PillLink to="/data/links">Връзки</PillLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
  });

  it("forwards the rest of the link props", () => {
    // Without this a caller needing `title` or `onClick` hand-rolls a fourth
    // copy of the pill, which is what the component exists to stop.
    render(
      <MemoryRouter>
        <PillLink to="/x" title="hint" target="_blank">
          x
        </PillLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("title", "hint");
  });
});

describe("PillGroup", () => {
  it("is a group, not a navigation landmark, by default", () => {
    // A row of aria-pressed toggles is a toolbar. Announcing it as `navigation`
    // puts a filter in the screen reader's list of destinations to jump to.
    render(
      <PillGroup label="Изгледи">
        <Pill>a</Pill>
      </PillGroup>,
    );
    expect(screen.getByRole("group", { name: "Изгледи" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("is a navigation landmark when it holds links", () => {
    render(
      <MemoryRouter>
        <PillGroup nav label="Данни">
          <PillLink to="/data">a</PillLink>
        </PillGroup>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("navigation", { name: "Данни" }),
    ).toBeInTheDocument();
  });

  it("does not bleed on its own", () => {
    // The bleed cancels Layout's `p-2` and belongs to whichever element sits on
    // that padding. Applying it here too nested two of them, and they cancelled
    // only because both happened to be 0.5rem.
    const { container } = render(
      <PillGroup label="x" scroll>
        <Pill>a</Pill>
      </PillGroup>,
    );
    expect(container.firstElementChild?.className).not.toMatch(/-mx-2/);
    expect(container.firstElementChild?.className).toMatch(/overflow-x-auto/);
  });
});

describe("pillClass", () => {
  it("gives selected and unselected different fills", () => {
    // The whole point of the token split: the selected chip is the one strong
    // signal on the row.
    expect(pillClass(true)).toMatch(/(^|\s)bg-accent-strong(\s|$)/);
    // Unselected carries the fill only behind `hover:`, so anchor on the
    // unprefixed utility rather than the substring.
    expect(pillClass(false)).not.toMatch(/(^|\s)bg-accent-strong(\s|$)/);
  });

  it("never lets hover adopt the full selected treatment", () => {
    // Hovering pill B while A is selected otherwise renders two pills in the
    // selected state at once, with nothing telling them apart.
    expect(pillClass(false)).not.toMatch(/hover:bg-accent-strong\s/);
    expect(pillClass(false)).toMatch(/hover:bg-accent-strong\/10/);
  });

  it("pairs the focus ring offset with a themed colour", () => {
    // Tailwind's default offset is #fff, which draws a white band between chip
    // and ring on the dark theme.
    expect(pillClass(false)).toMatch(/focus-visible:ring-offset-background/);
  });
});
