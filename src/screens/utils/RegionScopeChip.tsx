import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, X } from "lucide-react";

type Props = {
  label: string;
  /** Search params to navigate back to (without the region keys). */
  clearedParams: URLSearchParams;
};

export const RegionScopeChip: FC<Props> = ({ label, clearedParams }) => {
  const { t } = useTranslation();
  const search = clearedParams.toString();
  const to = search ? { search: `?${search}` } : { search: "" };
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-muted/40"
      title={
        t("region_scope_chip_tooltip") ||
        "Filtered to MPs from this region. Click × to show all MPs."
      }
    >
      <MapPin className="h-3 w-3" />
      <span className="truncate max-w-[180px]">{label}</span>
      <Link
        to={to}
        replace
        aria-label={t("region_scope_chip_clear") || "Clear region filter"}
        className="hover:text-foreground text-muted-foreground"
      >
        <X className="h-3 w-3" />
      </Link>
    </span>
  );
};
