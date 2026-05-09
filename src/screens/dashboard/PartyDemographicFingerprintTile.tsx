import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { usePartyDemographicCorrelations } from "@/data/parties/usePartyDemographicCorrelations";
import { Hint } from "@/ux/Hint";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import { StatCard } from "./StatCard";

const TOP_CHIPS = 3;
// Don't surface a chip unless the correlation is at least mildly meaningful.
// Below this, the metric is effectively noise and labeling it "strongest"
// overstates its weight.
const CHIP_MIN_ABS_R = 0.2;
const POSITIVE_COLOR = "hsl(140, 60%, 40%)";
const NEGATIVE_COLOR = "hsl(0, 70%, 50%)";

const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}`;

type Props = { data: PartyDashboardSummary };

export const PartyDemographicFingerprintTile: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  const { data: payload } = usePartyDemographicCorrelations(data.partyNum);

  const rows = useMemo(() => {
    if (!payload?.correlations) return [];
    return payload.correlations
      .filter((c) => c.n >= 3 && Number.isFinite(c.r))
      .sort((a, b) => b.r - a.r);
  }, [payload]);

  if (rows.length === 0) return null;

  const positives = rows
    .filter((r) => r.r >= CHIP_MIN_ABS_R)
    .slice(0, TOP_CHIPS);
  const negatives = rows
    .filter((r) => r.r <= -CHIP_MIN_ABS_R)
    .slice(-TOP_CHIPS)
    .reverse();
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.r)), 0.01);

  const linkFor = (metric: string) =>
    `/demographics?scatterParty=${data.partyNum}&scatter=${metric}#scatter`;

  const renderChip = (
    metric: string,
    r: number,
    color: string,
    key: string,
  ) => {
    const def = METRIC_BY_KEY[metric as keyof typeof METRIC_BY_KEY];
    const label = def ? t(def.i18nKey) : metric;
    return (
      <Link
        key={key}
        to={linkFor(metric)}
        className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted transition-colors"
      >
        <span className="font-medium">{label}</span>
        <span
          className="font-semibold tabular-nums"
          style={{ color }}
        >
          {fmtR(r)}
        </span>
      </Link>
    );
  };

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_party_fingerprint_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{t("dashboard_party_fingerprint")}</span>
            </div>
          </Hint>
        </div>
      }
      className="overflow-hidden"
    >
      {(positives.length > 0 || negatives.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 mt-1 mb-3">
          {positives.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("dashboard_party_fingerprint_strongest_positive")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {positives.map((c) =>
                  renderChip(c.metric, c.r, POSITIVE_COLOR, `pos-${c.metric}`),
                )}
              </div>
            </div>
          )}
          {negatives.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("dashboard_party_fingerprint_strongest_negative")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {negatives.map((c) =>
                  renderChip(c.metric, c.r, NEGATIVE_COLOR, `neg-${c.metric}`),
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,2fr)_auto] gap-x-3 gap-y-1 items-center text-sm">
        {rows.map((row) => {
          const def = METRIC_BY_KEY[row.metric as keyof typeof METRIC_BY_KEY];
          const label = def ? t(def.i18nKey) : row.metric;
          const sign = row.r >= 0 ? 1 : -1;
          const widthPct = (Math.abs(row.r) / maxAbs) * 50;
          const color = sign > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
          return (
            <Link
              key={row.metric}
              to={linkFor(row.metric)}
              className="contents group"
            >
              <span className="text-xs leading-tight group-hover:underline">
                {label}
              </span>
              {/* Diverging bar: zero at center, grows left for negative, right for positive. */}
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                <div
                  className="absolute top-0 bottom-0 rounded-full"
                  style={{
                    backgroundColor: color,
                    width: `${Math.max(1.5, widthPct)}%`,
                    left: sign > 0 ? "50%" : `${50 - Math.max(1.5, widthPct)}%`,
                  }}
                />
              </div>
              <span
                className="text-xs font-semibold tabular-nums text-right w-12"
                style={{ color }}
              >
                {fmtR(row.r)}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground italic mt-3">
        {t("dashboard_party_fingerprint_note", { count: rows.length })}
      </p>
    </StatCard>
  );
};
