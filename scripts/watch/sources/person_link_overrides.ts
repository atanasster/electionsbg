// Repository-local maintenance trigger for the curated person identity decisions. It reads
// no publisher: changing the committed registry means the derived person tables are stale,
// exactly as a new upstream row would. The daily watcher hashes it so process-watch-report
// queues update-persons instead of relying on an operator to remember the re-resolve.

import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Fingerprint, WatchSource } from "../types";
import {
  OVERRIDE_REGISTRY_PATH,
  parseOverrideRegistry,
} from "../../person/overrideRegistry";

export const fingerprintPersonLinkOverrides = (
  file = OVERRIDE_REGISTRY_PATH,
): Fingerprint => {
  const bytes = fs.readFileSync(file);
  const rows = parseOverrideRegistry(JSON.parse(bytes.toString("utf8")));
  return {
    value: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    detail: `${rows.length} audited person identity decision(s)`,
    meta: { decisions: rows.length },
  };
};

export const personLinkOverrides: WatchSource = {
  id: "person_link_overrides",
  label: "Курирани решения за идентичност на лица",
  url: "https://github.com/atanasster/data-bg/blob/main/data/person/link_overrides.json",
  cadence: "daily",
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    return fingerprintPersonLinkOverrides();
  },
};
