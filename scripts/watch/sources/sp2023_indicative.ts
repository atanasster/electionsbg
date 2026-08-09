// ДФ „Земеделие" — the INDICATIVE intake schedule under the CAP Strategic Plan 2023-2027.
//
// Distinct from `dfz_subsidies`, which watches money already PAID. This watches the forecast of
// which interventions will open and roughly when — the „очаквани приеми" half of /funds/calls.
//
// cadence: weekly, publishes: annual. ДФЗ tables the schedule once per year and amends it a
// handful of times; weekly samples that comfortably. The value here is not urgency (these are
// month ranges, not deadlines — invariant 2) but knowing an amendment landed.
//
// FINGERPRINT = the XLSX bytes, hashed, plus the file URL. Two reasons it is the bytes and not
// parsed row count:
//   * an amendment that moves a window from „март-май" to „април-юни" changes no count and is the
//     most common edit this document receives;
//   * the parse is the thing most likely to break on a re-table, and a fingerprint that depends
//     on it would report "unchanged" when the parser had silently started returning nothing.
// The URL is included because ДФЗ publishes each year as a NEW file rather than replacing one,
// so a new URL with identical bytes (a re-upload under a new name) is still worth surfacing.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short, fetchText } from "../fingerprint";
import {
  findXlsxCandidates,
  pickCandidate,
  SP2023_PAGE as PAGE,
} from "../../opencalls/sp2023_fetch";

const UA = "electionsbg-watch/1.0 (+https://electionsbg.com)";

interface Sp2023Meta {
  /** The chosen file's absolute URL — a new year arrives as a new url, not a replacement. */
  url: string;
  /** The year parsed out of the FILENAME. Never read out of the URL: the host is `sp2023.bg`, so a
   *  whole-URL match hands every link a phantom 2023. Non-null by construction — `pickCandidate`
   *  throws when no candidate carries a year. */
  year: number;
  bytes: number;
  /** The XLSX content hash. `bytes` alone cannot phrase an amendment: a same-length edit (a date, a
   *  figure) rendered as „изменен график, +0 B", which reads as „nothing changed" on a run where
   *  the fingerprint had definitely moved. */
  sha: string;
}

export const sp2023Indicative: WatchSource = {
  id: "sp2023_indicative",
  label: "ДФЗ — индикативен график (Стратегически план)",
  url: PAGE,
  cadence: "weekly",
  publishes: "annual",

  async fingerprint(): Promise<Fingerprint> {
    // The PAGE goes through the shared fetchText (retries + standard headers); the XLSX below stays
    // a raw fetch because it needs the bytes, not text.
    const html = await fetchText(PAGE, {
      headers: { Accept: "text/html" },
      retries: 2,
      signal: AbortSignal.timeout(60_000),
    });
    const cands = findXlsxCandidates(html ?? "");
    if (cands.length === 0) {
      // Not "no schedule published" — the schedule is a standing document. Zero candidates means
      // the page markup moved or the link is now behind script, both of which need a human.
      throw new Error(
        "sp2023 indicative page yielded zero XLSX links — markup change, not an empty schedule",
      );
    }
    const chosen = pickCandidate(cands);
    const file = await fetch(chosen.url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(90_000),
    });
    if (!file.ok) {
      throw new Error(`sp2023 XLSX → HTTP ${file.status} for ${chosen.url}`);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) throw new Error("sp2023 XLSX was empty");
    const sha = sha256Short(buf);
    // `pickCandidate` throws when no candidate carries a year, so this cast is the type catching up
    // with a guarantee the fetcher already makes rather than an assumption.
    const year = chosen.year as number;
    return {
      value: sha256Short(`${chosen.url}|${sha}`),
      detail: `график ${year} · ${Math.round(buf.length / 1024)} KB`,
      meta: {
        url: chosen.url,
        year,
        bytes: buf.length,
        sha,
      } satisfies Sp2023Meta,
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Partial<Sp2023Meta>;
    const c = (curr.meta ?? {}) as Partial<Sp2023Meta>;
    // A NEW YEAR and an AMENDMENT need different responses — a new year means new interventions,
    // an amendment usually means a window moved — so the report distinguishes them rather than
    // saying "changed".
    if (p.year != null && c.year != null && c.year !== p.year) {
      return `${curr.detail} (нова година: ${p.year}→${c.year})`;
    }
    if (p.url && c.url && p.url !== c.url) {
      return `${curr.detail} (нов файл за същата година)`;
    }
    // Phrased off CONTENT identity, not size. A same-length edit is a real amendment and „+0 B"
    // read as a no-op on a day the hash had moved.
    const d = (c.bytes ?? 0) - (p.bytes ?? 0);
    if (d === 0)
      return `${curr.detail} (изменен график — същия размер, различно съдържание)`;
    return `${curr.detail} (изменен график, ${d > 0 ? "+" : ""}${d} B)`;
  },
};
