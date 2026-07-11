// NOI pension statistical yearbook watcher — the ZIP-of-XLSX edition that drives
// the /pensions view (per-oblast average pension, the size distribution, the
// national wage/income/pension series).
//
// nssi.bg publishes it at
//   https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_{YYYY}.zip
// once a year (~July, for the prior year). Unlike the B1 files this GETs cleanly,
// so /update-noi can auto-fetch it. A flip means a new year (or a corrected
// re-upload) is out — re-run scripts/budget/noi/__write_pensions.ts.
//
// HEAD-only probing (size + last-modified + etag), same as the B1 watcher.
// NB: an unpublished year returns an HTML 404 page at HTTP 200, so a small body
// (< ~50 KB via content-length) is NOT a real ZIP — the describe line only
// promotes files whose content-length looks like a real archive (> 200 KB).

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// The yearbook publishes with a ~1-year lag (the 2024 edition landed mid-2025),
// so track the last three years: the newest already-published edition is the
// baseline, and the next one appearing is the signal to catch.
const trackedYears = (): number[] => {
  const cy = new Date().getUTCFullYear();
  return [cy - 2, cy - 1, cy];
};

const REAL_ZIP_MIN_BYTES = 200_000;

const probe = async (url: string): Promise<{ sig: string; bytes: number }> => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "manual",
    });
    if (res.status !== 200) return { sig: `status:${res.status}`, bytes: 0 };
    const len = res.headers.get("content-length") ?? "?";
    const mod = res.headers.get("last-modified") ?? "?";
    const etag = res.headers.get("etag") ?? "?";
    return { sig: `${len}|${mod}|${etag}`, bytes: Number(len) || 0 };
  } catch (e) {
    return { sig: `err:${(e as Error).message.slice(0, 40)}`, bytes: 0 };
  }
};

export const nssiYearbook: WatchSource = {
  id: "nssi_yearbook",
  label: "НОИ — статистически годишник „Пенсии“ (ZIP)",
  url: "https://nssi.bg/publikacii/statistika/pensii-statistika/",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const years = trackedYears();
    const signatures: Record<string, string> = {};
    const realZip: Record<string, boolean> = {};
    for (const year of years) {
      const url = `https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_${year}.zip`;
      const { sig, bytes } = await probe(url);
      signatures[String(year)] = sig;
      realZip[String(year)] = bytes >= REAL_ZIP_MIN_BYTES;
    }
    const sortedKeys = Object.keys(signatures).sort();
    const value = createHash("sha256")
      .update(sortedKeys.map((k) => `${k}=${signatures[k]}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    const published = sortedKeys.filter((k) => realZip[k]);
    return {
      value,
      detail:
        `${published.length}/${sortedKeys.length} yearbook ZIP(s) published ` +
        `· tracking ${years.join(", ")} · hash ${value}`,
      meta: { signatures, realZip, years },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevSigs = (prev.meta?.signatures as Record<string, string>) ?? {};
    const currSigs = (curr.meta?.signatures as Record<string, string>) ?? {};
    const currReal = (curr.meta?.realZip as Record<string, boolean>) ?? {};
    const prevReal = (prev.meta?.realZip as Record<string, boolean>) ?? {};
    const nowPublished: string[] = [];
    const reUploaded: string[] = [];
    for (const k of Object.keys(currSigs)) {
      if (!currReal[k]) continue; // ignore soft-404s
      if (prevSigs[k] !== currSigs[k]) {
        // A ZIP that was NOT a real archive before (soft-404 or missing) is a
        // newly-published year; a real→real change is a re-upload. Classify off
        // the stored realZip state, not the HTTP status string.
        if (!prevReal[k]) nowPublished.push(k);
        else reUploaded.push(k);
      }
    }
    if (nowPublished.length > 0)
      return (
        `${nowPublished.length} new yearbook ZIP(s): ${nowPublished.join(", ")} ` +
        `— run /update-noi (fetches the ZIP + re-runs __write_pensions.ts)`
      );
    if (reUploaded.length > 0)
      return (
        `${reUploaded.length} yearbook ZIP(s) re-uploaded: ${reUploaded.join(", ")} ` +
        `— re-run /update-noi`
      );
    return `${curr.detail} (no change)`;
  },
};
