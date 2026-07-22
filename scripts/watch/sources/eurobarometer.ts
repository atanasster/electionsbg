// Standard Eurobarometer — the twice-a-year EU public-opinion survey that is the
// source for the curated "trust in national government / parliament / EU" arrays
// (`EB_TRUST_GOVERNMENT` et al.) at the top of scripts/macro/fetch_eurostat.ts,
// which drive the ДОВЕРИЕ В ПРАВИТЕЛСТВОТО KPI tile on /indicators.
//
// Those arrays are hand-pasted inline constants with NO upstream fetch, so until
// this source existed nothing ever flagged a new wave and the trust series went
// silently stale (it sat at 2024 while STD105/Spring-2026 was already out).
//
// The publishing portal (europa.eu/eurobarometer) is an Angular SPA whose search
// API returns a canned default set to non-browser callers, so it can't be probed
// headlessly. Instead we fingerprint the EU Open Data Portal (data.europa.eu),
// which indexes every Standard Eurobarometer wave as its own dataset and exposes
// a plain JSON search API. Fingerprint = the highest wave number in the catalogue
// (monotonic, unambiguous); a new wave bumps it and flips the flag.
//
// Like TI CPI, this is a *flag*, not an auto-ingest: a flip means "open the new
// wave's BG national report and paste { year, value } into the EB_TRUST_* arrays,
// then re-run update-macro" (see .claude/skills/update-macro/SKILL.md).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

// EU Open Data Portal search — datasets whose title matches "Standard
// Eurobarometer". limit=100 comfortably covers the whole series; the latest
// wave is an exact-title match and always ranks in the returned set.
const URL =
  "https://data.europa.eu/api/hub/search/search?q=%22Standard+Eurobarometer%22&filter=dataset&limit=100";

interface OdpResult {
  title?: Record<string, string> | string;
}
interface OdpResponse {
  result?: { count?: number; results?: OdpResult[] };
}

const titleOf = (r: OdpResult): string => {
  if (!r.title) return "";
  if (typeof r.title === "string") return r.title;
  return r.title.en ?? Object.values(r.title)[0] ?? "";
};

interface Wave {
  num: number;
  season: string;
}

// "Standard Eurobarometer 105 - Spring 2026" → { num: 105, season: "Spring 2026" }
// Exported for unit testing (the only non-trivial pure logic in this source).
export const parseWave = (title: string): Wave | null => {
  const m = /Standard Eurobarometer\s+(\d{2,3})\b(?:\s*[-–]\s*([^|:]+))?/i.exec(
    title,
  );
  if (!m) return null;
  return { num: Number(m[1]), season: (m[2] ?? "").trim() };
};

export const eurobarometer: WatchSource = {
  id: "eurobarometer",
  label: "Standard Eurobarometer (institutional trust)",
  url: URL,
  // Standard EB publishes ~twice a year (spring + autumn); a cheap monthly JSON
  // probe guarantees we notice within ~30 days of a new wave landing.
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const json = await fetchJson<OdpResponse>(URL);
    const rows = json?.result?.results ?? [];
    if (rows.length === 0) {
      throw new Error("EU Open Data Portal returned no Eurobarometer datasets");
    }
    let latest: Wave | null = null;
    for (const r of rows) {
      const w = parseWave(titleOf(r));
      if (w && (!latest || w.num > latest.num)) latest = w;
    }
    if (!latest) {
      throw new Error(
        "could not parse any 'Standard Eurobarometer NNN' title from ODP results",
      );
    }
    const seasonLabel = latest.season ? ` (${latest.season})` : "";
    return {
      value: `STD${latest.num}`,
      detail: `latest wave: Standard Eurobarometer ${latest.num}${seasonLabel}`,
      meta: { latestWave: latest.num, season: latest.season },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.fingerprint === curr.value) return curr.detail;
    return `${curr.detail} — was ${prev.detail}`;
  },
};
