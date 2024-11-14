import { useContext } from "react";
import { Moon, SunMedium, Menu, Vote } from "lucide-react";

import { themeDark, themeLight } from "@/theme/utils";
import { ThemeContext } from "@/theme/ThemeContext";
import { useTranslation } from "react-i18next";

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();

  return (
    <div className="flex gap-6 md:gap-10 bg-muted border-b-2">
      <div className="w-full text-xl text-primary flex flex-wrap items-center justify-between mx-auto p-4">
        <a href="/" className="flex flex-row items-center">
          <span className="sr-only">Elections in Bulgaria data statistics</span>
          <Vote />
          <div className="flex font-title ext-2xl transition-all duration-200 pl-2">
            <div className="lowercase text-popover-foreground">elections</div>
            <div className="font-semibold uppercase">BG</div>
          </div>
        </a>
      </div>
      <nav className="flex gap-6 items-center px-4">
        <a
          href="/"
          className="font-medium text-muted-foreground hidden md:block"
          aria-label="Go to home page"
        >
          Home
        </a>
        <button
          className="font-medium text-muted-foreground hidden md:block"
          aria-label="Change language"
          onClick={() => {
            if (i18n.language === "bg") {
              i18n.changeLanguage("en");
            } else {
              i18n.changeLanguage("bg");
            }
          }}
        >
          {t("changeLanguageTo")}
        </button>
        <button
          onClick={() => setTheme(theme === themeDark ? themeLight : themeDark)}
          id="theme-toggle"
          type="button"
          aria-label="switch theme dark mode"
          className="inline-flex items-center p-2 w-10 h-10 justify-center rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
        >
          {theme === themeDark ? <SunMedium /> : <Moon />}
        </button>
        <button
          data-collapse-toggle="navbar-default"
          type="button"
          className="inline-flex items-center p-2 w-10 h-10 justify-center rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
          aria-controls="navbar-default"
          aria-expanded="false"
        >
          <span className="sr-only">Open main menu</span>
          <Menu />
        </button>
      </nav>
    </div>
  );
};
