// Full-corpus tender search for /procurement/tenders?q=…|topic=…&year=….
//
// Loads the per-year search shard (tenders/by_year/<year>.json — the slim
// TenderSearchRow[] written by ingest_tenders.ts) and filters it by a curated
// TOPIC alias (robust to phrasing — see src/lib/tenderTopics.ts) or, failing
// that, a free keyword over subject + CPV description + buyer. "all" loads every
// year (heavier; a deliberate choice). Bounded to one year by default so a
// posted deep-link stays a single ~3-4 MB fetch.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonSoft } from "@/data/fetchJson";
import {
  topicBySlug,
  detectTopic,
  tenderMatchesTopic,
  type TenderSearchRow,
  type TenderTopic,
} from "@/lib/tenderTopics";

export const ALL_YEARS = "all";

const fetchYear = async (year: string): Promise<TenderSearchRow[]> =>
  (await fetchJsonSoft<TenderSearchRow[]>(
    dataUrl(`/procurement/tenders/by_year/${year}.json`),
  )) ?? [];

const fetchRows = async (
  year: string,
  years: string[],
): Promise<TenderSearchRow[]> => {
  if (year === ALL_YEARS) {
    const all = await Promise.all(years.map(fetchYear));
    return all.flat();
  }
  return fetchYear(year);
};

export interface TenderSearchResult {
  rows: TenderSearchRow[];
  topic?: TenderTopic;
  totalEur: number;
  count: number;
  cancelled: number;
  lots: number;
  isLoading: boolean;
}

export const useTenderSearch = (
  opts: { year: string; q: string; topicSlug: string; enabled: boolean },
  availableYears: string[],
): TenderSearchResult => {
  const { year, q, topicSlug, enabled } = opts;
  // The "all years" branch fans out over `availableYears` — which is empty until
  // the index loads. Gate the query on it (so it doesn't run-and-cache an empty
  // result before the years are known) AND include the year list in the key (so
  // it refetches if that set ever changes). Single-year searches don't depend on
  // availableYears, so they aren't gated.
  const isAll = year === ALL_YEARS;
  const yearsKey = isAll ? availableYears.join(",") : "";
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "tenderSearch", year, yearsKey] as const,
    queryFn: () => fetchRows(year, availableYears),
    enabled: enabled && !!year && (!isAll || availableYears.length > 0),
    staleTime: Infinity,
  });

  // Derive once per (data, q, topicSlug) — the screen re-renders on every search
  // keystroke and the ?year=all corpus is multi-MB, so the filter/sort/reduce
  // must not run every render (F-005). Returns a stable `rows` reference too.
  const derived = useMemo(() => {
    const topic = topicBySlug(topicSlug) ?? (q ? detectTopic(q) : undefined);
    const rowsAll = data ?? [];
    let matched: TenderSearchRow[];
    if (topic) {
      matched = rowsAll.filter((r) => tenderMatchesTopic(topic, r));
    } else if (q.trim().length >= 2) {
      const needle = q.trim().toLocaleLowerCase("bg");
      matched = rowsAll.filter(
        (r) =>
          (r.subject ?? "").toLocaleLowerCase("bg").includes(needle) ||
          (r.cpvDesc ?? "").toLocaleLowerCase("bg").includes(needle) ||
          (r.buyerName ?? "").toLocaleLowerCase("bg").includes(needle),
      );
    } else {
      matched = [];
    }
    const rows = [...matched].sort(
      (a, b) => (b.estimatedValueEur ?? 0) - (a.estimatedValueEur ?? 0),
    );
    return {
      rows,
      topic,
      totalEur: rows.reduce((s, r) => s + (r.estimatedValueEur ?? 0), 0),
      count: rows.length,
      cancelled: rows.filter((r) => r.isCancelled).length,
      lots: rows.reduce((s, r) => s + (r.lotsCount ?? 0), 0),
    };
  }, [data, q, topicSlug]);

  return { ...derived, isLoading };
};
