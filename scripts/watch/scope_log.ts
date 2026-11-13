// The scope LOG: every changed run's structured scope, timestamped and carried
// forward on every later run — so a consumer can ask "what moved since MY
// marker", not just "what moved last time". Plan §3.2.
//
// Why a log and not the latest scope: a consumer can fall behind. Naredba
// flips SOF00 on day 1 and VAR06 on day 8, and one pipeline run follows on
// day 9 — the latest scope names only VAR06, the run succeeds, the marker
// advances past day 1, and the SOF00 change is never ingested. A union of
// every entry newer than the marker names both.
//
// Stored in meta (state/watch/<id>.json), which the fingerprint never reads.

import type { Fingerprint, WatchState } from "./types";

export interface ScopeEntry {
  at: string;
  scope: Record<string, string[]>;
}

export interface ScopeLogMeta {
  scopeLog?: ScopeEntry[];
  /** The log is complete for every change at or after this instant. Older
   *  changes may have been pruned — a consumer whose marker predates it
   *  cannot be given a complete scope and must not be given a partial one. */
  scopeLogSince?: string;
}

/** A changed run whose scope() threw: what moved is unknown. Logging nothing
 *  would let scopeSince() return a partial union (and the pipeline run a
 *  subset), so instead the log restarts at this run — any consumer whose
 *  marker predates it gets null ("unknown scope → full run"). */
export const SCOPE_UNKNOWN = "unknown" as const;
export type RunScope = Record<string, string[]> | null | typeof SCOPE_UNKNOWN;

const later = (a: string | undefined, b: string): string =>
  a !== undefined && Date.parse(a) >= Date.parse(b) ? a : b;

/** Entries kept per source; the oldest drop first, moving scopeLogSince. */
export const MAX_SCOPE_ENTRIES = 60;

const readLog = (meta: unknown): ScopeLogMeta => {
  const m = (meta ?? {}) as Record<string, unknown>;
  const log = Array.isArray(m.scopeLog)
    ? (m.scopeLog as unknown[]).filter(
        (e): e is ScopeEntry =>
          !!e &&
          typeof (e as ScopeEntry).at === "string" &&
          !!(e as ScopeEntry).scope &&
          typeof (e as ScopeEntry).scope === "object",
      )
    : [];
  return {
    scopeLog: log,
    scopeLogSince:
      typeof m.scopeLogSince === "string" ? m.scopeLogSince : undefined,
  };
};

/** The next state's meta: this run's fingerprint meta, plus the scope log
 *  carried forward — with this run's scope appended when it changed. */
export const carryScopeLog = (
  prev: WatchState | null,
  curr: Fingerprint,
  scope: RunScope,
  runAt: string,
): Record<string, unknown> | undefined => {
  const prevLog = readLog(prev?.meta);
  const unknown = scope === SCOPE_UNKNOWN;
  const entry = scope && !unknown ? scope : null;
  // A source without a scope hook never grows a log; keep its meta exactly.
  if (!entry && !unknown && !prevLog.scopeLog?.length) return curr.meta;
  const log = [
    ...(prevLog.scopeLog ?? []),
    ...(entry ? [{ at: runAt, scope: entry }] : []),
  ];
  // First ever entry: the log is complete from now; changes before it were
  // never logged. An unknown scope restarts completeness at this run.
  let since = unknown
    ? runAt
    : (prevLog.scopeLogSince ?? (entry ? runAt : undefined));
  while (log.length > MAX_SCOPE_ENTRIES) {
    log.shift();
    // Never move `since` backwards past an unknown-scope reset.
    since = later(since, log[0].at);
  }
  return {
    ...(curr.meta ?? {}),
    scopeLog: log,
    ...(since ? { scopeLogSince: since } : {}),
  };
};

/** The union of `key` across every scope entry strictly newer than `since`
 *  (a consumer's marker), or null when that cannot be known completely —
 *  no marker, no log, or a marker older than the log reaches. */
export const scopeSince = (
  meta: unknown,
  key: string,
  since: string | null,
): string[] | null => {
  const { scopeLog, scopeLogSince } = readLog(meta);
  if (since === null || !scopeLog?.length || !scopeLogSince) return null;
  if (Date.parse(since) < Date.parse(scopeLogSince)) return null;
  const out = new Set<string>();
  for (const e of scopeLog)
    if (Date.parse(e.at) > Date.parse(since))
      for (const v of e.scope[key] ?? [])
        if (typeof v === "string" && v) out.add(v);
  return out.size ? [...out].sort() : null;
};
