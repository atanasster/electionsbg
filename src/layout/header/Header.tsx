import { FC, useContext } from "react";
import { Moon, SunMedium, Menu, Check } from "lucide-react";

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
import { Logo } from "./Logo";
import { useElectionContext } from "@/data/ElectionContext";
import { useArticles } from "@/data/articles/useArticles";

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();
  const { electionStats, selected } = useElectionContext();
  const { data: articles } = useArticles();
  const articleForSelectedElection = articles?.find(
    (a) => a.election === selected,
  );
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
    if (item.category === "article_for_election") {
      // Hide unless this election has an article — and link straight to it.
      if (!articleForSelectedElection) return null;
      return (
        <DropdownMenuItem>
          <Link to={`/articles/${articleForSelectedElection.slug}`}>
            {t(item.title)}
          </Link>
        </DropdownMenuItem>
      );
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
          <Logo className="size-7" />
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
        <Link
          to="/compare"
          underline={false}
          className="text-sm font-medium hidden lg:block lowercase whitespace-nowrap text-secondary-foreground hover:text-primary"
        >
          {t("compare_title")}
        </Link>
        <Link
          to="/connections"
          underline={false}
          className="text-sm font-medium hidden lg:block lowercase whitespace-nowrap text-secondary-foreground hover:text-primary"
        >
          {t("connections_link_label")}
        </Link>
        {reportsMenu.map((topMenu, idx) => (
          <DropdownMenu key={`${topMenu.title}=${idx}`}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="font-medium hidden md:block lowercase text-secondary-foreground"
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
          className="text-sm font-medium hidden md:block text-secondary-foreground"
          aria-label={`${t("change_language_to")} ${t("changeLanguageTo")}`}
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
          className="hidden md:block items-center p-2 w-10 h-10 justify-center rounded-lg text-muted-foreground hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {theme === themeDark ? (
            <SunMedium className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-collapse-toggle="navbar-default"
              type="button"
              className="inline-flex items-center justify-center rounded-lg lg:hidden text-muted-foreground hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
              aria-controls="navbar-default"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              <Menu />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuItem>
              <Link to="/simulator">{t("coalition_simulator")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link to="/compare">{t("compare_title")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link to="/connections">{t("connections_link_label")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link to="/mp/companies">{t("all_companies")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link to="/timeline">{t("timeline_title")}</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
