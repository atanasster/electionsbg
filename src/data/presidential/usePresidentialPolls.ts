// Fetching decision 10's separate presidential polls file family
// (`data/polls/presidential/*.json`) — Tier 4 T4.4
// (docs/plans/polls-agency-watchers-v1.md §7).
//
// ⚠ NOT KEYED ON A CYCLE, unlike `usePresidentialSummary`'s per-cycle
// `national_summary.json`. There is ONE `accuracy.json` (etc.) covering
// every presidential cycle at once — the same "polls span elections"
// shape `usePolls.tsx` documents for the parliamentary side — so these
// fetch once, and a caller narrows to one cycle's own slice itself
// (`usePresidentialCycleAccuracy` below).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type {
  Poll,
  PresidentialCycleAccuracy,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  Runoff,
} from "@/data/polls/pollsTypes";

const logged = new Set<string>();
/** ⚠ ONCE PER PROCESS PER REASON — `usePresidentialSummary`'s own rule: a per-render
 *  warning is a log nobody reads, and a genuine fetch failure must not be silently
 *  indistinguishable from ordinary, expected absence. */
const warnOnce = (key: string, message: string): void => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
};

/** HTTP, network and JSON failures reject so pages can show an error and retry.
 * An empty accepted array is a successful response with no coverage. */
const fetchJson = async <T>(path: string): Promise<T | null> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(path));
  } catch (e) {
    // Log once while preserving React Query's error/retry state.
    warnOnce(
      `presidential_polls:network:${path}`,
      `presidential polls fetch could not complete (network or CORS): ${path}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    throw e;
  }
  if (!res.ok) throw new Error("Presidential polls HTTP " + res.status);
  return (await res.json()) as T;
};

export const usePresidentialPollsList = () =>
  useQuery({
    queryKey: ["presidential_polls", "list"],
    queryFn: () => fetchJson<Poll[]>("/polls/presidential/polls.json"),
  });

export const usePresidentialPollDetails = () =>
  useQuery({
    queryKey: ["presidential_polls", "details"],
    queryFn: () =>
      fetchJson<PresidentialPollDetail[]>(
        "/polls/presidential/polls_details.json",
      ),
  });

export const usePresidentialRunoffs = () =>
  useQuery({
    queryKey: ["presidential_polls", "runoffs"],
    queryFn: () => fetchJson<Runoff[]>("/polls/presidential/runoffs.json"),
  });

export const usePresidentialPollsAccuracy = () =>
  useQuery({
    queryKey: ["presidential_polls", "accuracy"],
    queryFn: () =>
      fetchJson<PresidentialPollsAccuracy>("/polls/presidential/accuracy.json"),
  });

/** Loading, a fetched cycle, no cycle entry, and a failed artifact request
 * are distinct. A fetched cycle may contain diagnostics and partial comparisons
 * even when no complete overall grade is available. */
export type PresidentialCycleAccuracyState =
  | { status: "loading" }
  | { status: "ready"; cycle: PresidentialCycleAccuracy }
  | { status: "unscored" }
  | { status: "error"; retry: () => void };

export const usePresidentialCycleAccuracy = (
  cycle: string | undefined,
): PresidentialCycleAccuracyState => {
  const query = usePresidentialPollsAccuracy();
  if (query.isPending) return { status: "loading" };
  if (query.isError)
    return {
      status: "error",
      retry: () => {
        void query.refetch();
      },
    };
  const found = cycle
    ? query.data?.cycles.find((c) => c.cycle === cycle)
    : undefined;
  return found ? { status: "ready", cycle: found } : { status: "unscored" };
};

export const usePresidentialCoverage = () =>
  useQuery({
    queryKey: ["presidential_polls", "coverage"],
    queryFn: () =>
      fetchJson<import("./pollCoverage").PresidentialCoverage>(
        "/polls/presidential/coverage.json",
      ),
  });
