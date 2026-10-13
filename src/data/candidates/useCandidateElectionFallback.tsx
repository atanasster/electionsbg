import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import type { ParsedSlug } from "./candidateSlug";
import {
  useResolvedCandidate,
  type ResolveResult,
} from "./useResolvedCandidate";

/** The file whose existence in an election's tree proves the candidate URL
 * resolves there. Slug URLs (`mp-<id>`, `c-<partyNum>-<slug>`) are minted per
 * election and have their own by-slug shard — the exact file
 * `useResolvedCandidate` fetches — so probe that. A bare name has no shard of
 * its own; its name folder's regions.json is the cheapest proof of a candidacy. */
export const probePath = (election: string, parsed: ParsedSlug): string => {
  switch (parsed.kind) {
    case "mp":
      return `/${election}/candidates/by-slug/mp-${parsed.mpId}.json`;
    case "cik":
      return `/${election}/candidates/by-slug/c-${parsed.partyNum}-${parsed.nameSlug}.json`;
    default:
      return `/${election}/candidates/${parsed.name}/regions.json`;
  }
};

const probeKey = (parsed: ParsedSlug): string =>
  parsed.kind === "mp"
    ? `mp:${parsed.mpId}`
    : parsed.kind === "cik"
      ? `cik:${parsed.partyNum}:${parsed.nameSlug}`
      : `name:${parsed.name}`;

// Probe one election. A 200 with a JSON body means the candidate exists in
// that cycle; anything else means they don't.
const probeElection = async (
  election: string,
  parsed: ParsedSlug,
): Promise<boolean> => {
  const res = await fetch(dataUrl(probePath(election, parsed)));
  // A server fault is not an answer: throw so the caller can tell "no
  // election holds it" from "we could not ask". 4xx stays a miss.
  if (res.status >= 500) throw new Error(`probe failed: ${res.status}`);
  // Dev's data middleware and Firebase Hosting both fall through to
  // index.html (HTTP 200) for missing files, so `res.ok` alone would count
  // every election as a hit — confirm the body is actually JSON.
  if (!res.ok) return false;
  return (res.headers.get("content-type") ?? "").includes("json");
};

/** A /candidate/:id URL resolves against whatever election is currently
 * selected, and a URL with no `?elections=` selects the latest. Slug URLs are
 * minted in ONE election (`c-28-…` is party 28 of that ballot), and a bare
 * name may belong to someone who ran only in an earlier cycle — either way the
 * selected election matches no one and the page renders blank (the common
 * case for search-engine results and old shared links).
 *
 * This probes every other election for the candidate and reports the most
 * recent one that has them; the caller switches the election context so the
 * page populates.
 *
 * `enabled` gates the whole thing — keep it false unless the candidate is
 * genuinely missing from the selected election, so candidates that already
 * resolve never fire a dozen extra requests. */
export const useCandidateElectionFallback = (
  parsed: ParsedSlug | null | undefined,
  enabled: boolean,
): {
  isProbing: boolean;
  fallbackElection: string | null;
  /** At least one probe failed (network / 5xx), so "no election holds it"
   * cannot be concluded. */
  hasError: boolean;
} => {
  const { elections, selected } = useElectionContext();

  // elections[] is newest-first. Skip the selected election — the caller only
  // turns this on after confirming the candidate is missing from it.
  const probeTargets = elections.filter((e) => e !== selected);
  const active = enabled && !!parsed;

  const results = useQueries({
    queries: probeTargets.map((election) => ({
      queryKey: [
        "candidate_election_probe",
        election,
        parsed ? probeKey(parsed) : "none",
      ] as const,
      queryFn: () => probeElection(election, parsed as ParsedSlug),
      enabled: active,
      staleTime: Infinity,
    })),
  });

  if (!active) {
    return { isProbing: false, fallbackElection: null, hasError: false };
  }
  const isProbing = results.some((r) => r.isLoading);
  // probeTargets is newest-first, so the first hit is the most recent cycle.
  const hitIdx = results.findIndex((r) => r.data === true);
  return {
    isProbing,
    fallbackElection: hitIdx >= 0 ? probeTargets[hitIdx] : null,
    hasError: results.some((r) => r.isError),
  };
};

export type CandidateRouteResolution = ResolveResult & {
  /** Resolving, or probing other elections / switching to the hit. Render a
   * placeholder — never the empty body. */
  isResolving: boolean;
  /** A slug URL (`mp-`/`c-`) that resolves in NO election. Bare names never
   * set this: their pages still render whatever name-keyed history exists. */
  notFound: boolean;
  /** A fetch failed before an answer was reached. Never read this as
   * not-found — the candidate may well exist. */
  isError: boolean;
};

/** `useResolvedCandidate` plus the cross-election fallback, for every
 * /candidate/:id screen. When the selected election does not hold the
 * candidate it probes the others and switches the election context to the
 * newest hit; when none holds a slug URL it reports `notFound` so the screen
 * can say so instead of rendering a blank page. */
export const useResolvedCandidateWithFallback = (
  idParam: string | undefined | null,
): CandidateRouteResolution => {
  const resolved = useResolvedCandidate(idParam);
  const { selected, setSelected } = useElectionContext();
  // Switch at most once per id: if the switched-to election still matches no
  // one (a stale shard), report not-found rather than bouncing around.
  const [switchedFor, setSwitchedFor] = useState<string | null>(null);
  const switched = !!idParam && switchedFor === idParam;

  // A failed shard fetch says nothing about whether the selected election
  // holds the candidate, so it must not trigger a switch to another one.
  const needsFallback =
    !resolved.isLoading &&
    !resolved.isError &&
    resolved.matches.length === 0 &&
    !!resolved.parsed &&
    !switched;
  const { isProbing, fallbackElection, hasError } =
    useCandidateElectionFallback(resolved.parsed, needsFallback);
  useEffect(() => {
    if (fallbackElection && fallbackElection !== selected && idParam) {
      setSwitchedFor(idParam);
      setSelected(fallbackElection);
    }
  }, [fallbackElection, selected, setSelected, idParam]);

  const isResolving =
    resolved.isLoading || (needsFallback && (isProbing || !!fallbackElection));
  const isError =
    resolved.isError ||
    (needsFallback && !isResolving && !fallbackElection && hasError);
  const notFound =
    !isResolving &&
    !isError &&
    resolved.matches.length === 0 &&
    (resolved.parsed?.kind === "mp" || resolved.parsed?.kind === "cik");
  return { ...resolved, isResolving, notFound, isError };
};
