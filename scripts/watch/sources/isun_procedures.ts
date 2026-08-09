// ИСУН 2020 open procedures — the OPEN-CALLS half of ИСУН, not the awarded corpus.
//
// Two ИСУН watchers already exist (`isun_eu_funds`, `isun_eu_funds_projects`) and both watch
// money that has ALREADY been contracted. This one watches what a reader can still APPLY to, and
// the difference is the whole point of the dataset: a procedure that closes is gone from the
// upstream listing, so the thing worth detecting is a change in the SET, not growth in a total.
//
// cadence: daily. ИСУН publishes a procedure whenever a Managing Authority is ready, so
// `publishes: "irregular"` is accurate rather than a way to dodge the sampling invariant — there
// is no period to sample. Daily is the right probe because the quantity at stake is a DEADLINE:
// a week's lag on a call with a 30-day window loses a reader a quarter of their preparation time.
//
// FINGERPRINT = the sorted GUID set, hashed. Deliberately NOT a count, and deliberately not the
// max modification stamp:
//   * a count is blind to a swap — one call closing the same day another opens is the single most
//     likely daily change here, and it leaves the count identical;
//   * ИСУН's listing carries no per-procedure modification date at all, so there is no stamp to
//     max over. (The detail line's „closes soonest" is derived from the DETAIL pages, which this
//     watcher does not fetch — see below.)
//
// LISTING ONLY, NO DETAIL PAGES. The fingerprint runs on every `npm run watch`, so it must cost
// two requests, not 55. That means it cannot see a change CONFINED to a procedure's detail page
// (a deadline extended, a budget document added) — the ingest is what picks those up, and
// `open_calls.last_seen_at` records that we looked. Stated because "the fingerprint is unchanged"
// must not be read as "nothing about these procedures changed".

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short, fetchText } from "../fingerprint";
import { parseIsunListing } from "../../opencalls/isun_parse";

const BASE = "https://eumis2020.government.bg";

// The same two tiers the crawler reads, and they stay SEPARATE in the fingerprint: a draft guidance
// document moving to the active list is a real event, and a merged GUID set would hide it (the GUID
// is the same in both tiers). Paths only — the crawler's `kind` mapping is its business, not this
// file's, and carrying an unread copy of it here is how the two drift.
const ACTIVE_PATH = "/bg/s/Procedure/Active";
const CONSULT_PATH = "/bg/s/Procedure/PublicDiscussion";

interface IsunProceduresMeta {
  active: number;
  consultation: number;
  /** Every GUID in each tier, so `describe` can say what actually appeared or vanished. BOTH are
   *  stored: with only the active set, a consultation swap (one draft closes, another opens — the
   *  same shape the active tier is carefully protected against) left every counter equal and the
   *  report line indistinguishable from a no-op, on a day the fingerprint had definitely moved. */
  activeGuids: string[];
  consultGuids: string[];
}

/** The GUIDs a tier lists. Says nothing about whether zero is acceptable — that differs per tier
 *  and is decided in `fingerprint` below. */
const fetchTier = async (path: string): Promise<string[]> => {
  const html = await fetchText(`${BASE}${path}`, {
    headers: { Accept: "text/html" },
    retries: 2,
    signal: AbortSignal.timeout(60_000),
  });
  return parseIsunListing(html ?? "").map((r) => r.guid);
};

export const isunProcedures: WatchSource = {
  id: "isun_procedures",
  label: "ИСУН — отворени процедури",
  url: `${BASE}/bg/s/Procedure/Active`,
  cadence: "daily",
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const [active, consultation] = await Promise.all([
      fetchTier(ACTIVE_PATH),
      fetchTier(CONSULT_PATH),
    ]);
    // A WAF interstitial returns 200 with a body that parses to zero rows — indistinguishable from
    // a genuinely empty tier unless we say which tier we expected content in. `/Active` is never
    // empty in practice (55 rows on 2026-08-08), so zero there is a failure; PublicDiscussion is
    // legitimately empty and must NOT throw.
    if (active.length === 0) {
      throw new Error(
        "ИСУН /Active yielded zero procedures — a WAF interstitial or a markup change, not an empty register",
      );
    }
    const sortedActive = [...active].sort();
    const sortedConsult = [...consultation].sort();
    return {
      // The two tiers are hashed under separate labels, so a GUID crossing from consultation to
      // active flips the hash even though the union is unchanged.
      value: sha256Short(
        `active:${sortedActive.join(",")}|consult:${sortedConsult.join(",")}`,
      ),
      detail: `${active.length} отворени · ${consultation.length} за обсъждане`,
      meta: {
        active: active.length,
        consultation: consultation.length,
        activeGuids: sortedActive,
        consultGuids: sortedConsult,
      } satisfies IsunProceduresMeta,
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Partial<IsunProceduresMeta>;
    const c = (curr.meta ?? {}) as Partial<IsunProceduresMeta>;
    const diff = (
      prevIds: string[] = [],
      currIds: string[] = [],
    ): { added: number; gone: number } => {
      const before = new Set(prevIds);
      const after = new Set(currIds);
      return {
        added: [...after].filter((g) => !before.has(g)).length,
        gone: [...before].filter((g) => !after.has(g)).length,
      };
    };
    const a = diff(p.activeGuids, c.activeGuids);
    const s = diff(p.consultGuids, c.consultGuids);
    const bits: string[] = [];
    // BOTH directions, always — a closure is as actionable as an opening (it is what makes the
    // „затвори наскоро" archive and the base rates possible), and reporting only the additions
    // would make a day of pure closures read as a no-op.
    if (a.added) bits.push(`${a.added} нови`);
    if (a.gone) bits.push(`${a.gone} затворени`);
    // The consultation tier gets the same treatment rather than a count delta, so a swap there is
    // reported instead of vanishing into an unchanged total.
    if (s.added || s.gone)
      bits.push(
        `обсъждане: ${[s.added && `+${s.added}`, s.gone && `-${s.gone}`]
          .filter(Boolean)
          .join(" ")}`,
      );
    // `describe` only runs on a CHANGED fingerprint, so reaching here with nothing to say means the
    // hash moved for a reason none of the counters express — worth naming rather than printing a
    // line identical to a no-op day.
    return bits.length
      ? `${curr.detail} (${bits.join(" · ")})`
      : `${curr.detail} (промяна в набора)`;
  },
};
