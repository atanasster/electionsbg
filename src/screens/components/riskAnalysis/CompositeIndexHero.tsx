import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  useRiskComposite,
  type RiskCompositeBand,
  type RiskCompositeComponent,
} from "@/data/riskScore/useRiskComposite";
import { cn } from "@/lib/utils";
import { Hint } from "@/ux/Hint";

// Hero shown at the top of /risk-analysis. Always renders the composite
// alongside the breakdown — the breakdown isn't optional, because a
// single number without provenance is exactly the kind of thing the
// methodology callout warns against.

const BAND_CLASSES: Record<RiskCompositeBand, string> = {
  calm: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-500/40",
  elevated:
    "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border-amber-500/40",
  high: "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200 border-orange-500/40",
  critical:
    "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 border-red-500/40",
};

const BAND_ACCENT: Record<RiskCompositeBand, string> = {
  calm: "bg-emerald-500",
  elevated: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
};

const BAND_ICONS: Record<RiskCompositeBand, typeof ShieldAlert> = {
  calm: ShieldCheck,
  elevated: ShieldQuestion,
  high: ShieldAlert,
  critical: ShieldAlert,
};

const COMPONENT_ORDER: RiskCompositeComponent["id"][] = [
  "sections",
  "benford",
  "machine",
  "concentration",
  "procedural",
];

const componentBarColor = (value: number): string =>
  value < 20
    ? "bg-emerald-500"
    : value < 40
      ? "bg-amber-500"
      : value < 60
        ? "bg-orange-500"
        : "bg-red-500";

export const CompositeIndexHero: FC = () => {
  const { t } = useTranslation();
  const composite = useRiskComposite();
  if (!composite) return null;

  const Icon = BAND_ICONS[composite.band];
  const score = Math.round(composite.score);
  const ordered = [...composite.components].sort(
    (a, b) =>
      COMPONENT_ORDER.indexOf(a.id) - COMPONENT_ORDER.indexOf(b.id),
  );

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <Hint text={t("composite_index_hint")} underline={false}>
          <div className="flex items-baseline gap-3 shrink-0">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t("composite_index_label")}
            </span>
          </div>
        </Hint>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-5xl font-bold tabular-nums leading-none">
            {score}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold",
              BAND_CLASSES[composite.band],
            )}
          >
            <Icon className="h-4 w-4" />
            {t(`composite_band_${composite.band}`)}
          </span>
        </div>
        <div className="hidden md:block h-12 w-px bg-border shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed flex-1">
          {t("composite_index_caption", {
            available: composite.availableCount,
            total: composite.totalCount,
          })}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {ordered.map((c) => {
          const value = Math.round(c.value);
          return (
            <Hint
              key={c.id}
              text={t(`composite_component_${c.id}_hint`)}
              underline={false}
            >
              <div
                className={cn(
                  "rounded-lg border p-3 flex flex-col gap-1.5",
                  c.available ? "bg-background" : "bg-muted/30 opacity-60",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    {t(`composite_component_${c.id}`)}
                  </span>
                  <span className="text-base font-semibold tabular-nums">
                    {c.available ? value : "—"}
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                  {c.available ? (
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        componentBarColor(c.value),
                      )}
                      style={{ width: `${Math.max(2, c.value)}%` }}
                    />
                  ) : null}
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {c.available
                    ? (c.detail ?? " ")
                    : t("composite_component_unavailable")}
                </span>
              </div>
            </Hint>
          );
        })}
      </div>

      <div className={cn("mt-3 h-0.5 rounded-full", BAND_ACCENT[composite.band])} />
    </div>
  );
};
