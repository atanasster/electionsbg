// Public chat lifecycle: deterministic answers or one hosted assistant.
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL_ID, modelById } from "./models";
import { OpenRouterProvider } from "./openrouter";
import { jevAiTurnPlan } from "./jevAiLane";
import { HeuristicProvider, type LLMProvider } from "./provider";

export type LoadState = { phase: "idle" | "ready" | "error"; note: string };
export type ModelEngine = {
  provider: LLMProvider;
  providerId: string;
  load: LoadState;
  select: (id: string) => Promise<void>;
};
const SAVED_KEY = "naiasno.model.v1";

/**
 * Jev picks the tool, the model fills its parameters (`jevRoutingStep`).
 *
 * ON by default since 2026-09-18, once the proxy's `systemone` action
 * (functions/llm_http.js) was deployed and a live turn routed through it. It
 * was OFF by default until then, and the default lives HERE rather than in
 * `.env.production` on purpose: that file is gitignored, so a switch kept there
 * exists only on the machine that set it, and a deploy from anywhere else would
 * quietly ship the lane off.
 *
 * Turning it off does not change what a reader can get, only how: with Jev
 * unavailable every turn already falls back to the full Gemini prompt. Two
 * switches, for the two scopes:
 *   localStorage["naiasno:jev-routing"] = "0"   one browser
 *   VITE_JEV_ROUTING=0 at build time            everyone
 * Anything else, including a missing or unreadable value, leaves it on.
 */
export const jevRoutingEnabled = (): boolean => {
  if (import.meta.env?.VITE_JEV_ROUTING === "0") return false;
  try {
    return localStorage.getItem("naiasno:jev-routing") !== "0";
  } catch {
    return true;
  }
};
export const useModelEngine = (): ModelEngine => {
  const heuristic = useMemo(() => new HeuristicProvider(), []);
  const [provider, setProvider] = useState<LLMProvider>(heuristic);
  const [providerId, setProviderId] = useState("rules");
  const select = useCallback(
    async (id: string) => {
      const model = modelById(
        id === "google/gemini-3.1-flash-lite" ? DEFAULT_MODEL_ID : id,
      );
      const next =
        model?.ready && model.runtime === "cloud" ? model.id : "rules";
      setProvider(
        model && next !== "rules"
          ? new OpenRouterProvider(
              model,
              undefined,
              jevRoutingEnabled() ? jevAiTurnPlan() : undefined,
            )
          : heuristic,
      );
      setProviderId(next);
      try {
        localStorage.setItem(SAVED_KEY, next);
      } catch {
        /* storage optional */
      }
    },
    [heuristic],
  );
  useEffect(() => {
    try {
      void select(localStorage.getItem(SAVED_KEY) || "rules");
    } catch {
      /* storage optional */
    }
  }, [select]);
  return { provider, providerId, load: { phase: "ready", note: "" }, select };
};
