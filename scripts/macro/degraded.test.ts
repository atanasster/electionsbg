// Ratchet on the carried-forward-vintage marker.
//
// `fetch_eurostat.ts` / `fetch_eu_peers.ts` keep the previously-committed World
// Bank WGI block when that API is down, rather than losing the whole Eurostat
// refresh with it, and record the affected keys in a `degraded` array. That is
// the right trade during an outage — but the only thing that clears the marker
// is a human remembering to re-run, and a `degraded` block that outlives its
// outage is invisible: the artifact looks fresh (`fetchedAt` is recent) while
// part of it is not.
//
// So: allow the marker, bound how long it may ride. The window is measured
// from the artifact's OWN fetchedAt, not from wall-clock age of the file, so
// re-running during a prolonged outage resets the clock and this only fires
// when nobody has re-run at all.
//
// Reads committed JSON only — no network. `node` Vitest project.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Generous: a World Bank outage lasting longer than this is not a blip, and at
// that point the right response is investigating a retired indicator code, not
// another re-run. Tuned to be quiet in normal operation.
const MAX_DEGRADED_DAYS = 14;

const ARTIFACTS = ["data/macro.json", "data/macro_peers.json"];

type Artifact = { fetchedAt?: string; degraded?: string[] };

describe("macro artifacts carried-forward marker", () => {
  it.each(ARTIFACTS)("%s does not ride a stale vintage", (rel) => {
    const file = path.join(ROOT, rel);
    const p = JSON.parse(fs.readFileSync(file, "utf8")) as Artifact;

    if (!p.degraded?.length) return; // healthy — nothing carried forward

    expect(
      p.fetchedAt,
      `${rel}: degraded but no fetchedAt to age it`,
    ).toBeTruthy();
    const ageDays = (Date.now() - Date.parse(p.fetchedAt!)) / 86_400_000;
    expect(
      ageDays,
      `${rel} has carried [${p.degraded.join(", ")}] forward for ` +
        `${ageDays.toFixed(0)}d. Re-run the fetch — see .claude/skills/` +
        `update-macro/SKILL.md. If the upstream is still down after ` +
        `${MAX_DEGRADED_DAYS}d, the indicator code was probably retired.`,
    ).toBeLessThan(MAX_DEGRADED_DAYS);
  });

  it.each(ARTIFACTS)("%s omits `degraded` entirely when healthy", (rel) => {
    // Absence, not `[]` — a consumer may reasonably test truthiness, and an
    // empty array is truthy. Pins the `...(degraded.length ? {…} : {})` spread
    // in both writers.
    const p = JSON.parse(
      fs.readFileSync(path.join(ROOT, rel), "utf8"),
    ) as Artifact;
    if (p.degraded === undefined) return;
    expect(
      p.degraded.length,
      `${rel}: 'degraded' present but empty — writers must omit the key`,
    ).toBeGreaterThan(0);
  });
});
