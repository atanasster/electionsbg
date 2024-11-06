import React, { createContext, useState } from "react";

export interface RegionContextProps {
  code?: string;
  setCode: (code?: string) => void;
}

export const RegionContext = createContext<RegionContextProps>({
  setCode: () => {},
});

/**
 * Region Context Provider.
 *
 * @param value string
 * @param children ReactNode
 * @returns ReactNode
 */
export const RegionContextProvider = ({
  value,
  children,
}: {
  value?: string;
  children: React.ReactNode;
}) => {
  const [code, setCode] = useState(value);

  return (
    <RegionContext.Provider
      value={{
        code,
        setCode: (newCode?: string) => {
          setCode(newCode);
        },
      }}
    >
      {children}
    </RegionContext.Provider>
  );
};
