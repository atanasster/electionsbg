import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

type Ctx = {
  isConsolidated: boolean;
  setIsConsolidated: (value: boolean) => void;
};

const STORAGE_KEY = "consolidated_history";

const ConsolidatedContext = createContext<Ctx | null>(null);

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

export const useConsolidated = (): Ctx => {
  const ctx = useContext(ConsolidatedContext);
  if (!ctx) {
    throw new Error(
      "useConsolidated must be used inside <ConsolidatedProvider>",
    );
  }
  return ctx;
};
