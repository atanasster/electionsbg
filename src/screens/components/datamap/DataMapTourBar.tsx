import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataMapTour } from "@/data/dataMap/useDataMap";

type Props = {
  tour: DataMapTour;
  step: number;
  lang: "bg" | "en";
  onStep: (step: number) => void;
  onExit: () => void;
};

/** Fixed bottom narration bar for the guided map stories. */
export const DataMapTourBar: FC<Props> = ({
  tour,
  step,
  lang,
  onStep,
  onExit,
}) => {
  const { t } = useTranslation();
  const current = tour.steps[step];
  if (!current) return null;
  const last = step === tour.steps.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 px-4">
      <div
        role="dialog"
        aria-label={tour.title[lang]}
        className="pointer-events-auto mx-auto max-w-xl rounded-xl border border-accent/60 bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-2 px-4 pt-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("data_map_stories")}
            </div>
            <h4 className="truncate font-display text-base font-bold text-foreground">
              {tour.title[lang]}
            </h4>
          </div>
          <button
            type="button"
            onClick={onExit}
            aria-label={t("data_map_story_exit")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-4 pt-1.5 text-sm leading-6 text-foreground/90">
          {current.text[lang]}
        </p>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {step + 1} / {tour.steps.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onStep(step - 1)}
              disabled={step === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm font-medium transition-colors",
                step === 0
                  ? "cursor-not-allowed opacity-40"
                  : "hover:border-accent hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t("data_map_story_prev")}
            </button>
            <button
              type="button"
              onClick={() => (last ? onExit() : onStep(step + 1))}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              {last ? t("data_map_story_done") : t("data_map_story_next")}
              {!last ? <ChevronRight className="h-3.5 w-3.5" /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
