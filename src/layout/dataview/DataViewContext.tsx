import {
  createContext,
  FC,
  PropsWithChildren,
  useContext,
  useState,
} from "react";

// eslint-disable-next-line react-refresh/only-export-components
export const dataViews = ["map", "table"] as const;
export type DataViewType = (typeof dataViews)[number];
type DataViewContextType = {
  view: DataViewType;
  setView: (value: DataViewType) => void;
};

const DataViewContext = createContext<DataViewContextType>({
  view: "map",
  setView: () => {},
});

export const DataViewContextProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const [view, setViewInternal] = useState<DataViewType>(
    (localStorage.getItem("view") as DataViewType) || "map",
  );
  const setView = (newView: DataViewType) => {
    setViewInternal(newView);
    localStorage.setItem("view", newView);
  };
  return (
    <DataViewContext.Provider
      value={{
        view,
        setView,
      }}
    >
      {children}
    </DataViewContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useDataViewContext = () => {
  return useContext(DataViewContext);
};
