import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import {
  aggregateAttendanceByGroup,
  type AttendanceGroupInput,
} from "./groupAttendance";

type Props = {
  // The SAME eligible rows the MP list renders, already resolved to the party
  // label each row displays — so the bar and the members beneath it reconcile.
  rows: AttendanceGroupInput[];
};

export const AttendanceByGroup: FC<Props> = ({ rows }) => {
  const { t, i18n } = useTranslation();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const lang = i18n.language;
  const groups = aggregateAttendanceByGroup(rows);
  if (groups.length === 0) return null;

  const pct = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  return (
    // The og:image anchor for /parliament/attendance — the card leads with this
    // chart rather than the name list, whose percentages sat off the clip's right
    // edge. `data-og` is also what the capture waits for: the section renders only
    // once the attendance file is in hand, so it cannot photograph the skeleton.
    <section
      data-og="attendance-groups"
      className="rounded-xl border bg-card p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide">
        {t("attendance_by_group_title") || "Attendance by parliamentary group"}
      </h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("attendance_by_group_note") ||
          "Weighted by items: the group's cast votes divided by the roll-call items its seats appear in — not the average of its members' own percentages, which a late arrival with a short record would distort. Covers the same MPs listed below."}
      </p>

      {/* A full 0-100% scale, deliberately: attendance is a share a reader
          judges against "always", so a min-max stretch would exaggerate small
          gaps between groups that all show up most of the time. */}
      <ul className="mt-4 space-y-2.5">
        {groups.map((g) => {
          const color = colorForPartyShort(g.party) ?? "#94a3b8";
          const label = labelForPartyShort(g.party) || g.party;
          return (
            <li
              key={g.party}
              className="grid grid-cols-[minmax(0,6.5rem)_1fr_auto] sm:grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 sm:gap-3"
            >
              <div
                className="text-xs font-medium truncate"
                style={{ color }}
                title={label}
              >
                {label}
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${Math.max(1, g.presentPct * 100)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="text-sm font-semibold leading-tight">
                  {pct.format(g.presentPct)}
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {t("attendance_group_members", { count: g.members })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
