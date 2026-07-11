// Watch the НФЦ Единен публичен регистър — the per-year .xls registers of
// financed films/series that feed data/culture/. Fingerprint = a hash of the
// set of .xls links on the register page, so a re-upload or a new year's file
// flips it. Maps to the `update-culture` skill (process-watch-report).

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { NFC_REGISTER_PAGE, BROWSER_UA } from "../../culture/sources";

const xlsLinks = async (): Promise<string[]> => {
  // nfc.bg's WAF 403s the default watcher bot UA — send a real-browser UA.
  const html = await fetchText(NFC_REGISTER_PAGE, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!html) return [];
  const links = new Set<string>();
  const re = /href="([^"]+\.x(?:ls|lsx))"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) links.add(m[1]);
  return [...links].sort();
};

export const nfcFilmRegister: WatchSource = {
  id: "nfc_film_register",
  label: "НФЦ Единен публичен регистър (financed films, nfc.bg)",
  url: NFC_REGISTER_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const links = await xlsLinks();
    const value = createHash("sha256").update(links.join("\n")).digest("hex");
    return {
      value,
      detail: `${links.length} .xls registers listed`,
      meta: { count: links.length },
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
    return now !== was
      ? `${now} film registers (was ${was})`
      : "a film register was re-uploaded";
  },
};
