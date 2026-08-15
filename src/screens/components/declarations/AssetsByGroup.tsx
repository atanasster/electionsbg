import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMpAssetsByParty } from "@/data/parliament/useAssetsRankings";
import {
  orderByMetric,
  metricValue,
  complementValue,
  metricMax,
  barWidthPct,
  type AssetsMetric,
} from "./groupAssets";

type Props = {
  /** The ns bucket the table below is paging through ("52" | "all"). */
  ns: string;
  /** The region/party mp-id restriction, in `useMpAssetsTopRows` form: null = unscoped,
   *  `[-1]` = a scope that resolved to nobody. Passed straight through so the bars read the
   *  same slice as the rows. */
  mpIds?: number[] | null;
};

// Declared wealth per parliamentary group — the assets twin of AttendanceByGroup, above the
// /mp-assets table.
//
// IT DISAPPEARS OUTSIDE THE CURRENT PARLIAMENT, ON PURPOSE. The only group the roster knows
// for an MP is the one they sit in TODAY, so in the „Всички парламенти" bucket 1,882 of 2,122
// rows have none at all, and in an older parliament's bucket the rows that DO carry one carry
// the wrong one — an MP re-elected into a different group would have their 51st-NS wealth
// filed under today's party. The route refuses to attribute in that case (see its header) and
// this component says why rather than drawing an empty box.
export const AssetsByGroup: FC<Props> = ({ ns, mpIds }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { partyGroupShortLabel, partyGroupShortColor } = useCanonicalParties();
  const { data, isLoading } = useMpAssetsByParty({ ns, mpIds });
  const [metric, setMetric] = useState<AssetsMetric>("total");

  const groups = useMemo(
    () => orderByMetric(data?.groups ?? [], metric),
    [data?.groups, metric],
  );
  const max = useMemo(() => metricMax(groups, metric), [groups, metric]);

  if (isLoading || !data) return null;

  // A scope with no groups is not always the same event: outside the current parliament it is
  // the refusal above (worth a sentence), inside it it is simply an empty region/party chip
  // (nothing to say — the empty table below already says it).
  if (!data.applicable) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("mp_assets_by_group_unavailable") ||
          "The per-group breakdown covers the current parliament only: the roster records each MP's present parliamentary group, which would misfile the wealth of anyone re-elected into a different one."}
      </p>
    );
  }
  if (groups.length === 0) return null;

  const money = (v: number | null, compact: boolean): string =>
    v == null ? "—" : compact ? formatEurCompact(v, lang) : formatEur(v, lang);

  const modeButton = (m: AssetsMetric, label: string) => (
    <button
      type="button"
      onClick={() => setMetric(m)}
      className={`text-xs px-3 py-1 rounded-full border ${
        metric === m
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card hover:bg-muted/40"
      }`}
      aria-pressed={metric === m}
    >
      {label}
    </button>
  );

  return (
    <section data-og="assets-groups" className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {t("mp_assets_by_group_title") ||
            "Declared wealth by parliamentary group"}
        </h2>
        <div className="flex items-center gap-2">
          {modeButton(
            "total",
            t("mp_assets_by_group_metric_total") || "Group total",
          )}
          {modeButton(
            "median",
            t("mp_assets_by_group_metric_median") || "Median per MP",
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {metric === "total"
          ? t("mp_assets_by_group_note_total") ||
            "Net worth (declared assets minus declared debts) from each MP's most recent filing, summed over the group. Groups differ in size, so a bigger group is expected to hold more — switch to the per-MP view to compare them."
          : t("mp_assets_by_group_note_median") ||
            "The group's MEDIAN MP: half its members declare more, half less. The mean is shown beside it — where the two diverge, a single large filing is carrying the group."}
      </p>

      <ul className="mt-4 space-y-2.5">
        {groups.map((g) => {
          const color = partyGroupShortColor(g.party) ?? "#94a3b8";
          const label = partyGroupShortLabel(g.party) ?? g.party;
          const value = metricValue(g, metric);
          const other = complementValue(g, metric);
          return (
            // A money row's right-hand column carries a figure, its denominator AND the
            // complementary metric, which is three times AttendanceByGroup's „87,3%" — so
            // the phone layout cannot be that component's single row. Below `sm` the bar
            // drops to its own full-width line beneath the label and the number (measured:
            // in one row it was squeezed to ~100px and the largest group's bar, at 100%,
            // disappeared entirely). `order` puts it back in the middle on desktop.
            <li
              key={g.party}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-x-3 gap-y-1"
            >
              <div
                className="text-xs font-medium truncate order-1"
                style={{ color }}
                title={label}
              >
                {label}
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden order-3 col-span-2 sm:order-2 sm:col-span-1">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${barWidthPct(value, max)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div className="text-right tabular-nums shrink-0 order-2 sm:order-3">
                <div className="text-sm font-semibold leading-tight">
                  {money(value, metric === "total")}
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {/* The denominator every per-MP figure here is computed over — the MPs with
                      a valued filing, not the group's seats. Stated as "N of M" whenever the
                      two differ, since a group where a tenth has filed nothing is a different
                      claim from one where all have. */}
                  {g.declared === g.mps
                    ? t("mp_assets_by_group_mps", { count: g.mps })
                    : t("mp_assets_by_group_declared_of", {
                        declared: g.declared,
                        total: g.mps,
                      })}
                  {other != null && (
                    <>
                      {" · "}
                      {metric === "total"
                        ? t("mp_assets_by_group_median_of", {
                            value: money(other, false),
                          })
                        : t("mp_assets_by_group_mean_of", {
                            value: money(other, false),
                          })}
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Non-zero ungrouped MPs would mean the bars do not add up to the table beneath them.
          The current parliament has none today; saying so when it happens is cheaper than a
          reader discovering the gap by adding the rows up. */}
      {data.ungrouped && data.ungrouped.mps > 0 && (
        <p className="text-[10px] text-muted-foreground mt-3">
          {t("mp_assets_by_group_ungrouped", { count: data.ungrouped.mps })}
        </p>
      )}
    </section>
  );
};
