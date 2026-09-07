// The presidential family's guarded fetch — written ONCE, after being re-derived six times.
//
// ⚠⚠ THE FOUR STATES ARE THE POINT, and none of them may collapse into another.
// `loading` is „we have not asked yet", `absent` is „this election has no such document",
// `unusable` is „there is a file and it is not fit to render", and `ready` carries a payload
// that passed its own guard. `data/*_pvr` is gitignored and reaches the bucket only through
// `bucket:gz`, so ABSENT is the ordinary answer for most of this corpus — which is exactly why
// it must never be reported as an error, and why a broken origin must never be reported as
// absence.
//
// ⚠ WHY IT IS ONE MODULE NOW. Six hooks each carried their own copy of `str`, `num`, a
// `warnOnce` set and this state machine — and a rule fixed in one copy stayed broken in the
// other five. That is not hypothetical: the suspicious-settlements guard shipped without a
// `flaggedShare` arm precisely because its body was re-derived rather than composed, and a
// `null` there renders „covers 0% of measurable settlements" inside the sentence saying the
// flag separated nothing. Each hook now keeps only what is genuinely its own — its payload
// type, its `is…` predicate, and the words it logs.
//
// ⚠ `usePresidentialSummary` IS DELIBERATELY NOT ON THIS PATH. It has TWO absent arms (a
// missing catalogue entry as well as a 404) and its `useQuery` default is `absent` rather than
// `loading`, because a cycle the catalogue does not know is not a page that is still loading.
// Folding it in would need an absent-predicate parameter that no other caller wants.

/** A non-empty string. ⚠ EMPTY IS NOT VALID: every caveat this family guards is a SENTENCE,
 *  and an empty one renders as a missing caveat rather than as a short one. */
export const str = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

/** A real number. ⚠ `Number.isFinite` REJECTS `NaN` and both infinities, which is what keeps a
 *  „—" out of a figure a reader would otherwise calibrate a threshold against. */
export const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** ⚠ ONCE PER PROCESS PER REASON. A hook is called per render and per cycle; without this a
 *  broken origin writes a console line on every one of them, which buries the first. The
 *  `reset` is the test seam — the set is module state, so a suite asserting on it needs a way
 *  back. */
export const makeWarnOnce = (): {
  warnOnce: (key: string, message: string) => void;
  reset: () => void;
} => {
  const logged = new Set<string>();
  return {
    warnOnce: (key, message) => {
      if (logged.has(key)) return;
      logged.add(key);
      console.warn(message);
    },
    reset: () => logged.clear(),
  };
};

export type GuardOutcome<T> =
  | { status: "ready"; value: T }
  | { status: "absent" }
  | { status: "unusable" };

export interface GuardedFetchOptions<T> {
  /** The bucket path, WITHOUT a leading slash — `dataUrl` adds the origin. */
  path: string;
  /** What the log line calls this request: a cycle, or `<cycle>/tur<round>`. */
  id: string;
  /** The log-key namespace — `ss`, `pc`, `rt`, `st`, `ot`. Keeps two hooks' warnings apart. */
  prefix: string;
  /** What the log line calls this artifact, e.g. „suspicious settlements". */
  subject: string;
  guard: (v: unknown) => v is T;
  /** What to say when the guard refuses — the SPECIFIC thing the file lost, never „invalid". */
  shapeMessage: string;
  warnOnce: (key: string, message: string) => void;
  /** Injected so a caller can share one `dataUrl` import; the hooks all pass the real one. */
  toUrl: (path: string) => string;
}

export const guardedFetch = async <T>({
  path,
  id,
  prefix,
  subject,
  guard,
  shapeMessage,
  warnOnce,
  toUrl,
}: GuardedFetchOptions<T>): Promise<GuardOutcome<T>> => {
  let res: Response;
  try {
    res = await fetch(toUrl(path));
  } catch (e) {
    // ⚠ A REJECTED FETCH LOOKS EXACTLY LIKE ROUTINE ABSENCE — a CORS misconfiguration on the
    // bucket takes every cycle out at once, and uncaught it reaches the reader as „no such
    // analysis". Caught here so it gets its own line and its own state.
    warnOnce(`${prefix}:net:${id}`, `${subject} ${id}: fetch failed (${e})`);
    return { status: "unusable" };
  }
  if (res.status === 404) return { status: "absent" };
  if (!res.ok) {
    warnOnce(`${prefix}:http:${id}`, `${subject} ${id}: HTTP ${res.status}`);
    return { status: "unusable" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // ⚠ A 200 CARRYING THE SPA SHELL. A `data/**` fetch that misses the bucket falls through to
    // the catch-all, which `firebase.json` stamps `application/json` — successful right up to
    // `JSON.parse`, and the one signature that separates a misconfigured data origin from an
    // absent file.
    warnOnce(`${prefix}:json:${id}`, `${subject} ${id}: not JSON`);
    return { status: "unusable" };
  }
  if (!guard(body)) {
    warnOnce(`${prefix}:shape:${id}`, `${subject} ${id}: ${shapeMessage}`);
    return { status: "unusable" };
  }
  return { status: "ready", value: body };
};
