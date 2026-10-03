// The АОП OCDS bundle registry (data/procurement/bundles.json) — pure helpers
// shared by the walker (fetch_dataset_index.ts) and the ingest CLI, kept
// import-free so they can be unit-tested without running either.

import type { BundleEntry } from "./types";

// Entries written before `kind` existed are all fortnight bundles.
export const entryKind = (e: BundleEntry): "fortnight" | "daily" =>
  e.kind ?? (e.periodStart === e.periodEnd ? "daily" : "fortnight");

export const sortEntries = (entries: BundleEntry[]): BundleEntry[] =>
  [...entries].sort(
    (a, b) =>
      b.periodEnd.localeCompare(a.periodEnd) ||
      b.periodStart.localeCompare(a.periodStart) ||
      a.resourceUuid.localeCompare(b.resourceUuid),
  );

// Keyed on resourceUuid — a monthly dataset holds one resource per day. The
// walker never sets `ingestedAt`, so a fresh entry inherits the stamp of the
// registered one it replaces.
export const mergeBundles = (
  previous: BundleEntry[],
  fresh: BundleEntry[],
): BundleEntry[] => {
  const byUuid = new Map<string, BundleEntry>();
  for (const b of previous) byUuid.set(b.resourceUuid, b);
  for (const b of fresh) {
    const prior = byUuid.get(b.resourceUuid);
    byUuid.set(
      b.resourceUuid,
      prior?.ingestedAt && !b.ingestedAt
        ? { ...b, ingestedAt: prior.ingestedAt }
        : b,
    );
  }
  return sortEntries([...byUuid.values()]);
};

// Which candidates still need ingesting. A stamped entry is done. An unstamped
// one falls back to the shard scan ONLY when it is the sole resource of its
// dataset (the fortnight shape, registered before the ledger existed): rows
// carry bundleUuid = datasetUuid, so for a monthly dataset "some row from this
// dataset is on disk" says nothing about which DAYS are — that is exactly how
// a dataset could be half-ingested and look complete.
export const selectUningested = (
  candidates: BundleEntry[],
  registry: BundleEntry[],
  datasetsOnDisk: Set<string>,
): BundleEntry[] => {
  const perDataset = new Map<string, number>();
  for (const b of registry)
    perDataset.set(b.datasetUuid, (perDataset.get(b.datasetUuid) ?? 0) + 1);
  return candidates.filter((b) => {
    if (b.ingestedAt) return false;
    const legacyFortnight =
      entryKind(b) === "fortnight" && perDataset.get(b.datasetUuid) === 1;
    return !(legacyFortnight && datasetsOnDisk.has(b.datasetUuid));
  });
};
