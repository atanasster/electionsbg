// Public scenario tally for /budget/simulator ("what the public chose") —
// the client side of the `scenarios` cloud function (functions/index.js).
// Reached same-origin via the /api/scenarios hosting rewrite in prod and the
// Vite dev proxy locally. The stats query failing (offline, function not
// deployed) simply hides the card — the simulator never depends on it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface PublicLeverStat {
  key: string;
  count: number;
  medianValue: number | null;
}

export interface PublicScenarioStats {
  total: number;
  pctEdpMet?: number;
  pctDebtMet?: number;
  pctDefMet?: number;
  topLevers?: PublicLeverStat[];
  medianHeadlineEur?: number | null;
}

export interface ScenarioSubmission {
  /** The simulator's canonical query string, policy levers only (the caller
   *  strips mode/goal/gross). */
  qs: string;
  metrics: {
    headlineEur: number;
    balancePctGdp: number;
    debtPct2030: number;
    edpMet: boolean;
    debtMet: boolean;
    defMet: boolean;
  };
  lang: "bg" | "en";
  mode: "dynamic" | "static";
}

const STATS_URL = "/api/scenarios/stats";
const SUBMIT_URL = "/api/scenarios/submit";

// In the Vite dev server the /api/scenarios proxy targets PRODUCTION
// (vite.config.ts), and the function allowlists localhost — so a developer's
// "submit" would write the real public tally and skew the median every
// visitor sees. Block submits in dev unless explicitly opted in. Reads
// (stats) stay live so the card still works locally.
const env = import.meta.env as Record<string, string | boolean | undefined>;
export const devSubmitBlocked = (): boolean =>
  env.DEV === true && env.VITE_SCENARIOS_ALLOW_DEV_SUBMIT !== "1";

export const usePublicScenarioStats = () =>
  useQuery({
    queryKey: ["budget", "public-scenarios"] as const,
    queryFn: async (): Promise<PublicScenarioStats> => {
      const res = await fetch(STATS_URL);
      if (!res.ok) throw new Error(`stats ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

export const useSubmitScenario = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (submission: ScenarioSubmission): Promise<void> => {
      if (devSubmitBlocked()) {
        console.warn(
          "[scenarios] dev submit blocked — the /api proxy targets production. Set VITE_SCENARIOS_ALLOW_DEV_SUBMIT=1 to override.",
        );
        throw new Error("dev submit blocked");
      }
      const res = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
      if (!res.ok) throw new Error(`submit ${res.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["budget", "public-scenarios"],
      });
    },
  });
};

// One-submission-per-scenario guard, per browser. A tiny non-crypto hash is
// enough — this is UX dedup; the server has its own per-IP duplicate check.
const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

const markerKey = (qs: string): string => `policy_sim_submitted_${fnv1a(qs)}`;

export const wasScenarioSubmitted = (qs: string): boolean => {
  try {
    return localStorage.getItem(markerKey(qs)) != null;
  } catch {
    return false;
  }
};

export const markScenarioSubmitted = (qs: string): void => {
  try {
    localStorage.setItem(markerKey(qs), "1");
  } catch {
    // private mode etc. — the server-side dedup still applies
  }
};
