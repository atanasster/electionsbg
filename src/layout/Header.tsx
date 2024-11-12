import { useContext } from "react";
import { Bars3Icon, SunIcon, MoonIcon } from "@heroicons/react/24/solid";

import { themeDark, themeLight } from "@/theme/utils";
import { ThemeContext } from "@/theme/ThemeContext";

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  return (
    <nav className="navbar bg-base-200 border-b-base-500 border-b-2">
      <div className="w-full flex flex-wrap items-center justify-between mx-auto p-4">
        <a href="/" className="flex flex-row items-center">
          <span className="sr-only">Elections in Bulgaria Statistics</span>
          <div className="font-title text-primary hidden md:inline-flex text-2xl transition-all duration-200 pl-2">
            <div className="lowercase">elections</div>
            <div className="text-base-content font-semibold uppercase">
              Bulgaria
            </div>
          </div>
        </a>
        <div className="hidden w-full md:block md:w-auto" id="navbar-default">
          <ul className="font-medium flex flex-col p-4 md:p-0 mt-4 border md:flex-row md:space-x-8 rtl:space-x-reverse md:mt-0 md:border-0 ">
            <li>
              <a
                href="/"
                className="block py-2 px-3 rounded md:bg-transparent md:p-0 dark:text-white"
                aria-label="Go to home page"
              >
                Home
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="flex-none">
        <ul className="menu menu-horizontal px-1 items-center">
          <li>
            <button
              onClick={() =>
                setTheme(theme === themeDark ? themeLight : themeDark)
              }
              id="theme-toggle"
              type="button"
              aria-label="switch theme dark mode"
              className="inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
            >
              {theme === themeDark ? <SunIcon /> : <MoonIcon />}
            </button>
          </li>
          <li>
            <button
              data-collapse-toggle="navbar-default"
              type="button"
              className="inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
              aria-controls="navbar-default"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              <Bars3Icon />
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
};
