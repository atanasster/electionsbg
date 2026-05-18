import { createContext, useContext } from "react";

export type ConsolidatedCtx = {
  isConsolidated: boolean;
  setIsConsolidated: (value: boolean) => void;
};

export const ConsolidatedContext = createContext<ConsolidatedCtx | null>(null);

export const useConsolidated = (): ConsolidatedCtx => {
  const ctx = useContext(ConsolidatedContext);
  if (!ctx) {
    throw new Error(
      "useConsolidated must be used inside <ConsolidatedProvider>",
    );
  }
  return ctx;
};
