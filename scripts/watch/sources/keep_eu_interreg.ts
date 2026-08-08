// keep.eu (INTERACT) — the Interreg cross-border corpus behind /funds' Interreg
// section, the per-place tiles and the /funds/interreg/:keepId pages.
//
// WHY THIS WATCHES PROGRAMMES AND NOT THE PROJECT INDEX. keep.eu's search index
// is id-DESCENDING and exposes no `modified`, so "walk until a known id" finds
// NEW operations and is blind to REVISED ones — and keep.eu re-imports whole
// programmes (ROBG 21-27 in 2026-04, BSB NEXT in 2026-05, Euro-MED in 2026-06),
// rewriting existing rows in place. A full index walk is ~2 h at 8-way
// concurrency, which is far too heavy for a daily probe.
//
// `/api/programme/<id>/` publishes `date_of_data_import` — the date that
// programme's Jems export was last ingested — so 22 cheap requests detect a
// re-import that an id-based probe would miss entirely. That is the trigger the
// plan named (docs/plans/interreg-funds-ingest-v1.md §2.1).
//
// COVERAGE IS PARTIAL AND THE DETAIL LINE SAYS SO: measured 2026-08-07, only
// 11 of the 22 curated programmes publish the field at all. A re-import of one
// of the other 11 is invisible here, so "unchanged" means "none of the eleven
// moved" — not "nothing moved". That is a floor on what this source can promise,
// not a bug to fix on our side.
//
// AND NAMING THE PROGRAMMES IS DIAGNOSIS, NOT SCOPING. `crawl.ts` has no
// programme filter (`ingest.ts`'s `--programme` is a debugging flag that refuses
// to write), so the action a change triggers is still the full walk. What the
// names buy is knowing a re-import happened at all.
//
// cadence: weekly — a programme re-import is a monthly-to-quarterly event, and
// the crawl it triggers is rate-limited and operator-run either way.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { INTERREG_PROGRAMMES } from "../../funds/interreg/programmes";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)";

/** `date_of_data_import` per curated programme code. Absent ids are recorded as
 *  null rather than dropped, so a programme disappearing from keep.eu is itself
 *  a change rather than a silent shrink of the signal. */
type ImportDates = Record<string, string | null>;

// 10 s, NOT the 30 s a single-request source can afford: 22 serial requests at
// 30 s is 660 s worst case against the runner's 300 s hard cap
// (scripts/watch/index.ts), so exactly the case this timeout exists for —
// keep.eu slow or throttling — would produce a source that can never complete
// and errors every week with no partial progress. 22 x 10 s = 220 s fits.
const REQUEST_TIMEOUT_MS = 10_000;

const fetchImportDate = async (id: number): Promise<string | null> => {
  const res = await fetch(`https://keep.eu/api/programme/${id}/`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // 404 is a real answer — the programme is gone from keep.eu — and must not
  // abort the whole probe. Any other non-OK is a transport problem worth
  // surfacing, because a silently-empty fingerprint would read as "no change".
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `keep.eu programme ${id} → HTTP ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { date_of_data_import?: string | null };
  return body?.date_of_data_import ?? null;
};

/** The pure `dates → Fingerprint` step, extracted so it can be tested without a
 *  network: `fetchImportDate` closes over global fetch and is not exported. */
export const summariseImportDates = (dates: ImportDates): Fingerprint => {
  const known = Object.values(dates).filter(Boolean).length;
  if (known === 0) {
    // Every programme answering null means keep.eu changed shape or blocked us,
    // not that 22 programmes vanished. Throwing keeps the watcher from recording
    // a "nothing to see" state it would then compare against.
    throw new Error("keep.eu published no import date for any programme");
  }
  // Sorted so the hash is stable against registry reordering — the curated
  // list's order is editorial and must not look like a source change.
  const value = sha256Short(
    Object.keys(dates)
      .sort()
      .map((k) => `${k}=${dates[k] ?? "-"}`)
      .join("|"),
  );
  const newest = Object.values(dates)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  return {
    value,
    detail: `${known}/${INTERREG_PROGRAMMES.length} programmes · newest import ${newest}`,
    meta: { dates },
  };
};

export const keepEuInterreg: WatchSource = {
  id: "keep_eu_interreg",
  label: "keep.eu Interreg (programme re-imports)",
  url: "https://keep.eu/",
  cadence: "weekly",
  // Monthly-to-quarterly in practice — ROBG 21-27 landed 2026-04, BSB NEXT
  // 2026-05, Euro-MED 2026-06. Declaring it enrols the source in
  // cadence.test.ts's per-source invariant, which is the gate that exists to
  // stop a probe drifting slower than its upstream.
  publishes: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const dates: ImportDates = {};
    // Serial, not concurrent: 22 requests is nothing, and keep.eu is a
    // public-good API run by INTERACT — the crawl already asks a lot of it.
    for (const p of INTERREG_PROGRAMMES) {
      dates[p.code] = await fetchImportDate(p.keepProgrammeId);
    }
    return summariseImportDates(dates);
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = ((prev.meta ?? {}) as { dates?: ImportDates }).dates ?? {};
    const c = ((curr.meta ?? {}) as { dates?: ImportDates }).dates ?? {};
    // NAME THE PROGRAMMES, because the operator's next action depends on WHICH
    // moved — and on WHAT KIND of move it was. Those are two different sentences
    // and conflating them is not cosmetic: "re-imported" is the word that costs
    // a ~2 h --full crawl, so a programme that merely STOPPED publishing a date
    // (keep.eu soft-degrading, or the programme disappearing) must not be
    // reported as one.
    const keys = Object.keys({ ...p, ...c }).sort();
    const changed = keys.filter((k) => (p[k] ?? null) !== (c[k] ?? null));
    if (changed.length === 0) return curr.detail;
    const reimported = changed.filter((k) => c[k]);
    const wentDark = changed.filter((k) => !c[k]);
    const parts: string[] = [];
    if (reimported.length)
      parts.push(
        `${reimported.length} programme(s) re-imported: ` +
          reimported.map((k) => `${k} ${p[k] ?? "—"} → ${c[k]}`).join("; "),
      );
    if (wentDark.length)
      parts.push(
        `${wentDark.length} programme(s) stopped publishing an import date ` +
          `(keep.eu degraded, or the programme is gone — NOT a re-import): ` +
          wentDark.join(", "),
      );
    return parts.join(". ");
  },
};
