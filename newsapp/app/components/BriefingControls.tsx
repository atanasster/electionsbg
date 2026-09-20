// The briefing toolbar — one summary line, the completion action, and the
// advanced settings behind a disclosure.
//
// ⚠️ IT INTERRUPTS THE STORY RHYTHM, so it has to be small. As a full panel it
// sat after only two supporting cards and was taller than the cards either side
// of it, which made a settings surface the visual centre of a page about
// stories. The settings did not change; where they LIVE did.
//
// ⚠️ A native <details>, not a custom disclosure. It is keyboard-operable,
// announces its own expanded state, and — the part a custom widget usually
// loses — a browser's in-page find can open it to reveal a match inside.
//
// PREFERENCES AND BEHAVIOUR ARE UNCHANGED by this pass: same local-storage
// contract, same events, same completion semantics.

import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, stories } from "../labels";
import {
  type BriefingCadence,
  type BriefingDensity,
  type BriefingPreferences,
} from "../briefing";
import { emitNewsEvent } from "../analytics";
import { useNewsLocale } from "../i18n";

export interface BriefingTopicOption {
  id: string;
  label: string;
  count: number;
}

export const BriefingControls = ({
  preferences,
  activeCadence,
  newStoryCount,
  onChange,
  onCadenceChange,
  onComplete,
}: {
  preferences: BriefingPreferences;
  activeCadence: BriefingCadence | "custom";
  newStoryCount: number | null;
  onChange: (preferences: BriefingPreferences) => void;
  onCadenceChange: (cadence: BriefingCadence) => void;
  onComplete: () => void;
}) => {
  const { language, tr } = useNewsLocale();
  const setCadence = (cadence: BriefingCadence) => {
    emitNewsEvent({
      name: "briefing_preference",
      preference: "cadence",
      active: cadence === "weekly",
    });
    onCadenceChange(cadence);
  };
  const setDensity = (density: BriefingDensity) => {
    emitNewsEvent({
      name: "briefing_preference",
      preference: "density",
      active: density === "compact",
    });
    onChange({ ...preferences, density });
  };
  const isComplete =
    Boolean(preferences.lastCompletedAt) && newStoryCount === 0;

  const cadenceLabel =
    activeCadence === "daily"
      ? tr("Дневен", "Daily")
      : activeCadence === "weekly"
        ? tr("Седмичен", "Weekly")
        : tr("Персонализиран период", "Custom period");
  const densityLabel =
    preferences.density === "compact"
      ? tr("Компактен", "Compact")
      : tr("Подробен", "Detailed");
  // The state of every setting, in one line — so opening the disclosure is a
  // choice to CHANGE something rather than the only way to see what is set.
  const summary = [
    cadenceLabel,
    densityLabel,
    preferences.lastCompletedAt
      ? `${stories(newStoryCount ?? 0, language)} ${tr("от", "since")} ${formatDate(preferences.lastCompletedAt, language)}`
      : tr("още няма завършен преглед", "no completed briefing yet"),
    // ⚠️ STAYS OUT of the disclosure. Where a reader's preferences are stored
    // is a privacy fact, not an advanced setting — putting it behind a control
    // they have to open makes the disclosure the price of knowing. The full
    // sentence is inside; this clause is what keeps the fact itself visible.
    tr("само в този браузър", "this browser only"),
  ].join(" · ");

  return (
    <Card
      className="news-briefing-bar px-4 py-3"
      aria-labelledby="briefing-controls-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2
            id="briefing-controls-heading"
            className="app-section-title text-sm"
          >
            {tr("Моят кратък преглед", "My briefing")}
          </h2>
          <Badge variant="outline" className="font-normal">
            {tr("Краен списък", "Finite list")}
          </Badge>
          {/* ⚠️ NOT role="status". It is descriptive text, and every control
              it describes already announces its own change through
              `aria-pressed` — while `HomeScreen` keeps its own sr-only live
              region for the story count. A third live region made a cadence
              change announce twice. */}
          <p className="min-w-0 text-xs text-muted-foreground">{summary}</p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={isComplete}
          onClick={() => {
            emitNewsEvent({
              name: "reader_task",
              task: "briefing",
              signal: "completed",
            });
            onComplete();
          }}
        >
          {isComplete
            ? tr("Прегледът е завършен", "Briefing complete")
            : tr("Приключих прегледа", "Finish briefing")}
        </Button>
      </div>

      <details className="group mt-2">
        <summary className="news-briefing-summary flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card [&::-webkit-details-marker]:hidden">
          <span>{tr("Настройки на прегледа", "Briefing settings")}</span>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {tr(
            "Предпочитанията се пазят само в този браузър.",
            "Preferences stay in this browser.",
          )}
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Ритъм", "Cadence")}
            </p>
            <div
              className="mt-2 flex gap-2"
              role="group"
              aria-label={tr("Ритъм на прегледа", "Briefing cadence")}
            >
              {(["daily", "weekly"] as const).map((cadence) => (
                <Button
                  key={cadence}
                  type="button"
                  size="sm"
                  variant={activeCadence === cadence ? "default" : "outline"}
                  aria-pressed={activeCadence === cadence}
                  onClick={() => setCadence(cadence)}
                >
                  {cadence === "daily"
                    ? tr("Дневен", "Daily")
                    : tr("Седмичен", "Weekly")}
                </Button>
              ))}
            </div>
            {activeCadence === "custom" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {tr(
                  "Активен е персонализиран период от 30 дни.",
                  "A custom 30-day period is active.",
                )}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Формат", "Format")}
            </p>
            <div
              className="mt-2 flex gap-2"
              role="group"
              aria-label={tr("Формат на картите", "Card format")}
            >
              {(["compact", "detailed"] as const).map((density) => (
                <Button
                  key={density}
                  type="button"
                  size="sm"
                  variant={
                    preferences.density === density ? "default" : "outline"
                  }
                  aria-pressed={preferences.density === density}
                  onClick={() => setDensity(density)}
                >
                  {density === "compact"
                    ? tr("Компактен", "Compact")
                    : tr("Подробен", "Detailed")}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </details>
    </Card>
  );
};
