import { useContext } from "react";
import { themeDark, themeLight } from "@/theme/utils";
import { ThemeContext } from "@/theme/ThemeContext";

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  return (
    <div className="navbar bg-base-200 border-b-base-300 border-b-2">
      <div className="flex-1">
        <a href="/" className="flex flex-row items-center">
          <span className="sr-only">Data Bulgaria Statistics</span>
          <div className="font-title text-primary hidden md:inline-flex text-2xl transition-all duration-200 pl-2">
            <div className="lowercase">data</div>
            <div className="text-base-content font-semibold uppercase">
              Bulgaria
            </div>
          </div>
        </a>
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
              className="rounded-lg text-sm p-2"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M12 2A10 10 0 0 0 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2M12 4A8 8 0 0 1 20 12A8 8 0 0 1 12 20V4Z"
                />
              </svg>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
};
