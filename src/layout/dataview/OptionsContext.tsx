/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState } from "react";

export interface OptionsContextProps {
  withNames: boolean;
  setWithNames: (value: boolean) => void;
  withShiftArrows: boolean;
  setWithShiftArrows: (value: boolean) => void;
}

export const OptionsContext = createContext<OptionsContextProps>({
  withNames: false,
  setWithNames: () => {},
  withShiftArrows: false,
  setWithShiftArrows: () => {},
});

export const OptionsContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [withNames, setWithNamesState] = useState(
    localStorage.getItem("map_with_names") === "true",
  );
  const setWithNames = (value: boolean) => {
    localStorage.setItem("map_with_names", value ? "true" : "false");
    setWithNamesState(value);
  };
  const [withShiftArrows, setWithShiftArrowsState] = useState(
    localStorage.getItem("map_with_shift_arrows") === "true",
  );
  const setWithShiftArrows = (value: boolean) => {
    localStorage.setItem("map_with_shift_arrows", value ? "true" : "false");
    setWithShiftArrowsState(value);
  };
  return (
    <OptionsContext.Provider
      value={{
        withNames,
        setWithNames,
        withShiftArrows,
        setWithShiftArrows,
      }}
    >
      {children}
    </OptionsContext.Provider>
  );
};

export const useOptions = () => {
  const context = useContext(OptionsContext);
  return context;
};
