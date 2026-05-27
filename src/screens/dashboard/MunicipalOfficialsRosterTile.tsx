// Collapsible roster table — top 15 rows by default, "Show all (N)" expands
// in place. The full shard is already in React Query's cache (loaded by the
// sibling Mayor / Composition tiles), so expanding does NOT trigger a
// second fetch.
//
// Entries are pre-sorted at build time in roster-display order
// (mayor → deputies → council chair → chief architect → councillors alpha),
// so `.slice(0, 15)` works without re-sorting on every render.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import type { MunicipalOfficialRole } from "@/data/dataTypes";
import { StatCard } from "./StatCard";

type Props = {
  obshtinaCode: string;
  className?: string;
};

const DEFAULT_ROWS = 15;

const ROLE_LABEL_KEYS: Record<
  MunicipalOfficialRole,
  { i18n: string; fallback: string }
> = {
  mayor: { i18n: "municipal_role_mayor", fallback: "Mayor" },
  deputy_mayor: {
    i18n: "municipal_role_deputy_mayor",
    fallback: "Deputy mayor",
  },
  council_chair: {
    i18n: "municipal_role_council_chair",
    fallback: "Council chair",
  },
  councillor: { i18n: "municipal_role_councillor", fallback: "Councillor" },
  chief_architect: {
    i18n: "municipal_role_chief_architect",
    fallback: "Chief architect",
  },
  other: { i18n: "municipal_role_other", fallback: "Other" },
};

export const MunicipalOfficialsRosterTile: FC<Props> = ({
  obshtinaCode,
  className,
}) => {
  const { t } = useTranslation();
  const { roster } = useMunicipalOfficials(obshtinaCode);
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    if (!roster) return [];
    return expanded ? roster.entries : roster.entries.slice(0, DEFAULT_ROWS);
  }, [roster, expanded]);

  if (!roster || roster.entries.length === 0) return null;

  const total = roster.entries.length;
  const hasMore = total > DEFAULT_ROWS;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("dashboard_municipal_roster_title") || "Officials roster"}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {total}
          </span>
        </div>
      }
    >
      <ul className="mt-1 divide-y">
        {visible.map((entry) => {
          const label = ROLE_LABEL_KEYS[entry.role];
          return (
            <li
              key={entry.slug}
              className="py-1.5 flex items-baseline gap-3 text-sm"
            >
              <Link
                to={`/officials/${entry.slug}?from=${obshtinaCode}`}
                className="hover:underline flex-1 truncate"
              >
                {entry.name}
              </Link>
              <span className="text-[11px] text-muted-foreground shrink-0 max-w-[40%] truncate">
                {t(label.i18n) || label.fallback}
                {entry.district ? ` · ${entry.district}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 pt-2 border-t text-[11px] text-primary hover:underline self-start"
        >
          {expanded
            ? t("dashboard_municipal_roster_collapse") || "Show fewer"
            : t("dashboard_municipal_roster_expand", {
                count: total - DEFAULT_ROWS,
                defaultValue: "Show all ({{count}} more)",
              })}
        </button>
      ) : null}
    </StatCard>
  );
};
