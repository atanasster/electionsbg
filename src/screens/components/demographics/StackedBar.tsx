import { useTranslation } from "react-i18next";

export type StackedBarSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

export const StackedBar: React.FC<{
  slices: StackedBarSlice[];
  total?: number;
  className?: string;
  showLegend?: boolean;
}> = ({ slices, total, className, showLegend = true }) => {
  const { i18n } = useTranslation();
  const denom =
    total ??
    slices.reduce(
      (sum, s) => sum + (Number.isFinite(s.value) ? s.value : 0),
      0,
    );
  if (!denom) return null;
  const lang = i18n.language;
  return (
    <div className={className}>
      <div
        className="flex w-full h-6 rounded overflow-hidden border border-border/50"
        role="img"
        aria-label="distribution"
      >
        {slices.map((s) => {
          const w = (s.value / denom) * 100;
          if (!w) return null;
          return (
            <div
              key={s.key}
              className="h-full"
              style={{ width: `${w}%`, background: s.color }}
              title={`${s.label}: ${s.value.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB")} (${w.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      {showLegend && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
          {slices.map((s) => {
            const pct = (s.value / denom) * 100;
            if (!s.value) return null;
            return (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: s.color }}
                />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium">{pct.toFixed(1)}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
