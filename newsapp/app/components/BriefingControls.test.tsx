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
    expect(screen.getByText(/само в този браузър/)).toBeVisible();
    expect(
      screen.getByText(/Филтрите на страницата се прилагат първо/),
    ).toBeVisible();
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
    expect(screen.getByText(/1 story ·/)).toBeVisible();
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
});
