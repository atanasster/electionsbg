import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { CensusMetric } from "@/data/census/censusTypes";
import type {
  DemographicCleavageRow,
  DemographicCleavagesPayload,
} from "@/data/dashboard/useDemographicCleavages";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useTooltip } from "@/ux/useTooltip";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import {
  fmtR,
  xPct,
} from "@/screens/components/demographics/demographicsFormat";
import { partyHref } from "@/lib/utils";

// The demographic-cleavages dot plot — a colour-dot per contestant on a −1…+1 track
// for each census metric, sorted by spread. Shared by the home
// DemographicCleavagesTile (a curated subset of rows), the /party-demographics
// analysis page (the full metric set) and the presidential PresidentialCleavagesTile
// (one round's tickets). Presentation only: the caller wraps it in a StatCard and
// decides which `rows` to pass.
//
// A row has THREE states, in this precedence: `onMetricSelect` makes it a <button>
// that drives a host page's own embedded scatter; otherwise `metricHref` (default:
// the /demographics census explorer) makes it a <Link>; and a `metricHref`
// returning nothing makes it an inert <div> — the right answer for a ballot whose
// explorer is about a DIFFERENT vote.
export type CleavageLegendEntry =
  DemographicCleavagesPayload["parties"][number];

export const DemographicCleavagesPlot: FC<{
  payload: DemographicCleavagesPayload;
  rows: DemographicCleavageRow[];
  onMetricSelect?: (metric: CensusMetric) => void;
  /** ⚠ THE TWO THINGS THAT ARE NOT TRUE OF EVERY BALLOT. A parliamentary legend entry is a
   *  PARTY — it has an English display name and a `/party/:slug` page — and a presidential one
   *  is a PAIR OF PEOPLE: the name is Cyrillic in both languages (a person's name is not
   *  translated) and the page, where there is one, is `/person`. Defaulted to the party
   *  behaviour so the two existing callers are untouched. */
  nameFor?: (entry: CleavageLegendEntry) => string;
  /** ⚠ `null` AND `undefined` BOTH MEAN REFUSED, because the repo's own resolvers disagree:
   *  `personHrefForTicket` returns `string | null`. Accepting both keeps a `?? undefined`
   *  adapter out of every call site — one spelling of „refused" per caller. */
  hrefFor?: (entry: CleavageLegendEntry) => string | null | undefined;
  /** ⚠⚠ THE FOOT NOTE IS BALLOT-SPECIFIC AND MUST BE OVERRIDABLE. The default says „Всяка
   *  точка е ПАРТИЯ, преминала прага от 4%" — two statements that are simply false about a
   *  presidential dot, which is a PAIR OF PEOPLE above a 3% readability cut with no legal
   *  threshold anywhere near it. A tile that renders correctly with the wrong noun is this
   *  family's stated failure mode. */
  noteKey?: string;
  /** Where a row leads. ⚠ `undefined` MAKES THE ROW INERT, which is the right answer where the
   *  explorer on the other end is about a DIFFERENT ballot: `/demographics` plots census
   *  characteristics against PARTY vote for the selected parliamentary election, so a
   *  presidential row linking there hands a reader a different question wearing the same
   *  label. `LocalDemographicCleavagesTile` reached the same conclusion and dropped its links
   *  entirely. Defaulted to the census explorer so the two existing callers are untouched. */
  metricHref?: (metric: CensusMetric) => string | null | undefined;
}> = ({
  payload,
  rows,
  onMetricSelect,
  nameFor,
  hrefFor,
  noteKey,
  metricHref,
}) => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { displayNameFor } = useCanonicalParties();
  const isBg = i18n.language === "bg";

  const partyName = (p: CleavageLegendEntry) =>
    nameFor
      ? nameFor(p)
      : isBg
        ? p.nickName
        : (displayNameFor(p.nickName) ?? p.nickName);

  return (
    <>
      {/* Party legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 mb-3 text-[11px]">
        {payload.parties.map((p) => {
          const href = hrefFor ? hrefFor(p) : partyHref(p.nickName);
          const inner = (
            <>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: p.color ?? "#888" }}
              />
              <span className="font-medium">{partyName(p)}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.pctNational.toFixed(1)}%
              </span>
            </>
          );
          // ⚠ NO HREF IS PLAIN TEXT, NOT A DEAD LINK. A presidential name resolves to a person
          // page only where the corpus can name exactly ONE public figure — 17 of the 140 names
          // across the five ballots are shared, „Иван Стефанов Иванов" by fifteen people — and
          // linking one of them would attribute this candidacy to somebody who merely shares a
          // name.
          return href ? (
            <Link
              key={p.partyNum}
              to={href}
              className="flex items-center gap-1 hover:underline"
            >
              {inner}
            </Link>
          ) : (
            <span key={p.partyNum} className="flex items-center gap-1">
              {inner}
            </span>
          );
        })}
      </div>

      {/* Rows: each is a track from −1 (red side) to +1 (green side) with a dot
          per party. Sorted by spread descending so the most polarizing
          dimension is on top. */}
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,2.5fr)_auto] gap-x-3 items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("census_axis_demographic")}</span>
          <span className="flex justify-between">
            <span>−1</span>
            <span>0</span>
            <span>+1</span>
          </span>
          <span className="text-right w-12">
            {t("dashboard_demographic_cleavages_spread")}
          </span>
        </div>
        {rows.map((row) => {
          const def = METRIC_BY_KEY[row.metric];
          const label = def ? t(def.i18nKey) : row.metric;
          // ⚠ COMPOSED PER BRANCH, NOT SUBTRACTED FROM. Stripping a Tailwind class by
          // substring match couples behaviour to a literal — reorder the list, change the
          // opacity to `hover:bg-muted/40`, normalise a space, and the `replace` becomes a
          // SILENT no-op with the affordance back and nothing failing.
          //
          // ⚠ `group` AND `hover:bg-muted/50` TRAVEL TOGETHER. The label below carries
          // `group-hover:underline`, so an inert row that kept `group` would still underline
          // its metric name under the cursor — the browser's universal „this is a link" signal
          // — and do nothing when clicked. Removing only the background is half a fix that
          // reads as a working link.
          const ROW_GRID =
            "grid grid-cols-[minmax(0,1fr)_minmax(160px,2.5fr)_auto] gap-x-3 items-center text-xs rounded px-1 py-0.5 -mx-1 text-left w-full";
          const rowClass = `${ROW_GRID} group hover:bg-muted/50`;
          const inner: ReactNode = (
            <>
              <span className="leading-tight group-hover:underline">
                {label}
              </span>
              <div className="relative h-5">
                {/* Track + zero line */}
                <div className="absolute inset-x-0 top-1/2 h-px bg-border -translate-y-1/2" />
                <div className="absolute top-1 bottom-1 left-1/2 w-px bg-border" />
                {/* One dot per party — overlapping is OK at this density. */}
                {row.rs.map((r, i) => {
                  const p = payload.parties[i];
                  return (
                    <span
                      key={p.partyNum}
                      className="absolute top-1/2 h-2.5 w-2.5 rounded-full border border-background -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                      style={{
                        left: `${xPct(r)}%`,
                        backgroundColor: p.color ?? "#888",
                      }}
                      onMouseEnter={(e) =>
                        tooltipEvents.onMouseEnter(
                          { pageX: e.pageX, pageY: e.pageY },
                          <div className="text-left text-xs">
                            <div className="font-semibold pb-1 mb-1 border-b border-border">
                              {label}
                            </div>
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                              <span className="text-muted-foreground">
                                {partyName(p)}
                              </span>
                              <span
                                className="font-semibold tabular-nums text-right"
                                style={{ color: p.color ?? "#888" }}
                              >
                                {fmtR(r)}
                              </span>
                            </div>
                          </div>,
                        )
                      }
                      onMouseMove={(e) =>
                        tooltipEvents.onMouseMove({
                          pageX: e.pageX,
                          pageY: e.pageY,
                        })
                      }
                      onMouseLeave={tooltipEvents.onMouseLeave}
                    />
                  );
                })}
              </div>
              <span className="text-xs font-semibold tabular-nums text-right w-12 text-muted-foreground">
                {row.spread.toFixed(2)}
              </span>
            </>
          );
          if (onMetricSelect)
            return (
              <button
                key={row.metric}
                type="button"
                onClick={() => onMetricSelect(row.metric)}
                className={rowClass}
              >
                {inner}
              </button>
            );
          const href = metricHref
            ? metricHref(row.metric)
            : `/demographics?scatter=${row.metric}#scatter`;
          return href ? (
            <Link key={row.metric} to={href} className={rowClass}>
              {inner}
            </Link>
          ) : (
            // The inert row takes the bare grid: no `group`, no hover background.
            <div key={row.metric} className={ROW_GRID}>
              {inner}
            </div>
          );
        })}
      </div>
      {tooltip}
      <p className="text-[10px] text-muted-foreground italic mt-3">
        {t(noteKey ?? "dashboard_demographic_cleavages_note")}
      </p>
    </>
  );
};
