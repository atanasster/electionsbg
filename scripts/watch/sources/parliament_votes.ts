// Walks parliament.bg stenogram ids forward from the last-known max to discover
// new plenary sessions. Each stenogram (Pl_Sten_id) corresponds to one plenary
// day and ships a `files` array; entries with name "Поименно гласуване" and
// type "xls" (with filename ending .csv) carry the per-MP roll-call CSV that
// /update-rollcall ingests.
//
// Discovery is brute-force walk because parliament.bg has no list endpoint —
// pl-doc-period and pl-doc with Vid filtering don't index stenograms. We stop
// after WALK_GAP_STOP consecutive non-existent ids past the last known max.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson, sleep } from "../fingerprint";

const API = "https://www.parliament.bg/api/v1";
const PROBE_DELAY_MS = 150; // be gentle with parliament.bg

// Cold-start id. Picked just below the most recent stenogram observed during
// the build-time spike (id 11120 = 2026-04-01). On a fresh runner with no
// state, the watcher starts walking from here. With state present, this is
// ignored — we resume from state.meta.maxId.
const COLD_START_ID = 11100;
const WALK_GAP_STOP = 30; // stop after this many consecutive empty ids
const WALK_MAX_PER_RUN = 200; // safety cap per run

interface PlSten {
  Pl_Sten_id: number;
  Pl_Sten_date: string;
  Pl_Sten_sub: string;
  files?: Array<{
    Pl_StenDname: string;
    Pl_StenDfile: string;
    Pl_StenDtype: string;
  }>;
}

const isRollcallCsv = (f: {
  Pl_StenDname: string;
  Pl_StenDfile: string;
  Pl_StenDtype: string;
}): boolean =>
  f.Pl_StenDname.includes("Поименно") && f.Pl_StenDfile.endsWith(".csv");

const probeStenogram = async (id: number): Promise<PlSten | null> => {
  // pl-sten returns the SPA shell (4+ KB HTML) or a server-error stub (~33 B)
  // for non-existent ids. allow404 doesn't help because the API returns 200
  // with garbage; rely on JSON parsing failing (returns null when allow404).
  const data = await fetchJson<PlSten>(`${API}/pl-sten/${id}`, {
    allow404: true,
  });
  if (!data || !data.Pl_Sten_id || !data.Pl_Sten_date) return null;
  return data;
};

export const parliamentVotes: WatchSource = {
  id: "parliament_votes",
  label: "Parliament roll-call votes",
  url: "https://www.parliament.bg/api/v1/pl-sten/{id}",
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    // Resume from state — written into meta on prior runs.
    // (We can't read state here, so the runner injects via a closure? No:
    // simpler to re-read state from disk via dynamic import. But that creates
    // a coupling. Solution: walk strictly forward and let state.meta inform
    // the start. We rely on the runner having read state into the meta of the
    // PREVIOUS fingerprint, and use that. Since fingerprint() can't see prev,
    // we instead read state file directly here — the file system is the
    // source of truth.)
    const prev = await readPrevMeta();
    const startAfter = prev?.maxId ?? COLD_START_ID;

    let lastFound = startAfter;
    let lastFoundDate: string | null = prev?.maxDate ?? null;
    let gap = 0;
    let scanned = 0;
    const newSessions: Array<{
      id: number;
      date: string;
      hasRollcall: boolean;
    }> = [];

    for (let id = startAfter + 1; scanned < WALK_MAX_PER_RUN; id++, scanned++) {
      let sten: PlSten | null = null;
      try {
        sten = await probeStenogram(id);
      } catch {
        // Transient failure on one id — treat as a gap rather than killing the
        // whole watcher run. The next daily run will re-walk and find it.
        sten = null;
      }
      await sleep(PROBE_DELAY_MS);
      if (!sten) {
        gap++;
        if (gap >= WALK_GAP_STOP) break;
        continue;
      }
      gap = 0;
      const hasRollcall = (sten.files ?? []).some(isRollcallCsv);
      newSessions.push({ id, date: sten.Pl_Sten_date, hasRollcall });
      lastFound = id;
      lastFoundDate = sten.Pl_Sten_date;
    }

    const rollcallCount = newSessions.filter((s) => s.hasRollcall).length;
    const value = `${lastFound}|${lastFoundDate ?? ""}`;
    const detail =
      newSessions.length === 0
        ? `no new sessions (max id ${lastFound}${lastFoundDate ? `, ${lastFoundDate}` : ""})`
        : `${newSessions.length} new session(s), ${rollcallCount} with roll-call CSV (latest id ${lastFound}, ${lastFoundDate})`;

    return {
      value,
      detail,
      meta: {
        maxId: lastFound,
        maxDate: lastFoundDate,
        newSinceLast: newSessions,
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const newSessions =
      (curr.meta?.newSinceLast as
        | Array<{ id: number; date: string; hasRollcall: boolean }>
        | undefined) ?? [];
    if (newSessions.length === 0) return curr.detail;
    const rollcall = newSessions.filter((s) => s.hasRollcall);
    const head = rollcall.length
      ? `${rollcall.length} new roll-call session(s) since ${prev.lastChanged.slice(0, 10)}`
      : `${newSessions.length} new session(s), none with roll-call CSV yet`;
    const dates = newSessions
      .slice(-3)
      .map((s) => s.date)
      .join(", ");
    return `${head} (latest: ${dates})`;
  },
};

// Read prior state directly from disk so fingerprint() can resume walking.
// Decoupled here (rather than passed in) to keep the WatchSource interface
// uniform across all sources.
const readPrevMeta = async (): Promise<{
  maxId?: number;
  maxDate?: string;
} | null> => {
  const { readState } = await import("../state");
  const s = readState("parliament_votes");
  if (!s?.meta) return null;
  return {
    maxId: typeof s.meta.maxId === "number" ? s.meta.maxId : undefined,
    maxDate: typeof s.meta.maxDate === "string" ? s.meta.maxDate : undefined,
  };
};
