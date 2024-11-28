/* eslint-disable react-refresh/only-export-components */
import { FC, PropsWithChildren, createContext, useState } from "react";

export const LoadingContext = createContext<{
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
}>({ isLoading: false, setIsLoading: () => {} });

export const LoadingContextProvider: FC<PropsWithChildren> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(false);
  return (
    <LoadingContext.Provider value={{ isLoading, setIsLoading }}>
      {children}
    </LoadingContext.Provider>
  );
};
