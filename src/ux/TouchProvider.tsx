import {
  useContext,
  createContext,
  PropsWithChildren,
  useState,
  useEffect,
} from "react";

const TouchContext = createContext<boolean | undefined>(undefined);
// eslint-disable-next-line react-refresh/only-export-components
export const useTouch = () => useContext(TouchContext);

export const TouchProvider = (props: PropsWithChildren) => {
  const [isTouch, setTouch] = useState<boolean>();

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  return <TouchContext.Provider value={isTouch} {...props} />;
};
