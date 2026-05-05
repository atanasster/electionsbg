import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { electionToNsFolder } from "@/data/parliament/nsFolders";

/** Shape of the filter state lifted above the Connections page tabs. Backed
 * entirely by URL search params so any state is shareable and back-button
 * friendly. */
export type ConnectionsFilters = {
  /** Selected NS folder ("52", "51", ...) or `null` for "All parliaments". */
  ns: string | null;
  /** Cross-party only — shows pairs where the two MPs have different
   * partyGroupShort values. */
  crossParty: boolean;
  /** Drop pairs whose canonical path includes any historical edges. */
  currentOnly: boolean;
  /** Drop pairs whose canonical path uses any name-match (medium-confidence)
   * edges. */
  highConfidenceOnly: boolean;
  /** When set, restricts results to pairs where one endpoint is in
   * `partyPair[0]` and the other in `partyPair[1]`. Used by the heatmap
   * cell click → drilldown flow. Order is canonical (sorted) but applied
   * symmetrically when filtering. */
  partyPair: [string, string] | null;
};

const PARAM_NS = "ns";
const PARAM_CROSS = "crossParty";
const PARAM_CURRENT = "currentOnly";
const PARAM_HIGH_CONF = "highConfOnly";
const PARAM_PARTY_PAIR = "partyPair";

type Setters = {
  setNs: (ns: string | null) => void;
  setCrossParty: (v: boolean) => void;
  setCurrentOnly: (v: boolean) => void;
  setHighConfidenceOnly: (v: boolean) => void;
  setPartyPair: (pair: [string, string] | null) => void;
  resetAll: () => void;
};

export const useConnectionsFilters = (
  selectedElection: string,
): { filters: ConnectionsFilters } & Setters => {
  const [params, setParams] = useSearchParams();

  // Default scope follows the global election selector. A user-set `ns=all`
  // explicitly opts out and stays opted out even when the global selector
  // changes — that's the contract from our earlier design call.
  const selectedNsFolder = useMemo(
    () => electionToNsFolder(selectedElection),
    [selectedElection],
  );

  const filters = useMemo<ConnectionsFilters>(() => {
    const nsRaw = params.get(PARAM_NS);
    const ns = nsRaw === "all" ? null : (nsRaw ?? selectedNsFolder ?? null);
    const partyPairRaw = params.get(PARAM_PARTY_PAIR);
    let partyPair: [string, string] | null = null;
    if (partyPairRaw && partyPairRaw.includes("|")) {
      const [a, b] = partyPairRaw.split("|");
      if (a && b) partyPair = [a, b];
    }
    return {
      ns,
      crossParty: params.get(PARAM_CROSS) === "1",
      currentOnly: params.get(PARAM_CURRENT) === "1",
      highConfidenceOnly: params.get(PARAM_HIGH_CONF) === "1",
      partyPair,
    };
  }, [params, selectedNsFolder]);

  const update = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      mutator(next);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setNs = useCallback(
    (ns: string | null) => {
      update((p) => {
        if (ns === null) p.set(PARAM_NS, "all");
        else if (ns === selectedNsFolder) p.delete(PARAM_NS);
        else p.set(PARAM_NS, ns);
      });
    },
    [update, selectedNsFolder],
  );

  const setBoolParam = useCallback(
    (key: string) => (v: boolean) => {
      update((p) => {
        if (v) p.set(key, "1");
        else p.delete(key);
      });
    },
    [update],
  );

  const setPartyPair = useCallback(
    (pair: [string, string] | null) => {
      update((p) => {
        if (!pair) {
          p.delete(PARAM_PARTY_PAIR);
        } else {
          const [a, b] = pair;
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          p.set(PARAM_PARTY_PAIR, `${lo}|${hi}`);
        }
        // Drilldown source is the heatmap on the Strongest Ties tab — make
        // sure we land there so the filtered list is visible.
        p.delete("tab");
      });
    },
    [update],
  );

  const resetAll = useCallback(() => {
    update((p) => {
      p.delete(PARAM_NS);
      p.delete(PARAM_CROSS);
      p.delete(PARAM_CURRENT);
      p.delete(PARAM_HIGH_CONF);
      p.delete(PARAM_PARTY_PAIR);
    });
  }, [update]);

  return {
    filters,
    setNs,
    setCrossParty: setBoolParam(PARAM_CROSS),
    setCurrentOnly: setBoolParam(PARAM_CURRENT),
    setHighConfidenceOnly: setBoolParam(PARAM_HIGH_CONF),
    setPartyPair,
    resetAll,
  };
};
