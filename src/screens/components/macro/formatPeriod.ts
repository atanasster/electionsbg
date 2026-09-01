// The period label under a KPI figure, in its own module.
//
// ⚠️ OUT OF `KpiTile.tsx` DELIBERATELY. It has two consumers now — the tile and the
// /indicators head's band — and a component file that also exports a helper breaks
// react-refresh (`react-refresh/only-export-components`). Same reason `mpAssetsScope.ts` and
// the `*HubFigures.ts` modules exist: a pure function shared by a screen and its head lives
// beside neither.
//
// ⚠️ AND IT MUST STAY THE ONLY ONE. The band and the grid show the same indicators as of the
// same snapshot, so two formatters would be two spellings of one date on one page — drift
// that is invisible until somebody reads both halves.

/** „2 тр. 2026" / „2026 Q2" / „август 2026 г." — the period label under a KPI figure.
 *
 *  ⚠️ EXPORTED so the /indicators HEAD's band spells the date exactly as the grid below it
 *  does. The band and the tiles show the same indicators as of the same snapshot; two
 *  formatters would be two spellings of one date on one page, and the drift would be
 *  invisible until somebody read both halves.
 *
 *  Takes the raw `period` plus a year/quarter fallback, because the KPI series carry the
 *  string and the derived snapshots sometimes only carry the parts. */
export const formatPeriod = (
  raw: string | undefined,
  year: number,
  quarter: 1 | 2 | 3 | 4 | undefined,
  lang: "bg" | "en",
): string => {
  if (raw) {
    const m = /^(\d{4})-Q([1-4])$/.exec(raw);
    if (m) {
      return lang === "bg" ? `${m[2]} тр. ${m[1]}` : `${m[1]} Q${m[2]}`;
    }
    // ⚠️ MONTHS TOO, since the monthly series landed. Falling through to the raw string
    // rendered „Последна точка: 2026-08" under a head that had just said „август 2026 г." —
    // the same period, spelled two ways, one click apart. Guarded on 01-12 rather than
    // `\d{2}`: `Date.UTC` rolls over, so „2026-13" would format as January 2027, which is a
    // plausible-looking date nobody published.
    const mm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
    if (mm)
      return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
        year: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(Number(mm[1]), Number(mm[2]) - 1, 1)));
    return raw;
  }
  if (quarter)
    return lang === "bg" ? `${quarter} тр. ${year}` : `${year} Q${quarter}`;
  return `${year}`;
};

/** The same rule for callers that hold only a raw „2026-Q2" string.
 *
 *  ⚠️ THIS EXISTS BECAUSE THERE WERE THREE COPIES. `PeerSnapshotStrip` and
 *  `PeerSnapshotTable` each carried their own inline version of the regex and the two
 *  spellings — on the very pages the /indicators band links to, so one page could render a
 *  quarter three ways. They call this now. */
export const formatQuarter = (period: string, lang: "bg" | "en"): string =>
  formatPeriod(period, 0, undefined, lang);
