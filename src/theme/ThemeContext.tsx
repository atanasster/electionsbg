/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useMemo, useState } from "react";
import { useCustomEffect } from "./useCustomEffect";
import { getStoredTheme, getSystemTheme, themeDark } from "./utils";

export interface ThemeContextProps {
  theme: string;
  setTheme: (theme: string) => void;
}

export const ThemeContext = createContext<ThemeContextProps>({
  theme: "default",
  setTheme: () => {},
});

const applyThemeToDom = (theme: string) => {
  document.getElementsByTagName("html")[0].setAttribute("data-theme", theme);
  if (theme === themeDark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
};

/**
 * Theme Context Provider.
 *
 * @param value string
 * @param children ReactNode
 * @returns ReactNode
 */
export const ThemeContextProvider = ({
  value,
  children,
}: {
  value?: string;
  children: React.ReactNode;
}) => {
  const [theme, setTheme] = useState(value ?? getSystemTheme());

  useCustomEffect(() => {
    const stored = getStoredTheme();
    const next = stored ?? getSystemTheme();
    applyThemeToDom(next);
    setTheme(next);

    // While the user hasn't explicitly picked a theme, follow OS changes live.
    if (!stored && typeof window.matchMedia === "function") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (getStoredTheme()) return;
        const sys = getSystemTheme();
        applyThemeToDom(sys);
        setTheme(sys);
      };
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
  }, []);

  const handleThemeChange = (next: string) => {
    localStorage.setItem("theme", next);
    applyThemeToDom(next);
    setTheme(next);
  };

  /**
   * Current context value for theme.
   */
  const val = useMemo(
    () => ({
      theme,
      setTheme: handleThemeChange,
    }),

    [theme],
  );
  return <ThemeContext.Provider value={val}>{children}</ThemeContext.Provider>;
};
