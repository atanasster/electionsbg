import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, stories } from "../labels";
import {
  MAX_FOLLOWED_TOPICS,
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
  topics,
  newStoryCount,
  personalizationPaused,
  onChange,
  onCadenceChange,
  onComplete,
}: {
  preferences: BriefingPreferences;
  activeCadence: BriefingCadence | "custom";
  topics: BriefingTopicOption[];
  newStoryCount: number | null;
  personalizationPaused: boolean;
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
  const toggleTopic = (id: string) => {
    const active = preferences.followedTopics.includes(id);
    const followedTopics = active
      ? preferences.followedTopics.filter((topic) => topic !== id)
      : [...preferences.followedTopics, id].slice(0, MAX_FOLLOWED_TOPICS);
    emitNewsEvent({
      name: "briefing_preference",
      preference: "topic",
      active: !active,
    });
    onChange({ ...preferences, followedTopics });
  };
  const clearTopics = () => {
    if (!preferences.followedTopics.length) return;
    emitNewsEvent({
      name: "briefing_preference",
      preference: "topic",
      active: false,
    });
    onChange({ ...preferences, followedTopics: [] });
  };
  const isComplete =
    Boolean(preferences.lastCompletedAt) && newStoryCount === 0;

  return (
    <Card className="p-4 sm:p-5" aria-labelledby="briefing-controls-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="briefing-controls-heading" className="app-section-title">
              {tr("Моят кратък преглед", "My briefing")}
            </h2>
            <Badge variant="outline" className="font-normal">
              {tr("Краен списък", "Finite list")}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {tr(
              "Предпочитанията се пазят само в този браузър. Филтрите на страницата се прилагат първо; следваните теми само групират оставащия краен списък.",
              "Preferences stay in this browser. Page filters apply first; followed topics only group the remaining finite list.",
            )}
          </p>
          {personalizationPaused ? (
            <p
              className="mt-1 text-sm font-medium text-foreground"
              role="status"
            >
              {tr(
                "Групирането по интереси е спряно, докато търсенето или тематичният филтър са активни — показани са всички подбрани съвпадения.",
                "Interest grouping is paused while search or a topic filter is active, so every selected match is shown.",
              )}
            </p>
          ) : null}
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

      <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-3">
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
        <div role="status" className="text-sm text-muted-foreground">
          <p className="text-xs font-semibold uppercase tracking-wide">
            {tr("От последния преглед", "Since last briefing")}
          </p>
          <p className="mt-2">
            {preferences.lastCompletedAt
              ? `${stories(newStoryCount ?? 0, language)} · ${formatDate(preferences.lastCompletedAt, language)}`
              : tr(
                  "Това е първият отбелязан преглед.",
                  "This will be your first completed briefing.",
                )}
          </p>
        </div>
      </div>

      {topics.length ? (
        <div className="mt-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Следвани теми", "Followed topics")}
            </p>
            {preferences.followedTopics.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearTopics}
              >
                {tr("Изчисти следваните теми", "Clear followed topics")}
              </Button>
            ) : null}
          </div>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label={tr("Избор на следвани теми", "Choose followed topics")}
          >
            {topics.map((topic) => (
              <Button
                key={topic.id}
                type="button"
                size="sm"
                variant={
                  preferences.followedTopics.includes(topic.id)
                    ? "secondary"
                    : "outline"
                }
                className="rounded-full"
                aria-pressed={preferences.followedTopics.includes(topic.id)}
                onClick={() => toggleTopic(topic.id)}
              >
                {topic.label} · {topic.count}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
};
