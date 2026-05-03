import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Globe2, MapPin } from "lucide-react";
import { TopLocation } from "@/data/dashboard/dashboardTypes";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { formatThousands } from "@/data/utils";
import { StatCard } from "./StatCard";

type Props = {
  variant: "diaspora" | "cities";
  items: TopLocation[];
};

export const TopLocationsTile: FC<Props> = ({ variant, items }) => {
  const { t, i18n } = useTranslation();

  const rows = useMemo(() => {
    if (!items.length) return [];
    const max = items[0].sections;
    return items.map((it) => ({
      ...it,
      barPct: max > 0 ? (it.sections / max) * 100 : 0,
      label: i18n.language === "en" && it.name_en ? it.name_en : it.name,
    }));
  }, [items, i18n.language]);

  if (rows.length === 0) return null;

  const labelKey =
    variant === "diaspora" ? "dashboard_top_diaspora" : "dashboard_top_cities";
  const hintKey =
    variant === "diaspora"
      ? "dashboard_top_diaspora_hint"
      : "dashboard_top_cities_hint";
  const Icon = variant === "diaspora" ? Globe2 : MapPin;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t(hintKey)} underline={false}>
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span>{t(labelKey)}</span>
            </div>
          </Hint>
          {variant === "diaspora" ? (
            <Link
              to="/municipality/32"
              className="text-[10px] normal-case text-primary hover:underline"
              underline={false}
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1.5fr)_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {variant === "diaspora" ? t("country") : t("settlement")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_winner")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("sections")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voters")}
        </span>
        {rows.map((r) => (
          <Link
            key={r.ekatte}
            to={r.urlPath ?? `/sections/${r.ekatte}`}
            underline={false}
            className="contents"
          >
            <span className="truncate font-medium">{r.label}</span>
            <span className="flex items-center gap-1.5 min-w-0 text-xs">
              {r.winnerNickName ? (
                <>
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: r.winnerColor ?? "#888" }}
                  />
                  <span className="truncate">{r.winnerNickName}</span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(r.sections)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: r.winnerColor ?? "var(--primary)",
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {r.voters ? formatThousands(r.voters) : ""}
            </span>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
