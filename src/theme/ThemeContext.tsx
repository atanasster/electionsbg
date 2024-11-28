/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useMemo, useState } from "react";
import { useCustomEffect } from "./useCustomEffect";
import { getTheme } from "./utils";

export interface ThemeContextProps {
  theme: string;
  setTheme: (theme: string) => void;
}

export const ThemeContext = createContext<ThemeContextProps>({
  theme: "default",
  setTheme: () => {},
});

/**
 * Theme Context Provider.
 *
 * @param value string
 * @param children ReactNode
 * @returns ReactNode
 */
export const ThemeContextProvider = ({
  value = "default",
  children,
}: {
  value?: string;
  children: React.ReactNode;
}) => {
  const [theme, setTheme] = useState(value);

  useCustomEffect(() => {
    const storeTheme = getTheme();
    applyTheme(storeTheme || theme);
  }, []);

  /**
   * Apply theme to 'html' tag on DOM.
   */
  const applyTheme = (theme: string) => {
    localStorage.setItem("theme", theme);
    document.getElementsByTagName("html")[0].setAttribute("data-theme", theme);
    if (theme === "sunset") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setTheme(theme);
  };

  const handleThemeChange = (theme: string) => {
    setTheme(theme);
    applyTheme(theme);
  };

  /**
   * Current context value for theme.
   */
  const val = useMemo(
    () => ({
      theme,
      setTheme: handleThemeChange,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );
  return <ThemeContext.Provider value={val}>{children}</ThemeContext.Provider>;
};
