// European Commission Financial Transparency System (FTS) — the register of
// recipients of EU directly-managed funds. Source of truth for the EU-direct
// slice of NGO external funding in Postgres `ngo_funding` (source `eu_fts`);
// see scripts/ngo/load_ngo_funding_pg.ts. Complements ISUN (shared-management
// funds) — no overlap.
//
// The EC publishes one bulk dataset per calendar year (2007→latest) as
// `{YEAR}_FTS_dataset_en.xlsx`, with a new year appearing roughly mid-following-
// year. We fingerprint the latest year referenced on the download listing page
// rather than HEADing the ~16 MB binaries — the year set is the change signal
// and keeps the watcher cheap.
//
// When this fires (a new FTS year is published), download the new
// `{YEAR}_FTS_dataset_en.xlsx` into raw_data/ngo_funding/fts/ and re-run
// `npm run db:load:ngo-funding:pg` (DB-only — no JSON/shards).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE =
  "https://ec.europa.eu/budget/financial-transparency-system/help.html";

// Every downloadable dataset link embeds its year, e.g.
// "download/2023_FTS_dataset_en.xlsx".
const YEAR_RE = /(\d{4})_FTS_dataset_en\.(?:xlsx|csv|xml)/gi;

const latestYear = (html: string): number => {
  let max = 0;
  for (const m of html.matchAll(YEAR_RE)) {
    const y = Number(m[1]);
    if (y > max) max = y;
  }
  if (!max) {
    throw new Error(
      "FTS dataset links not found on listing page — page layout may have changed",
    );
  }
  return max;
};

export const ecFts: WatchSource = {
  id: "ec_fts",
  label: "EC Financial Transparency System (EU direct funds to BG NGOs)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty FTS listing page");
    const year = latestYear(html);
    return {
      value: sha256Short(`fts-latest-${year}`),
      detail: `latest FTS dataset year ${year}`,
      meta: { latestYear: year },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevY = (prev.meta?.latestYear as number | undefined) ?? "?";
    const currY = (curr.meta?.latestYear as number | undefined) ?? "?";
    if (prevY !== currY) {
      return `new FTS year published · ${prevY} → ${currY} (download ${currY}_FTS_dataset_en.xlsx, re-run db:load:ngo-funding:pg)`;
    }
    return `FTS listing changed · latest year still ${currY}`;
  },
};
