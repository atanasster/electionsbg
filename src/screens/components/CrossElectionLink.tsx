// Header "pill" that jumps between a place's local-elections page and its
// parliamentary-elections page (and back). The geographic identifiers are
// shared verbatim across both data trees, so the link is a pure URL rewrite —
// see crossElectionLink.ts.
//
//  - ToParliamentaryLink: rendered on LOCAL pages. Always links (parliamentary
//    data is the geographic superset, so it never 404s).
//  - ToLocalLink: rendered on PARLIAMENTARY pages. Self-hides when the place
//    has no local data in the active cycle (the local index is the guard).

import { FC, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LocalGeoLevel,
  localUrlForParliamentary,
  parliamentaryUrlForLocal,
} from "@/data/local/crossElectionLink";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";

/**
 * The shared chip for „this place / this day, in the other corpus".
 *
 * ⚠ EXPORTED, because `SameDayElectionLink` renders the same control for a different pairing
 * (a local CYCLE and the presidential one held beside it) and a byte-identical private copy is
 * where two links that look alike start behaving differently.
 *
 * ⚠ IT IS NOT `components/ui/Pill`. That is the site's chip primitive; this is a LINK with its
 * own hover affordance, and naming a local copy `Pill` shadows it at the import site.
 */
export const CrossElectionPill: FC<{
  to: string;
  /** Query string to carry across. Pass `""` where there is nothing to preserve. */
  search: string;
  icon: ReactNode;
  label: string;
  title?: string;
  /** Extra classes from the caller — spacing only. */
  className?: string;
}> = ({ to, search, icon, label, title, className }) => (
  <Link
    to={{ pathname: to, search }}
    title={title}
    // ⚠ A FOCUS RING AND A BORDER THAT IS VISIBLE IN LIGHT MODE. `border` alone resolves to the
    // token the repo measured at 1.22:1 against `bg-card`, so the chip reads as floating text to
    // a keyboard user and to anyone in bright light.
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
  >
    {icon}
    <span>{label}</span>
  </Link>
);

// Used on local-elections pages → jumps to the matching parliamentary page.
export const ToParliamentaryLink: FC<{
  level: LocalGeoLevel;
  oblast?: string;
  obshtinaCode?: string;
  ekatte?: string;
}> = (props) => {
  const { t } = useTranslation();
  const { search } = useLocation();
  return (
    <CrossElectionPill
      to={parliamentaryUrlForLocal(props)}
      search={search}
      icon={<Landmark className="h-3.5 w-3.5" aria-hidden />}
      label={t("cross_to_parliamentary")}
      title={t("cross_to_parliamentary_hint")}
    />
  );
};

// Used on parliamentary pages → jumps to the matching local-elections page.
// Self-hides when the place isn't present in the active local cycle's index.
export const ToLocalLink: FC<{
  level: LocalGeoLevel;
  oblast?: string;
  obshtinaCode?: string;
  ekatte?: string;
}> = (props) => {
  const { t } = useTranslation();
  const { search } = useLocation();
  const cycle = useLatestLocalCycle();
  const { data: index } = useLocalElectionIndex(cycle);

  if (!index) return null;
  const available =
    props.level === "region"
      ? index.municipalities.some((m) => m.oblast === props.oblast)
      : props.level === "municipality"
        ? index.municipalities.some(
            (m) => m.obshtinaCode === props.obshtinaCode,
          )
        : true; // country / sofia always resolve when an index exists
  if (!available) return null;

  return (
    <CrossElectionPill
      to={localUrlForParliamentary({ ...props, cycle })}
      search={search}
      icon={<Building2 className="h-3.5 w-3.5" aria-hidden />}
      label={t("cross_to_local")}
      title={t("cross_to_local_hint")}
    />
  );
};
