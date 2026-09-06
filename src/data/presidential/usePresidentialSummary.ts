// Fetching one presidential cycle's `national_summary.json`.
//
// ⚠ THE COUNTRY LEVEL IS `canonical` (`SURFACE_POLICY.presidential.country`), which is why this
// hook exists at all. Every level below it is served from a generated surface artifact through
// `useElectionSurface`; the country's own file is 13.6 KB at its largest — inside the 24 KiB
// budget — so §5.0 says read it directly rather than mint a second copy of it.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR — the same rule `useElectionSurface` states. A
// cycle whose tree has not been published yet is the expected answer for most of this corpus,
// and throwing would put it in React Query's retry-and-error path.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { isPresidentialSummary, type PresidentialSummary } from "./summary";

/** ⚠ FOUR STATES, NOT A BOOLEAN. „Still loading", „no such cycle published", „published but
 *  unreadable" and „here it is" are four different instructions to a screen, and collapsing
 *  the middle two renders a parse failure as a cycle that does not exist. */
export type PresidentialSummaryState =
  | { status: "loading" }
  | { status: "ready"; summary: PresidentialSummary }
  | { status: "absent" }
  | { status: "unusable" };

const logged = new Set<string>();
/** ⚠ ONCE PER PROCESS PER REASON — `useElectionSurface`'s rule, for the same reason: a
 *  per-render warning is a log nobody reads, and „not published" (expected) must not be
 *  indistinguishable from „malformed" (a defect). */
const warnOnce = (key: string, message: string): void => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
};

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetPresidentialSummaryWarnings = (): void => logged.clear();

export const summaryPath = (cycle: string): string =>
  `${cycle}/national_summary.json`;

export const fetchPresidentialSummary = async (
  cycle: string,
): Promise<PresidentialSummaryState> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${summaryPath(cycle)}`));
  } catch (e) {
    // ⚠ A REJECTED FETCH LOOKS EXACTLY LIKE ROUTINE ABSENCE — a CORS misconfiguration on the
    // data bucket takes every cycle out at once, and uncaught it would reach the reader as the
    // same silent „not published yet". Caught here so it gets its own line.
    warnOnce(
      "presidential:network",
      `presidential summary fetch could not complete (network or CORS): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { status: "absent" };
  }
  if (res.status === 404) {
    warnOnce(
      `presidential:absent:${cycle}`,
      `presidential summary not published: ${cycle}`,
    );
    return { status: "absent" };
  }
  if (!res.ok) {
    warnOnce(
      `presidential:http:${res.status}:${cycle}`,
      `presidential summary fetch failed: ${res.status} ${res.url}`,
    );
    // ⚠ NOT `absent`. 404 means „not published"; anything else means our bucket is failing,
    // and telling a reader we never published a cycle we ship a catalogue of is the same
    // false statement this module's header refuses for the network arm. „Could not be read"
    // is true of a 500 and of a 403 alike.
    return { status: "unusable" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    warnOnce(
      `presidential:malformed:${cycle}`,
      `presidential summary is not JSON: ${cycle}`,
    );
    return { status: "unusable" };
  }
  if (!isPresidentialSummary(body)) {
    warnOnce(
      `presidential:shape:${cycle}`,
      `presidential summary has an unexpected shape: ${cycle}`,
    );
    return { status: "unusable" };
  }
  return { status: "ready", summary: body };
};

export const usePresidentialSummary = (
  cycle?: string,
): PresidentialSummaryState => {
  const query = useQuery({
    queryKey: ["presidential_summary", cycle],
    queryFn: () => fetchPresidentialSummary(cycle!),
    // An unresolved route param is `loading`, never `absent` — falling back on it renders the
    // not-published body and never re-renders when the id lands.
    enabled: Boolean(cycle),
  });
  if (!cycle || query.isPending) return { status: "loading" };
  return query.data ?? { status: "absent" };
};
