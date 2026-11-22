// ДС / COMDOS — the Комисия по досиетата (comdos.bg) decision archive behind the
// `ds` facet on the person layer. See docs/plans/comdos-ds-ingest-v1.md.
//
// The Commission has no bulk export, but its decision archive is crawlable
// (`pnpm run comdos:crawl`) and every decision document follows one field layout,
// so the corpus is ingested by machine rather than curated by hand. This watcher
// fingerprints the DecisionID set on archive PAGE 1 — new decisions are prepended
// there — and flips when the Commission publishes one, telling the operator to
// re-crawl (`comdos:crawl --refresh`) and re-parse (the `update-persons` skill).
//
// The ids are read with the crawler's own `parseArchivePage`, so the watcher and the
// ingest agree on what a decision row is — in particular both drop the „>>" sidebar,
// which repeats page-1 rows and would otherwise double-count.
//
// Best-effort: a fetch failure degrades to a stable sentinel fingerprint (no false
// "changed"), so the source stays quiet rather than flapping.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";
import { archivePageUrl, parseArchivePage } from "../../comdos/sources";

const ARCHIVE = archivePageUrl(1);

export const comdosDs: WatchSource = {
  id: "comdos_ds",
  label: "Комисия по досиетата (comdos.bg) — решения (ДС facet)",
  url: ARCHIVE,
  cadence: "monthly",
  async fingerprint(): Promise<Fingerprint> {
    let html: string;
    try {
      html = (await fetchText(ARCHIVE)) ?? "";
    } catch {
      return {
        value: "unreachable",
        detail: "comdos.bg unreachable from this egress",
        meta: { count: 0 },
      };
    }
    const ids = parseArchivePage(html)
      .map((r) => r.decisionId)
      .sort((a, b) => a - b);
    if (ids.length === 0) {
      return {
        value: "unreachable",
        detail: "no решения parsed from the comdos.bg archive page",
        meta: { count: 0 },
      };
    }
    const latest = ids[ids.length - 1];
    return {
      value: `${latest}:${sha256Short(ids.join(","))}`,
      detail: `latest DecisionID ${latest} on the comdos.bg archive`,
      meta: { count: ids.length, latest },
    };
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    const before = (prev?.meta?.latest as number | undefined) ?? null;
    const now = (curr.meta?.latest as number | undefined) ?? null;
    const what =
      before != null && now != null && before !== now
        ? `comdos.bg latest decision ${before} → ${now}`
        : curr.detail;
    return `${what} — re-crawl and re-parse (update-persons: comdos:crawl --refresh)`;
  },
};
