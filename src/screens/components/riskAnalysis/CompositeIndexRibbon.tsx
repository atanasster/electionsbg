import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  useRiskComposite,
  type RiskCompositeBand,
  type RiskCompositeComponent,
} from "@/data/riskScore/useRiskComposite";
import { cn } from "@/lib/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";

// Slim ribbon shown at the top of the home Anomalies section. Shows the
// composite + 5 mini-bars in one row; the "see full analysis" link
// becomes the ribbon's call-to-action so it doesn't compete with the
// section-header link slot.

const BAND_CLASSES: Record<RiskCompositeBand, string> = {
  calm: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-500/40",
  elevated:
    "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border-amber-500/40",
  high: "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200 border-orange-500/40",
  critical:
    "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 border-red-500/40",
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
  "missingFlash",
  "concentration",
  "procedural",
  "neighborhoods",
  "polls",
];

const componentBarColor = (value: number): string =>
  value < 20
    ? "bg-emerald-500"
    : value < 40
      ? "bg-amber-500"
      : value < 60
        ? "bg-orange-500"
        : "bg-red-500";

export const CompositeIndexRibbon: FC = () => {
  const { t } = useTranslation();
  const composite = useRiskComposite();
  if (!composite) return null;

  const Icon = BAND_ICONS[composite.band];
  const score = Math.round(composite.score);
  const ordered = [...composite.components].sort(
    (a, b) => COMPONENT_ORDER.indexOf(a.id) - COMPONENT_ORDER.indexOf(b.id),
  );

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
        <Hint text={t("composite_index_hint")} underline={false}>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground hidden sm:inline">
              {t("composite_index_label")}
            </span>
            <span className="text-3xl font-bold tabular-nums leading-none">
              {score}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold",
                BAND_CLASSES[composite.band],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`composite_band_${composite.band}`)}
            </span>
          </div>
        </Hint>

        <div className="hidden lg:block h-8 w-px bg-border shrink-0" />

        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
          {ordered.map((c) => {
            const value = Math.round(c.value);
            return (
              <Hint
                key={c.id}
                text={t(`composite_component_${c.id}_hint`)}
                underline={false}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-muted-foreground truncate uppercase tracking-wide w-[70px] shrink-0">
                    {t(`composite_component_${c.id}_short`)}
                  </span>
                  <div className="relative h-1.5 rounded-full bg-muted overflow-hidden flex-1 min-w-0">
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
                  <span className="tabular-nums text-[10px] text-muted-foreground w-6 text-right shrink-0">
                    {c.available ? value : "—"}
                  </span>
                </div>
              </Hint>
            );
          })}
        </div>

        <Link
          to="/risk-analysis"
          underline={false}
          className="text-[11px] uppercase tracking-wide text-primary hover:underline shrink-0 self-end lg:self-center"
        >
          {t("composite_index_see_full")} →
        </Link>
      </div>
    </div>
  );
};
