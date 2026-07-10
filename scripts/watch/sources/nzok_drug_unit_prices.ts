// НЗОК "Справка 5" (ПЛС2) — the monthly per-hospital reimbursement detail for
// antineoplastic + coagulopathy medicines, listed at nhif.bg/bg/nzok/medicine/5.
//
// This is the file that unblocked per-hospital UNIT prices: unlike the annual
// "Брутни разходи по INN" roll-up, it carries `Опаковки` and `Брой в опаковка`
// alongside `Реимбурсна сума`, plus the МКБ code. A flip = a new month landed →
// run update-nzok --drug-prices, then reload migration 052.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { spravka5Links } from "../../nzok/lib/spravka5_links";

const URL = "https://nhif.bg/bg/nzok/medicine/5";
const UA = "electionsbg.com data pipeline";

export const nzokDrugUnitPrices: WatchSource = {
  id: "nzok_drug_unit_prices",
  label: "НЗОК Справка 5 (ПЛС2) — реимбурсирани лекарства по лечебни заведения",
  url: URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(URL, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
    // Monthlies only. The page also carries one annual roll-up per closed year
    // (`month` null), which republishes months we already hold — it must not flip
    // the fingerprint on its own.
    const links = spravka5Links(await res.text()).filter(
      (l): l is typeof l & { month: number } =>
        l.kind === "monthly" && l.month != null,
    );
    if (!links.length)
      throw new Error(
        "nzok_drug_unit_prices: no monthly Справка 5 file found; page layout may have changed",
      );
    // The listing is not reliably ordered, and "12.2025" string-sorts after
    // "05.2026" — pick the newest by (year, month), never by the label.
    const newest = [...links].sort(
      (a, b) => b.year * 100 + b.month - (a.year * 100 + a.month),
    )[0];
    const period = `${newest.year}-${String(newest.month).padStart(2, "0")}`;
    return {
      value: createHash("sha256").update(newest.href).digest("hex"),
      detail: `newest Справка 5: ${period} (${links.length} files listed)`,
      meta: { href: newest.href, period, count: links.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const period = (curr.meta?.period as string) ?? "?";
    if (!prev) return `first run · newest Справка 5 ${period}`;
    const prevPeriod = (prev.meta?.period as string) ?? "?";
    return `new НЗОК Справка 5 file: ${period} (was ${prevPeriod}) — run update-nzok --drug-prices`;
  },
};
