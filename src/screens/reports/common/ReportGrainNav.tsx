// The grain switcher shown under every anomaly-report title: "По общини ·
// По населени места · По секции", with the grain you're on marked current.
//
// This is the only inbound link the non-default grains have — the reports hub
// deep-links one grain per report type, so without this the other 31 routed
// report pages are reachable only by typing the URL. See reportsMatrix.ts.
//
// Renders nothing when the pathname isn't a report leaf (so the shared
// ReportTemplate can mount it unconditionally) or when the report exists at a
// single grain only (problem_sections, recount_zero_votes) — a one-option
// switcher is noise.

import { FC } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import {
  hasGrainNav,
  parseReportPath,
  reportHref,
  REPORT_GRAIN_LABEL_KEY,
  REPORT_TYPE_GRAINS,
} from "./reportsMatrix";

export const ReportGrainNav: FC<{ className?: string }> = ({ className }) => {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  // ONE predicate decides whether this renders — ReportTemplate suppresses its
  // own level caption on the same call, so a second, independently-written test
  // here could leave the page stating its grain nowhere.
  if (!hasGrainNav(pathname)) return null;
  const here = parseReportPath(pathname);
  if (!here) return null;
  const grains = REPORT_TYPE_GRAINS[here.type];

  return (
    <nav
      aria-label={t("reports_grain_nav_label")}
      className={`flex flex-wrap items-center justify-center gap-1.5 ${className ?? ""}`}
    >
      {grains.map((grain) => {
        const current = grain === here.grain;
        const label = t(REPORT_GRAIN_LABEL_KEY[grain]);
        // The active grain is the page you're already on — render it as static
        // text, not a self-link, so the pill row doesn't advertise a no-op.
        return current ? (
          <span
            key={grain}
            aria-current="page"
            className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary sm:text-sm"
          >
            {label}
          </span>
        ) : (
          <Link
            key={grain}
            to={reportHref(grain, here.type)}
            underline={false}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:text-sm"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
};
