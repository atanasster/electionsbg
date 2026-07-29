// Manifest of annual-CSV (pre-OCDS) datasets already ingested into the corpus.
//
// The OCDS side has `data/procurement/bundles.json` — a record of every
// fortnight bundle consumed — so `procurement:ingest` can skip what it already
// has. The legacy side had no equivalent: `discoverLegacyDatasets` deduped only
// against the hand-pinned LEGACY_DATASETS constant, so a year that was
// discovered and ingested but never pinned (2024-RL, 2025-RL) was re-nominated,
// re-downloaded and re-merged on EVERY `--discover` run. The month-shard merge
// is keyed on `Contract.key`, so nothing double-counted — but the run reported
// "2 new dataset(s)" each time, which reads as new data when it is not.
//
// This manifest closes that gap: `--discover` records what it ingests, and
// subsequent runs skip those years. Committed, like bundles.json, so the guard
// survives a fresh clone.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LEGACY_MANIFEST_PATH = path.resolve(
  __dirname,
  "../../data/procurement/legacy_ingested.json",
);

export type LegacyManifestEntry = {
  /** Year token as used by LEGACY_DATASETS — e.g. "2023" or "2024-RL". */
  year: string;
  datasetUuid: string;
  system: "CE" | "RL" | "OLDER";
  /** ISO date of the run that ingested it. */
  ingestedAt: string;
  /** Rows emitted by that run — a sanity signal, not a checksum. */
  rows: number;
};

export type LegacyManifest = {
  generatedAt: string;
  datasets: LegacyManifestEntry[];
};

export const readLegacyManifest = (): LegacyManifest => {
  if (!fs.existsSync(LEGACY_MANIFEST_PATH)) {
    return { generatedAt: "", datasets: [] };
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(LEGACY_MANIFEST_PATH, "utf8"),
    ) as Partial<LegacyManifest>;
    return {
      generatedAt: parsed.generatedAt ?? "",
      datasets: Array.isArray(parsed.datasets) ? parsed.datasets : [],
    };
  } catch (e) {
    // A corrupt manifest must not silently disable the guard — that would
    // quietly restore the re-pull behaviour this file exists to stop.
    throw new Error(
      `legacy manifest at ${LEGACY_MANIFEST_PATH} is unreadable: ${(e as Error).message}`,
    );
  }
};

/** Record (or refresh) one ingested dataset. Keyed on the year token. */
export const recordLegacyIngest = (
  entry: Omit<LegacyManifestEntry, "ingestedAt">,
  now: string,
): void => {
  const manifest = readLegacyManifest();
  const byYear = new Map(manifest.datasets.map((d) => [d.year, d]));
  byYear.set(entry.year, { ...entry, ingestedAt: now });
  const datasets = [...byYear.values()].sort((a, b) =>
    a.year.localeCompare(b.year),
  );
  fs.mkdirSync(path.dirname(LEGACY_MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(
    LEGACY_MANIFEST_PATH,
    JSON.stringify({ generatedAt: now, datasets }, null, 2) + "\n",
  );
};
