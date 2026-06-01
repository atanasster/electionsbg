// Per-polling-station (section) council results for one município.
//
// Loads data/<cycle>/sections/<obshtinaCode>.json (present for every regular
// cycle whose section CSV bundle was ingested — 2011/2015/2019/2023) and renders a
// searchable, sortable table of every polling station: turnout + the leading
// council party. Self-hides when the cycle/município has no section shard
// (e.g. Sofia район shards — their sections live under the SOF bundle).
//
// Scales to Sofia's ~1,550 sections via incremental rendering (search filters
// the full set; a "show more" control caps the DOM node count).

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { useLocalSections } from "@/data/local/useLocalSections";
import { useInView } from "@/ux/useInView";
import { formatThousands } from "@/data/utils";
import type { LocalSectionResult } from "@/data/local/types";

const PAGE = 50;

type SortKey = "section" | "turnout" | "voters";

const turnoutPct = (s: LocalSectionResult): number | null =>
  s.numRegisteredVoters > 0
    ? (s.totalActualVoters / s.numRegisteredVoters) * 100
    : null;

export const LocalSectionsTile: FC<{
  cycle: string;
  obshtinaCode: string;
}> = ({ cycle, obshtinaCode }) => {
  const { t } = useTranslation();
  // The section shard is the heaviest payload on the município page — most are
  // ~18KB, but the big cities are huge (Sofia ~3.7MB, Plovdiv/Varna >1MB). This
  // tile sits below the mayor/council tiles, so defer the fetch until it scrolls
  // near the viewport: a page the user never scrolls through pays nothing for it.
  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>();
  const { shard } = useLocalSections(obshtinaCode, cycle, inView);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("section");
  const [limit, setLimit] = useState(PAGE);

  // localPartyNum → legend entry (name + color).
  const partyById = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const p of shard?.parties ?? [])
      m.set(p.localPartyNum, { name: p.localPartyName, color: p.color });
    return m;
  }, [shard]);

  const filteredSorted = useMemo(() => {
    const rows = shard?.sections ?? [];
    const q = query.trim().toLocaleLowerCase("bg");
    const filtered = q
      ? rows.filter(
          (s) =>
            s.sectionCode.includes(q) ||
            s.settlement.toLocaleLowerCase("bg").includes(q),
        )
      : rows;
    const sorted = [...filtered];
    if (sortKey === "turnout") {
      sorted.sort((a, b) => (turnoutPct(b) ?? -1) - (turnoutPct(a) ?? -1));
    } else if (sortKey === "voters") {
      sorted.sort((a, b) => b.totalActualVoters - a.totalActualVoters);
    } else {
      sorted.sort((a, b) => a.sectionCode.localeCompare(b.sectionCode));
    }
    return sorted;
  }, [shard, query, sortKey]);

  // Until the tile scrolls into view, render only the sentinel (the
  // IntersectionObserver target) so no fetch fires. Reserve a sliver of height
  // so the observer has a real box to track.
  if (!inView) {
    return <div ref={sentinelRef} aria-hidden style={{ minHeight: 1 }} />;
  }
  if (!shard || shard.sections.length === 0) return null;

  const visible = filteredSorted.slice(0, limit);
  const total = shard.sections.length;

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSortKey(key)}
      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        sortKey === key
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-1">
        {t("local_sections_title")}
      </h2>
      <p className="text-sm text-muted-foreground mb-3">
        {t("local_sections_intro", { count: total })}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative grow min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder={t("local_sections_search_placeholder")}
            className="w-full rounded-lg border bg-card py-1.5 pl-8 pr-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {t("local_sections_sort_by")}
          </span>
          {sortBtn("section", t("local_sections_sort_section"))}
          {sortBtn("turnout", t("local_sections_sort_turnout"))}
          {sortBtn("voters", t("local_sections_sort_voters"))}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left">
                {t("local_sections_th_section")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_sections_th_settlement")}
              </th>
              <th className="py-2 px-3 text-right whitespace-nowrap">
                {t("local_sections_th_voted")}
              </th>
              <th className="py-2 px-3 text-right">
                {t("local_sections_th_turnout")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_sections_th_leader")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-6 px-3 text-center text-muted-foreground"
                >
                  {t("local_sections_no_match")}
                </td>
              </tr>
            ) : (
              visible.map((s) => {
                const tp = turnoutPct(s);
                const leadPv = s.partyVotes[0];
                const lead = leadPv
                  ? partyById.get(leadPv.localPartyNum)
                  : null;
                const leadPct =
                  leadPv && s.numValidVotes > 0
                    ? (leadPv.votes / s.numValidVotes) * 100
                    : null;
                return (
                  <tr key={s.sectionCode} className="border-b last:border-b-0">
                    <td className="py-2 px-3 tabular-nums whitespace-nowrap font-medium">
                      <Link
                        to={`/local/${cycle}/${obshtinaCode}/section/${s.sectionCode}`}
                        className="text-primary hover:underline"
                      >
                        {s.sectionCode}
                      </Link>
                      {s.isMobile ? (
                        <span className="ml-1.5 inline-flex items-center rounded border border-border bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("local_sections_mobile_badge")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground break-words">
                      {s.settlement}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                      {formatThousands(s.totalActualVoters)}
                      <span className="text-muted-foreground">
                        {" / "}
                        {formatThousands(s.numRegisteredVoters)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {tp != null ? `${tp.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 px-3">
                      {lead ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            aria-hidden
                            className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                            style={{ backgroundColor: lead.color }}
                          />
                          <span className="truncate" title={lead.name}>
                            {lead.name}
                          </span>
                          {leadPct != null ? (
                            <span className="text-muted-foreground tabular-nums shrink-0">
                              · {leadPct.toFixed(1)}%
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("local_sections_showing", {
            shown: Math.min(limit, filteredSorted.length),
            total: filteredSorted.length,
          })}
          {" · "}
          {t("local_sections_csv_note")}
        </span>
        {limit < filteredSorted.length ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE)}
              className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
            >
              {t("local_sections_show_more")}
            </button>
            <button
              type="button"
              onClick={() => setLimit(filteredSorted.length)}
              className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
            >
              {t("local_sections_show_all", { total: filteredSorted.length })}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
};
