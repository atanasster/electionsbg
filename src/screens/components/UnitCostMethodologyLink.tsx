// The one backlink from a unit-cost tile to the family's shared methodology
// (governance/sectors/methodology). Exists so the three legs — courts €/case,
// roads €/km, health €/case — stop restating the same caveat in three different
// wordings; see docs/plans/procurement-outcomes-v1.md §3.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { usePreserveParams } from "@/ux/usePreserveParams";

export const UnitCostMethodologyLink: FC<{ className?: string }> = ({
  className,
}) => {
  const { t } = useTranslation();
  const searchParams = usePreserveParams();
  const merged = searchParams().toString();
  const to = merged
    ? `/governance/sectors/methodology?${merged}`
    : "/governance/sectors/methodology";
  return (
    <Link
      to={to}
      className={`text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground ${className ?? ""}`}
    >
      {t("unit_cost_backlink") || "How this number is computed"}
    </Link>
  );
};
