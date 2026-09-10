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

/** ⚠ RETURNS `null`, NEVER `undefined` — React Query v5 refuses a `queryFn` that
 *  resolves to `undefined` ("Query data cannot be undefined"). `null` reads
 *  identically at every call site below (`query.data?.cycles.find(...)`). */
const fetchJson = async <T>(path: string): Promise<T | null> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(path));
  } catch (e) {
    // ⚠ A REJECTED FETCH LOOKS EXACTLY LIKE ROUTINE ABSENCE (no poll accepted yet) —
    // a CORS misconfiguration on the data bucket would otherwise present identically
    // to "no polls for this cycle". Caught here so it gets its own line.
    warnOnce(
      `presidential_polls:network:${path}`,
      `presidential polls fetch could not complete (network or CORS): ${path}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
  if (!res.ok) return null;
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

/** ⚠ THREE-VALUED — a deliberate simplification of `src/data/presidential/`'s usual
 *  four-valued convention (`usePresidentialSummary`'s own header): "still loading",
 *  "this cycle has no scored poll yet" and "here it is" are different instructions
 *  to a screen, and the plan's own text is explicit that the middle one renders as
 *  its own message, NEVER an empty band. Unlike `PresidentialSummaryState`,
 *  "accuracy.json itself absent" and "cycle not (yet) in the list" are NOT
 *  distinguished — both are `unscored`, since a screen instructs the reader
 *  identically either way. */
export type PresidentialCycleAccuracyState =
  | { status: "loading" }
  | { status: "ready"; cycle: PresidentialCycleAccuracy }
  | { status: "unscored" };

export const usePresidentialCycleAccuracy = (
  cycle: string | undefined,
): PresidentialCycleAccuracyState => {
  const query = usePresidentialPollsAccuracy();
  if (query.isPending) return { status: "loading" };
  const found = cycle
    ? query.data?.cycles.find((c) => c.cycle === cycle)
    : undefined;
  return found ? { status: "ready", cycle: found } : { status: "unscored" };
};
