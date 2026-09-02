import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BRIEFING_PREFERENCES,
  type BriefingPreferences,
} from "../briefing";
import { BriefingControls } from "./BriefingControls";
import { NewsLocaleProvider, type NewsLanguage } from "../i18n";

const Harness = ({
  onComplete = vi.fn(),
  language = "bg",
  initial = DEFAULT_BRIEFING_PREFERENCES,
  newStoryCount = 2,
  personalizationPaused = false,
}: {
  onComplete?: () => void;
  language?: NewsLanguage;
  initial?: BriefingPreferences;
  newStoryCount?: number;
  personalizationPaused?: boolean;
}) => {
  const [preferences, setPreferences] = useState<BriefingPreferences>(initial);
  return (
    <NewsLocaleProvider language={language}>
      <BriefingControls
        preferences={preferences}
        activeCadence={preferences.cadence}
        topics={[
          { id: "politics", label: "Политика", count: 6 },
          { id: "economy", label: "Икономика", count: 4 },
        ]}
        newStoryCount={newStoryCount}
        personalizationPaused={personalizationPaused}
        onChange={setPreferences}
        onCadenceChange={() => undefined}
        onComplete={onComplete}
      />
    </NewsLocaleProvider>
  );
};

afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));

describe("BriefingControls", () => {
  it("explains the finite, local and outside-interest contract", () => {
    render(<Harness />);
    expect(screen.getByText("Краен списък")).toBeVisible();
    // ⚠️ The privacy fact stays VISIBLE while the settings move behind a
    // disclosure. Where a reader's preferences are stored is not an advanced
    // setting, and making them open a control to find out would be a
    // transparency regression dressed as a layout improvement.
    expect(screen.getByText(/· само в този браузър$/)).toBeVisible();
    // The full explanation is inside the disclosure — present, not visible
    // until opened.
    expect(
      screen.getByText(/Филтрите на страницата се прилагат първо/),
    ).not.toBeVisible();
  });

  it("updates format and followed topics without emitting topic ids", async () => {
    const user = userEvent.setup();
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Компактен" }));
    await user.click(screen.getByRole("button", { name: /Политика · 6/ }));

    expect(screen.getByRole("button", { name: "Компактен" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Политика · 6/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(sink.mock.calls)).not.toContain("politics");
  });

  it("marks the finite briefing complete", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(<Harness onComplete={onComplete} />);

    await user.click(
      screen.getByRole("button", { name: "Приключих прегледа" }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_task",
        task: "briefing",
        signal: "completed",
      }),
    );
  });

  it("uses singular story copy and disables an unchanged completed briefing", () => {
    render(
      <Harness
        initial={{
          ...DEFAULT_BRIEFING_PREFERENCES,
          lastCompletedAt: "2026-09-01T08:00:00Z",
          completedStoryIds: ["one"],
        }}
        newStoryCount={0}
      />,
    );
    expect(screen.getByText(/0 истории/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Прегледът е завършен" }),
    ).toBeDisabled();

    render(
      <Harness
        language="en"
        initial={{
          ...DEFAULT_BRIEFING_PREFERENCES,
          lastCompletedAt: "2026-09-01T08:00:00Z",
          completedStoryIds: ["older"],
        }}
        newStoryCount={1}
      />,
    );
    expect(screen.getByText(/1 story since/)).toBeVisible();
  });

  it("can clear followed topics and explains paused personalization", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...DEFAULT_BRIEFING_PREFERENCES,
          followedTopics: ["politics"],
        }}
        personalizationPaused
      />,
    );
    expect(screen.getByText(/Групирането по интереси е спряно/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Изчисти следваните теми" }),
    );
    expect(
      screen.getByRole("button", { name: /Политика · 6/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps every setting reachable and readable behind the disclosure", async () => {
    // §4.6: the settings move behind a control, so the control itself has to be
    // keyboard-operable and the settings have to still be REACHABLE. A native
    // <details> gives both — Enter on the summary opens it, and its expanded
    // state is announced without an aria-expanded of our own.
    const user = userEvent.setup();
    render(<Harness />);
    const disclosure = screen.getByText("Настройки на прегледа");
    const details = disclosure.closest("details")!;
    expect(details.open).toBe(false);
    expect(
      screen.getByRole("button", { name: "Приключих прегледа" }),
      "the completion action never hides",
    ).toBeVisible();
    // The state of EVERY setting is legible without opening anything — §4.6
    // names four segments, and the followed-topic count was the one nothing
    // asserted.
    expect(
      screen.getByText(
        /^Дневен · Подробен · без следвани теми · още няма завършен преглед · само в този браузър$/,
      ),
    ).toBeVisible();

    // ⚠️ CLICK, not Enter. jsdom implements `<summary>`'s click activation but
    // not its keyboard default action, so an Enter here would fail against a
    // control that works perfectly in every browser. What is asserted is that
    // the summary is FOCUSABLE — the precondition keyboard activation needs —
    // and the real key press is exercised in `tests/news/`.
    const summary = disclosure.closest("summary")!;
    summary.focus();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(details.open).toBe(true);
    for (const name of ["Дневен", "Седмичен", "Компактен", "Подробен"])
      expect(screen.getByRole("button", { name })).toBeVisible();
  });

  it("gives the disclosure a touch target and a visible focus ring", () => {
    // ⚠️ A <summary> is 20px tall by default — under half the 44px minimum —
    // and it takes focus, so it also needs a ring that is not the browser's
    // default outline this design system removes.
    render(<Harness />);
    const summary = screen
      .getByText("Настройки на прегледа")
      .closest("summary")!;
    expect(summary.className).toContain("min-h-11");
    expect(summary.className).toContain("focus-visible:ring-2");
    expect(summary.className).toContain("focus-visible:ring-offset-2");
  });

  it("does not add a third live region to the page", () => {
    // ⚠️ The summary is descriptive text. Every control it describes announces
    // its own change through `aria-pressed`, and `HomeScreen` already keeps an
    // sr-only live region for the story count — so `role="status"` here made a
    // cadence change announce twice. The paused-personalization notice keeps
    // its status role: that one IS an event, not a description.
    render(<Harness />);
    const summary = screen.getByText(/^Дневен · Подробен ·/);
    expect(summary).not.toHaveAttribute("role");
    expect(summary.closest("[aria-live]")).toBeNull();
  });
});
