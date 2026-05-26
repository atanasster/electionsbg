// Tiny loading shell shared by the three Sankey drilldowns
// (Общини / Социалноосигурителни фондове / Капиталови разходи).
//
// Each drilldown fetches a small JSON artifact (16-50 KB) the first time
// the leaf is clicked. On a warm cache the data is available synchronously
// and this shell is bypassed; on a cold cache (production, GCS-backed) the
// first paint shows nothing until React Query resolves. This component
// fills that gap with the panel chrome + a "Loading…" placeholder so the
// click feels responsive and the close button works even before data
// arrives (e.g. the user changes their mind mid-fetch).

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X, type LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  onClose: () => void;
  closeAriaLabel: string;
  // Optional supplementary copy under the title (e.g. "· 2024 г." chip).
  subtitle?: ReactNode;
}

export const DrilldownLoadingShell: FC<Props> = ({
  icon: Icon,
  title,
  onClose,
  closeAriaLabel,
  subtitle,
}) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border bg-muted/30 p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4" />
          {title}
          {subtitle ? (
            <span className="text-xs text-muted-foreground font-normal">
              {subtitle}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
          aria-label={closeAriaLabel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Animated placeholder rows — three skeleton bars approximate the
          shape of the typical category-tiles + per-row list. */}
      <div className="space-y-2 animate-pulse">
        <div className="h-3 w-2/3 rounded bg-muted" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded border bg-card/60" />
          ))}
        </div>
        <div className="h-3 w-1/2 rounded bg-muted mt-3" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-full rounded bg-card/60" />
        ))}
      </div>
      <p className="sr-only">{t("drilldown_loading") || "Loading…"}</p>
    </div>
  );
};
