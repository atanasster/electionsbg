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
 * OFF by default, and deliberately: it needs the proxy's `systemone` action
 * (functions/llm_http.js) deployed. Without it every AI turn would wait out
 * Jev's client timeout until the circuit breaker opened — no wrong answers
 * (an unanswered Jev call gets the full Gemini prompt), only slower ones.
 *
 * Two switches, for the two stages of a rollout:
 *   localStorage["naiasno:jev-routing"] = "1"   one browser, for testing
 *   VITE_JEV_ROUTING=1 at build time            everyone
 */
export const jevRoutingEnabled = (): boolean => {
  if (import.meta.env?.VITE_JEV_ROUTING === "1") return true;
  try {
    return localStorage.getItem("naiasno:jev-routing") === "1";
  } catch {
    return false;
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
