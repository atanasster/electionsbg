// Public chat lifecycle: deterministic answers or one hosted assistant.
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL_ID, modelById } from "./models";
import { OpenRouterProvider } from "./openrouter";
import { HeuristicProvider, type LLMProvider } from "./provider";

export type LoadState = { phase: "idle" | "ready" | "error"; note: string };
export type ModelEngine = {
  provider: LLMProvider;
  providerId: string;
  load: LoadState;
  select: (id: string) => Promise<void>;
};
const SAVED_KEY = "naiasno.model.v1";
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
        model && next !== "rules" ? new OpenRouterProvider(model) : heuristic,
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
