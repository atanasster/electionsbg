// Catalogue + cycle-relation hooks for local elections.
//
// `useLocalElectionList()` returns the full catalogue from
// src/data/json/local_elections.json (regular cycles only — partials are
// surfaced contextually per the design decision).
//
// `usePriorLocalCycle(slug)` returns the cycle that immediately preceded
// the given slug, or undefined if the given slug is already the oldest.
// Used by the município tile to render a "Преди това: X" line.

import { useMemo } from "react";
import allLocalElections from "../json/local_elections.json";
import { LocalElectionEntry } from "../ElectionContext";

export const useLocalElectionList = (): LocalElectionEntry[] =>
  allLocalElections as LocalElectionEntry[];

export const usePriorLocalCycle = (cycle?: string): string | undefined => {
  const list = useLocalElectionList();
  return useMemo(() => {
    if (!cycle) return undefined;
    // Sort newest-first; the "prior" entry is the one after the current.
    const sorted = list
      .slice()
      .sort((a, b) => b.round1Date.localeCompare(a.round1Date));
    const idx = sorted.findIndex((e) => e.name === cycle);
    if (idx < 0 || idx >= sorted.length - 1) return undefined;
    return sorted[idx + 1].name;
  }, [list, cycle]);
};
