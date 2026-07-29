// Regression lock for the annual-CSV discovery guard.
//
// `discoverLegacyDatasets` used to dedupe ONLY against the hand-pinned
// LEGACY_DATASETS constant. A year that was discovered and ingested but never
// pinned (2024-RL / 2025-RL) was therefore re-nominated, re-downloaded and
// re-merged on every `--discover` run. The month-shard merge is keyed on
// Contract.key so it never double-counted — which is exactly why it went
// unnoticed: the run just kept reporting "2 new dataset(s)" for data already
// on disk. The fix records ingested years in data/procurement/legacy_ingested.json
// and feeds them back in as `ingestedYears` / `ingestedUuids`.
//
//   npx vitest run scripts/procurement/legacy_discover.test.ts

import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { discoverLegacyDatasets } from "./legacy_csv";

const UUID_2024_RL = "88ea1672-944b-4b9a-b074-528e316eab46";

const listingHtml = `
<a href="https://data.egov.bg/data/view/${UUID_2024_RL}" class="x">
  <h2>Договори и изменения на договори - 2024</h2>
</a>`;

const detailHtml = `
<a href="/data/resourceView/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" class="r">
  <span class="version">Договори (contracts2024_RL.csv - данни от РОП)</span>
</a>`;

// Serve the listing on page 1 and an empty page 2 (the walker stops when a
// page yields no dataset rows), plus the detail page for the candidate.
const installFetch = (): { detailCalls: () => number } => {
  let detailCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/data/view/")) {
        detailCalls++;
        return { ok: true, status: 200, text: async () => detailHtml };
      }
      const page = Number(u.match(/[?&]page=(\d+)/)?.[1] ?? "1");
      return {
        ok: true,
        status: 200,
        text: async () => (page === 1 ? listingHtml : ""),
      };
    }),
  );
  return { detailCalls: () => detailCalls };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("nominates an un-ingested annual-CSV year", async () => {
  installFetch();
  const found = await discoverLegacyDatasets();
  assert.deepEqual(
    found.map((d) => d.year),
    ["2024-RL"],
  );
  assert.equal(found[0].datasetUuid, UUID_2024_RL);
  assert.equal(found[0].system, "RL");
});

test("skips a year already recorded in the manifest", async () => {
  installFetch();
  const found = await discoverLegacyDatasets({ ingestedYears: ["2024-RL"] });
  assert.deepEqual(found, []);
});

test("skips a recorded UUID without fetching its detail page", async () => {
  const { detailCalls } = installFetch();
  const found = await discoverLegacyDatasets({
    ingestedUuids: [UUID_2024_RL],
  });
  assert.deepEqual(found, []);
  // The UUID guard must short-circuit BEFORE the network detail-page read —
  // that is the whole point of re-checking the uuid as well as the year.
  assert.equal(detailCalls(), 0);
});

test("an unrelated recorded year does not suppress a genuine new one", async () => {
  installFetch();
  const found = await discoverLegacyDatasets({
    ingestedYears: ["2019", "2025-RL"],
    ingestedUuids: ["ffffffff-0000-0000-0000-000000000000"],
  });
  assert.deepEqual(
    found.map((d) => d.year),
    ["2024-RL"],
  );
});
