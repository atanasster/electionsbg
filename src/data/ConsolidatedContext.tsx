import { FC, ReactNode, useCallback, useState } from "react";
import { ConsolidatedContext } from "./useConsolidated";

const STORAGE_KEY = "consolidated_history";

export const ConsolidatedProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isConsolidated, setState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  });
  const setIsConsolidated = useCallback((value: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
    }
    setState(value);
  }, []);
  return (
    <ConsolidatedContext.Provider value={{ isConsolidated, setIsConsolidated }}>
      {children}
    </ConsolidatedContext.Provider>
  );
};
