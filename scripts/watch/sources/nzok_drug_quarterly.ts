// НЗОК gross drug-reimbursement reports — nhif.bg/bg/medicine_food/
// quarter-payments/{year} lists "Брутни разходи …" XLS files (an annual roll-up
// once the year closes, plus per-quarter files), newest first.
//
// We fingerprint the newest "Брутни разходи" file link. A flip = a new quarter
// or the annual roll-up landed → run update-nzok to rebuild
// data/budget/nzok/drug_reimbursement.json.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { drugReimbursementLinks } from "../../nzok/lib/drug_links";

const BASE = "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

const newestDrugLink = (html: string): string | null =>
  drugReimbursementLinks(html)[0]?.href ?? null;

// The annual roll-up ("Брутни разходи за {year} г.xls") is updated IN PLACE as
// quarters are added — same URL, new bytes — so a link-only hash never flips.
// Fold the file's HEAD identity (etag / last-modified / content-length) into
// the fingerprint so an in-place refresh is detected.
const headStamp = async (link: string): Promise<string> => {
  try {
    const res = await fetch(BASE + link, {
      method: "HEAD",
      headers: { "User-Agent": UA },
    });
    const h = res.headers;
    return [h.get("etag"), h.get("last-modified"), h.get("content-length")]
      .filter(Boolean)
      .join("|");
  } catch {
    return ""; // HEAD unsupported/blocked → fall back to link-only fingerprint
  }
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
    const stamp = await headStamp(link);
    const value = createHash("sha256")
      .update(`${link}\n${stamp}`)
      .digest("hex");
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
