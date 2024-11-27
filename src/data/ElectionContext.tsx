/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  FC,
  PropsWithChildren,
  useContext,
  useState,
} from "react";
import elections from "../elections.json";

export interface ElectionContextProps {
  selected: string;
  elections: string[];
  setSelected: (newSelected: string) => void;
}

export const ElectionContext = createContext<ElectionContextProps>({
  selected: "",
  elections: [],
  setSelected: () => {},
});

export const ElectionContextProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const [selected, setSelected] = useState(elections[0]);
  return (
    <ElectionContext.Provider
      value={{
        elections,
        selected,
        setSelected,
      }}
    >
      {children}
    </ElectionContext.Provider>
  );
};

export const useElectionContext = () => {
  const context = useContext(ElectionContext);
  return context;
};
