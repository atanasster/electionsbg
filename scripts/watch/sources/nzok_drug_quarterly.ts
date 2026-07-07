// НЗОК gross drug-reimbursement reports — nhif.bg/bg/medicine_food/
// quarter-payments/{year} lists "Брутни разходи …" XLS files (an annual roll-up
// once the year closes, plus per-quarter files), newest first.
//
// We fingerprint the newest "Брутни разходи" file link. A flip = a new quarter
// or the annual roll-up landed → run update-nzok to rebuild
// data/budget/nzok/drug_reimbursement.json.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const BASE = "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

const newestDrugLink = (html: string): string | null => {
  for (const m of html.matchAll(/href="(\/upload\/[^"]+\.(?:xlsx|xls))"/gi)) {
    if (/Брутни\s+разходи/i.test(decodeURIComponent(m[1]))) return m[1];
  }
  return null;
};

const resolveLatest = async (): Promise<{ link: string; year: number }> => {
  const now = new Date();
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
    const html = await fetchHtml(
      `${BASE}/bg/medicine_food/quarter-payments/${year}`,
    );
    const link = newestDrugLink(html);
    if (link) return { link, year };
  }
  throw new Error(
    "nzok_drug_quarterly: no 'Брутни разходи' file found; page layout may have changed",
  );
};

export const nzokDrugQuarterly: WatchSource = {
  id: "nzok_drug_quarterly",
  label: "НЗОК брутни разходи за лекарства по INN (nhif.bg)",
  url: `${BASE}/bg/medicine_food/quarter-payments`,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const { link, year } = await resolveLatest();
    const value = createHash("sha256").update(link).digest("hex");
    const name = decodeURIComponent(link.split("/").pop() ?? link);
    return {
      value,
      detail: `newest drug-reimbursement file (${year}): ${name}`,
      meta: { link, year, name },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const name = (curr.meta?.name as string) ?? "?";
    if (!prev) return `first run · ${name}`;
    return `new НЗОК drug-reimbursement file: ${name} — run update-nzok`;
  },
};
