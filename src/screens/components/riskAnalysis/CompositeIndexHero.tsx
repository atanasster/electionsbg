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
import { Link } from "@/ux/Link";

// Hero shown at the top of /risk-analysis. The headline 0–100 is the
// INTEGRITY track only (5 process-integrity signals). The CONTEXT track
// (Benford, neighborhood swing, electoral volatility, polling error) is
// shown alongside but not folded into the score — those signals can light
// up in perfectly clean elections.

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

const INTEGRITY_ORDER: RiskCompositeComponent["id"][] = [
  "sections",
  "machine",
  "missingFlash",
  "concentration",
  "procedural",
];

const CONTEXT_ORDER: RiskCompositeComponent["id"][] = [
  "benford",
  "neighborhoodsSwing",
  "voteSwitching",
  "polls",
  "clusters",
];

const componentBarColor = (value: number): string =>
  value < 20
    ? "bg-emerald-500"
    : value < 40
      ? "bg-amber-500"
      : value < 60
        ? "bg-orange-500"
        : "bg-red-500";

const Tile: FC<{
  component: RiskCompositeComponent;
  muted?: boolean;
}> = ({ component: c, muted }) => {
  const { t } = useTranslation();
  const value = Math.round(c.value);
  return (
    <Hint text={t(`composite_component_${c.id}_hint`)} underline={false}>
      <div
        className={cn(
          "h-full rounded-lg border p-3 flex flex-col gap-1.5",
          c.available ? "bg-background" : "bg-muted/30 opacity-60",
          muted && c.available && "bg-muted/20",
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
};

export const CompositeIndexHero: FC = () => {
  const { t } = useTranslation();
  const composite = useRiskComposite();
  if (!composite) return null;

  const Icon = BAND_ICONS[composite.band];
  const score = Math.round(composite.score);

  const integrity = composite.components
    .filter((c) => c.track === "integrity")
    .sort(
      (a, b) => INTEGRITY_ORDER.indexOf(a.id) - INTEGRITY_ORDER.indexOf(b.id),
    );
  const context = composite.components
    .filter((c) => c.track === "context")
    .sort((a, b) => CONTEXT_ORDER.indexOf(a.id) - CONTEXT_ORDER.indexOf(b.id));

  return (
    <div
      data-og="composite-index-hero"
      className="rounded-2xl border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Hint text={t("composite_index_hint")} underline={false}>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t("composite_index_label")}
            </span>
          </Hint>
          <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t("composite_index_experimental")}
          </span>
        </div>
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
            available: composite.integrityAvailableCount,
            total: composite.integrityTotalCount,
          })}
        </p>
        <Link
          to="/risk-analysis/methodology"
          underline={false}
          className="text-[11px] uppercase tracking-wide text-primary hover:underline shrink-0 self-start md:self-center"
        >
          {t("composite_index_methodology")} →
        </Link>
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-2">
          {t("composite_track_integrity")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {integrity.map((c) => (
            <Tile key={c.id} component={c} />
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("composite_track_context")}
          </span>
          {composite.contextScore != null ? (
            <Hint text={t("composite_context_hint")} underline={false}>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {t("composite_context_average", {
                  value: Math.round(composite.contextScore),
                })}
              </span>
            </Hint>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {context.map((c) => (
            <Tile key={c.id} component={c} muted />
          ))}
        </div>
      </div>

      <div
        className={cn("mt-3 h-0.5 rounded-full", BAND_ACCENT[composite.band])}
      />
    </div>
  );
};
