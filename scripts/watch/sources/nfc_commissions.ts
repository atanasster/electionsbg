// Watch НФЦ for a new национална-художествена-комисия appointment order — the
// source behind data/culture/commissions.json ("кой решава"). The compositions
// change each ~6-month mandate via an executive-director order ("Назначаване
// съставите на НХК…") published on the „Заповеди" page. We fingerprint just those
// appointment-of-composition links (a small, stable set), so a new mandate flips
// it while the page's thousands of other orders don't. On a flip, the operator
// reads the newest order and updates write_commissions.ts. Maps to `update-culture`.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { BROWSER_UA } from "../../culture/sources";

const ZAPOVEDI =
  "https://www.nfc.bg/%D0%BD%D0%BE%D1%80%D0%BC%D0%B0%D1%82%D0%B8%D0%B2%D0%BD%D0%B8-%D0%B0%D0%BA%D1%82%D0%BE%D0%B2%D0%B5-%D0%B7%D0%B0%D0%BF%D0%BE%D0%B2%D0%B5%D0%B4%D0%B8-%D0%B8-%D1%81%D1%82%D0%B0%D1%82%D1%83%D1%82%D0%B8/%D0%B7%D0%B0%D0%BF%D0%BE%D0%B2%D0%B5%D0%B4%D0%B8/";

// Appointment-of-composition orders name all three commissions ("НХК…") and carry
// both „Назначаване" and „състав" in the (decoded) filename.
const isAppointment = (name: string): boolean =>
  name.includes("Назначаване") &&
  name.includes("състав") &&
  name.includes("НХК");

const appointmentOrders = async (): Promise<string[]> => {
  const html = await fetchText(ZAPOVEDI, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!html) return [];
  const orders = new Set<string>();
  const re = /href="([^"]+\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let name = m[1];
    try {
      name = decodeURIComponent(m[1]);
    } catch {
      /* keep raw on a bad escape */
    }
    if (isAppointment(name)) orders.add(m[1]);
  }
  return [...orders].sort();
};

export const nfcCommissions: WatchSource = {
  id: "nfc_commissions",
  label: "НФЦ artistic-commission appointments (nfc.bg заповеди)",
  url: ZAPOVEDI,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const orders = await appointmentOrders();
    const value = createHash("sha256").update(orders.join("\n")).digest("hex");
    return {
      value,
      detail: `${orders.length} commission-appointment orders published`,
      meta: { count: orders.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const was = Number(
      (prev.meta as { count?: number } | undefined)?.count ?? 0,
    );
    const now = Number(
      (curr.meta as { count?: number } | undefined)?.count ?? 0,
    );
    return now > was
      ? `new commission-appointment order (${was}→${now}); refresh commissions.json from the newest Заповед`
      : "the НФЦ заповеди page changed";
  },
};
