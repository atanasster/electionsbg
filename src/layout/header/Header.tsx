import { FC, useContext } from "react";
import { Moon, SunMedium, Menu, Vote, Check } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { themeDark, themeLight } from "@/theme/utils";
import { ThemeContext } from "@/theme/ThemeContext";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { Button } from "@/components/ui/button";
import { MenuItem, reportsMenu } from "./reportMenus";
import { Search } from "../search/Search";
import { ElectionsSelect } from "./ElectionsSelect";
import { useElectionContext } from "@/data/ElectionContext";

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();
  const { electionStats } = useElectionContext();
  const RenderMenuItem: FC<{ item: MenuItem }> = ({ item }) => {
    if (item.category === "financials" && !electionStats?.hasFinancials) {
      return null;
    }
    if (item.category === "recount" && !electionStats?.hasRecount) {
      return null;
    }
    if (item.category === "preferences" && !electionStats?.hasPreferences) {
      return null;
    }
    if (item.category === "suemg" && !electionStats?.hasSuemg) {
      return null;
    }
    if (item.title === "-") {
      return <DropdownMenuSeparator />;
    }
    if (item.subMenu) {
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t(item.title)}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {item.subMenu.map((sub, idx) => (
                <RenderMenuItem key={`${sub.title}-${idx}`} item={sub} />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      );
    }
    if (item.link) {
      return (
        <DropdownMenuItem>
          <Link to={item.link}>{t(item.title)}</Link>
        </DropdownMenuItem>
      );
    }
    return <DropdownMenuLabel>{t(item.title)}</DropdownMenuLabel>;
  };
  const changeLanguage = (language: "en" | "bg") => {
    i18n.changeLanguage(language);
    localStorage.setItem("language", language);
  };
  return (
    <nav className="flex shadow-sm fixed w-full z-10 top-0 gap-2 md:gap-10 bg-muted border-b-2 justify-between items-center">
      <div className=" flex text-xl text-primary flex-wrap items-center gap-4 p-4">
        <Link to="/" className="flex flex-row items-center">
          <span className="sr-only">Elections in Bulgaria data statistics</span>
          <Vote />
          <div className="hidden sm:flex font-title ext-2xl transition-all duration-200 pl-2">
            <div className="lowercase text-popover-foreground">
              {t("elections")}
            </div>
            <div className="font-semibold uppercase">{t("bg")}</div>
          </div>
        </Link>
      </div>
      <ElectionsSelect />
      <div className="flex gap-6 items-center px-4">
        <Search />
        {reportsMenu.map((topMenu, idx) => (
          <DropdownMenu key={`${topMenu.title}=${idx}`}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="font-medium hidden md:block lowercase text-secondary-foreground"
                aria-label="Open reports menu"
              >
                {t(topMenu.title)}
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent className="w-56">
              {topMenu.subMenu?.map((menu, idx) => (
                <RenderMenuItem key={`${menu.title}-${idx}`} item={menu} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}

        <button
          className="font-medium hidden md:block text-secondary-foreground"
          aria-label="Change language"
          onClick={() => {
            if (i18n.language === "bg") {
              changeLanguage("en");
            } else {
              changeLanguage("bg");
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
          className="hidden md:block items-center p-2 w-10 h-10 justify-center rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
        >
          {theme === themeDark ? <SunMedium /> : <Moon />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-collapse-toggle="navbar-default"
              type="button"
              className="inline-flex items-center justify-center rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
              aria-controls="navbar-default"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              <Menu />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            {reportsMenu.map((main) =>
              main.subMenu?.map((menu, idx) => (
                <RenderMenuItem key={`${menu.title}-${idx}`} item={menu} />
              )),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("language")}</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>
                    <button
                      className="flex justify-between w-full"
                      onClick={() => changeLanguage("en")}
                    >
                      <div className="mr-4">{t("english")}</div>
                      {i18n.language === "en" && <Check />}
                    </button>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <button
                      className="flex justify-between w-full"
                      onClick={() => changeLanguage("bg")}
                    >
                      <div className="mr-4">{t("bulgarian")}</div>
                      {i18n.language === "bg" && <Check />}
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("skin")}</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>
                    <button
                      className="flex justify-between w-full"
                      onClick={() => setTheme(themeLight)}
                    >
                      <div className="mr-4">{t("light")}</div>
                      {theme === themeLight && <Check />}
                    </button>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <button
                      className="flex justify-between w-full"
                      onClick={() => setTheme(themeDark)}
                    >
                      <div className="mr-4">{t("dark")}</div>
                      {theme === themeDark && <Check />}
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
};
