// governmentbg/data-viz crime-CSVs watcher.
//
// The official BG government open-data-viz repo on GitHub hosts MVR's
// per-oblast crime CSVs at:
//   assets/data/crime/mvr-aggr-13-perth-full.csv
//   assets/data/crime/mvr-aggr-13-perth.csv
//   assets/data/crime/mvr-aggr-13-prc-full.csv
//   assets/data/crime/mvr-aggr-13-prc.csv
//   assets/data/crime/recoded-en-bg-crime.json
// We fingerprint via the GitHub Contents API — each file carries an
// immutable SHA, so a refreshed dataset shifts the SHA of the CSV(s).
//
// Downstream `update-crime-stats` (scripts/crime/build_index.ts)
// re-fetches the primary perth-full CSV and rewrites
// data/crime/index.json. Cadence: monthly. The upstream is dormant
// (last commit on the gh-pages crime directory was in 2015), so
// monthly is plenty.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const API_URL =
  "https://api.github.com/repos/governmentbg/data-viz/contents/assets/data/crime?ref=gh-pages";

type GhFile = { name: string; sha: string; size: number };

export const govDataVizCrime: WatchSource = {
  id: "govdataviz_crime",
  label: "governmentbg/data-viz — MVR crime CSVs",
  url: "https://github.com/governmentbg/data-viz/tree/gh-pages/assets/data/crime",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(API_URL, {
      headers: {
        "User-Agent": "electionsbg-watch/1.0",
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      return { value: "missing", detail: `GitHub API ${res.status}` };
    }
    const files = (await res.json()) as GhFile[];
    const summary = files
      .map((f) => `${f.name}:${f.sha}`)
      .sort()
      .join("|");
    const value = createHash("sha256").update(summary).digest("hex");
    return {
      value,
      detail: `${files.length} files · ${files
        .map((f) => f.name)
        .sort()
        .join(", ")}`,
      meta: {
        files: files.map((f) => ({
          name: f.name,
          sha: f.sha,
          size: f.size,
        })),
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevFiles = (prev.meta?.files as GhFile[] | undefined) ?? [];
    const currFiles = (curr.meta?.files as GhFile[] | undefined) ?? [];
    const prevByName = new Map(prevFiles.map((f) => [f.name, f.sha]));
    const changed = currFiles
      .filter((f) => prevByName.get(f.name) !== f.sha)
      .map((f) => f.name);
    if (changed.length === 0) return curr.detail;
    return `${changed.length} file(s) updated: ${changed.join(", ")}`;
  },
};
