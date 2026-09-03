// Fetching one place's result surface (Phase 2 item 1).
//
// ⚠ A MISSING ARTIFACT IS NOT AN ERROR. §12's rollback is "a missing artifact renders the legacy
// body", and v1 generates only the latest parliamentary cycle and the latest two local ones — so
// a 404 is the EXPECTED answer for most of the corpus and resolves to `undefined`, not a thrown
// query. Throwing would put every unmigrated cycle into React Query's retry-and-error path and
// turn a designed fallback into a visible failure.
//
// ⚠ THE FETCH POSTURE IS THE APP'S, NOT THIS HOOK'S. `src/data/queryClient.ts` already sets
// `staleTime: Infinity` / `refetchOnWindowFocus: false` for every query, and restating them here
// would be a second definition that can drift from it. The library's OWN defaults are the danger
// the plan names — a bare `new QueryClient()` refetches on every window focus — which is why
// `useElectionSurface.test.ts` asserts the shared client carries the posture rather than trusting
// it, and why a test that builds its own client must opt in.
//
// ⚠ IT DOES NOT DECIDE WHETHER TO RENDER. That is `ElectionSurfaceBoundary`'s job: this hook
// reports what it found, including "this level is served from its canonical shard" and "the id
// has not arrived yet", and never conflates them.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { locateSurface } from "./surfacePath";
import {
  isElectionSurfaceV1,
  isWellFormedElectionSurfaceV1,
  type ElectionKind,
  type ElectionPlaceLevel,
  type ElectionSurfaceV1,
} from "./surfaceTypes";

/** Why a place has no fetched surface — each a different instruction to the caller.
 *
 *  ⚠ FIVE STATES, NOT A BOOLEAN. "There is no artifact for this level", "the id is still
 *  resolving", "this kind × level does not exist", "the artifact is not published for this
 *  cycle" and "it is published but unreadable" are five different things, and the last two are
 *  the only ones that mean something went wrong. A boolean collapses them into a fallback that
 *  fires while a route param is loading — which renders the legacy body and never re-renders. */
export type ElectionSurfaceState =
  | { status: "ready"; surface: ElectionSurfaceV1 }
  /** Still fetching, or the place id has not resolved. Render a skeleton, not a fallback. */
  | { status: "loading" }
  /** This level is served from its canonical shard by design (§5.0) — use the legacy body. */
  | { status: "canonical" }
  /** The canonical shard carries the surface under a `surface` key (§5.0). */
  | { status: "embedded" }
  /** This kind × level does not exist; render the descriptor's reason. */
  | { status: "none" }
  /** No artifact published for this cycle — the documented fallback (§12). */
  | { status: "absent" }
  /** Published but unusable: wrong schema version, or malformed. */
  | { status: "unusable"; reason: "schema_version" | "malformed" };

/** Which states render the new surface rather than the page's existing body.
 *
 *  ⚠ THE BOUNDARY READS THIS RATHER THAN RE-DERIVING IT. It was declared here "so a gate can
 *  enumerate the rule" and then used by nothing while the component tested `status === "ready"`
 *  itself — a second definition of the most consequential rule in the phase, and exactly the
 *  decorative-guard shape this codebase keeps finding. One definition, two readers: the
 *  component branches on it and the gate enumerates it. */
export const RENDERS_SURFACE: ReadonlySet<ElectionSurfaceState["status"]> =
  new Set(["ready"]);

export const rendersSurface = (
  s: ElectionSurfaceState,
): s is Extract<ElectionSurfaceState, { status: "ready" }> =>
  RENDERS_SURFACE.has(s.status);

/** ⚠ LOGGED ONCE PER PROCESS PER REASON. Phase 2's gate: "a missing/corrupt surface falls back
 *  without an empty first screen, AND logs the reason once per process." Once, because these
 *  pages are the highest-traffic on the site and a per-render warning is a log nobody reads;
 *  per REASON, because "no artifact for this cycle" (expected) and "the published artifact is
 *  malformed" (a defect) must never be indistinguishable in the output. */
const logged = new Set<string>();
export const warnOnce = (key: string, message: string): void => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
};

/** Test-only: the once-per-process guard is module state, so a suite that asserts on it needs a
 *  way back to a known start. Not exported to production callers by accident — the name says so. */
export const __resetSurfaceWarnings = (): void => logged.clear();

export const fetchSurface = async (
  path: string,
): Promise<ElectionSurfaceState> => {
  // ⚠ A REJECTED FETCH IS THE ONE FAILURE THAT LOOKS LIKE ROUTINE ABSENCE. `fetch` rejects on a
  // network error, a DNS failure and — the one this repo has actually hit — a CORS
  // misconfiguration on the data bucket. Left uncaught it propagates into React Query, retries,
  // resolves to `absent`, and reaches the reader as the SAME silent legacy fallback an
  // unpublished cycle produces. Every surface on the site would be missing and nothing would say
  // so. Caught here so it gets its own once-per-process line.
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${path}`));
  } catch (e) {
    warnOnce(
      "network",
      `election surface fetch could not complete (network or CORS): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { status: "absent" };
  }
  // 404 is the documented fallback, not a failure — see the header.
  if (res.status === 404) {
    warnOnce(`absent:${path}`, `election surface not published: ${path}`);
    return { status: "absent" };
  }
  if (!res.ok) {
    warnOnce(
      `http:${res.status}`,
      `election surface fetch failed: ${res.status} ${res.url}`,
    );
    return { status: "absent" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    warnOnce(`malformed:${path}`, `election surface is not JSON: ${path}`);
    return { status: "unusable", reason: "malformed" };
  }
  // ⚠ THE VERSION IS CHECKED BEFORE THE SHAPE. A future v2 is not "malformed" — it is a
  // document this build does not know how to read, and saying so is what makes a schema bump a
  // planned fallback rather than a bug report.
  if (!isElectionSurfaceV1(body)) {
    warnOnce(
      `version:${path}`,
      `election surface has an unsupported schemaVersion: ${path}`,
    );
    return { status: "unusable", reason: "schema_version" };
  }
  if (!isWellFormedElectionSurfaceV1(body)) {
    warnOnce(`malformed:${path}`, `election surface is malformed: ${path}`);
    return { status: "unusable", reason: "malformed" };
  }
  return { status: "ready", surface: body };
};

export type UseElectionSurfaceArgs = {
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  cycle: string;
  /** The place id. `undefined` while a route param resolves — which is `loading`, not `absent`. */
  id?: string;
};

export const useElectionSurface = ({
  kind,
  level,
  cycle,
  id,
}: UseElectionSurfaceArgs): ElectionSurfaceState => {
  const location = locateSurface(kind, level, cycle, id);
  const path = location.source === "artifact" ? location.path : null;

  const query = useQuery({
    queryKey: ["election_surface", path],
    queryFn: () => fetchSurface(path!),
    // Only an `artifact` level with a resolved id has anything to fetch. Everything else is
    // answered from the policy without a request — which is also what keeps a canonical level
    // from issuing a 404 on every render.
    enabled: path !== null,
  });

  if (path === null) {
    switch (location.source) {
      case "canonical":
        return { status: "canonical" };
      case "embedded":
        return { status: "embedded" };
      case "none":
        return { status: "none" };
      // `pending` means the level emits and the id has not arrived — a skeleton, never a
      // fallback. Falling back here renders the legacy body and never re-renders when the id
      // lands, because the fallback is not a suspended state.
      case "pending":
        return { status: "loading" };
    }
  }
  if (query.isPending) return { status: "loading" };
  // A rejected query is a network failure; the documented fallback covers it.
  return query.data ?? { status: "absent" };
};
