import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionNavigator } from "./InteractionNavigator";

const messages = [
  { id: 7, role: "user" as const, text: "First question" },
  { id: 8, role: "assistant" as const, text: "First answer" },
  { id: 12, role: "user" as const, text: "Second question" },
  { id: 13, role: "assistant" as const, text: "" },
];

describe("interaction navigator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelector("[data-chat-toolbar]")?.remove();
  });
  it.each([0, 118])(
    "keeps the chosen prompt below a toolbar ending at %s px",
    (toolbarBottom) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: false })),
      );
      const toolbar = document.createElement("nav");
      toolbar.dataset.chatToolbar = "";
      document.body.append(toolbar);
      vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
        bottom: toolbarBottom,
      } as DOMRect);
      const contentRef = createRef<HTMLDivElement>();
      const onNavigate = vi.fn();
      const scrollTo = vi.fn();
      const { container } = render(
        <div style={{ overflowY: "auto" }}>
          <InteractionNavigator
            messages={messages}
            contentRef={contentRef}
            lang="en"
            onNavigate={onNavigate}
          />
          <div ref={contentRef}>
            <div data-interaction="7" tabIndex={-1}>
              First question
            </div>
            <div data-interaction="12" tabIndex={-1}>
              Second question
            </div>
          </div>
        </div>,
      );
      const scroller = container.firstElementChild as HTMLElement;
      scroller.scrollTo = scrollTo;
      const target = container.querySelector<HTMLElement>(
        '[data-interaction="12"]',
      )!;
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
        top: 320,
      } as DOMRect);
      expect(screen.getAllByRole("button")).toHaveLength(2);
      fireEvent.click(
        screen.getByRole("button", { name: "2. Second question" }),
      );
      expect(onNavigate).toHaveBeenCalledOnce();
      expect(scrollTo).toHaveBeenCalledWith({
        top: 304 - toolbarBottom,
        behavior: "smooth",
      });
      expect(target).toHaveFocus();
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
        top: toolbarBottom + 16,
      } as DOMRect);
      fireEvent.scroll(window);
      expect(
        screen.getByRole("button", { name: "2. Second question" }),
      ).toHaveAttribute("aria-current", "step");
      toolbar.remove();
    },
  );

  it("does not show a rail for an empty or single-exchange chat", () => {
    const contentRef = createRef<HTMLDivElement>();
    const { rerender } = render(
      <InteractionNavigator
        messages={[]}
        contentRef={contentRef}
        lang="bg"
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    rerender(
      <InteractionNavigator
        messages={messages.slice(0, 2)}
        contentRef={contentRef}
        lang="bg"
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
