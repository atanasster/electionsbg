// EU Weekly Oil Bulletin watcher. Feeds the /consumption/fuel ("Горива") tile —
// BG vs EU-average consumer fuel prices (Euro-super 95, diesel). The bulletin
// republishes the consolidated history XLSX every week under a document-download
// URL whose UUID rotates on each republish, so the download link's UUID is a
// clean weekly change signal without downloading the ~1 MB workbook. See
// scripts/consumption/fetch_fuel.ts for the ingest.

import type { WatchSource, Fingerprint } from "../types";
import { fetchText } from "../fingerprint";

const PAGE =
  "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en";

export const ecOilBulletin: WatchSource = {
  id: "ec_oil_bulletin",
  label: "EC Weekly Oil Bulletin: consumer fuel prices (petrol 95 & diesel)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty Oil Bulletin page");
    const m = html.match(
      /document\/download\/([0-9a-f-]{8,})[^"']*Prices_History[^"']*\.xlsx/i,
    );
    if (!m) throw new Error("could not locate the Prices_History XLSX link");
    // The document UUID changes on each weekly republish.
    return { value: m[1], detail: `history XLSX ${m[1].slice(0, 8)}…` };
  },
};
