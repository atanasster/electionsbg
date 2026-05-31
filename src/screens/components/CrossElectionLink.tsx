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
import {
  LocalGeoLevel,
  localUrlForParliamentary,
  parliamentaryUrlForLocal,
} from "@/data/local/crossElectionLink";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";

const CrossElectionPill: FC<{
  to: string;
  search: string;
  icon: ReactNode;
  label: string;
  title?: string;
}> = ({ to, search, icon, label, title }) => (
  <Link
    to={{ pathname: to, search }}
    title={title}
    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
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
