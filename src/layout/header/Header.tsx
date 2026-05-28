import { FC, useContext, useLayoutEffect, useRef } from "react";
import { Moon, SunMedium, Menu, Check, ChevronDown } from "lucide-react";
import { useLocation } from "react-router-dom";

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
import { cn } from "@/lib/utils";
import { Link } from "@/ux/Link";
import { MenuItem, electionsMenu, governanceMenu } from "./reportMenus";
import { Search } from "../search/Search";
import { ElectionsSelect } from "./ElectionsSelect";
import { Logo } from "./Logo";
import { CabinetAnchorPill } from "./CabinetAnchorPill";
import { AreaSniperButton } from "./AreaSniperButton";
import { AreaPill } from "./AreaPill";
import { useElectionContext } from "@/data/ElectionContext";
import { useArticles } from "@/data/articles/useArticles";

// Pathname prefixes that mark a page as "in" the Governance world for the
// active-dropdown underline. Everything else is treated as elections —
// including /reports/* and /risk-score, which are election-cycle anomaly
// analyses folded into the Elections dropdown.
const GOVERNANCE_PREFIXES = [
  "/governance",
  "/parliament",
  "/votes",
  "/budget",
  "/procurement",
  "/connections",
  "/mp",
  "/mp-",
  "/company",
  "/awarder",
  "/governments",
  "/indicators",
  "/demographics",
  "/observations",
];

const isInSection = (pathname: string, prefixes: string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();
  const { electionStats, selected } = useElectionContext();
  const { data: articles } = useArticles();
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const inGovernance = isInSection(location.pathname, GOVERNANCE_PREFIXES);
  const inElections = !inGovernance;

  // The nav is `position: fixed`, so the page content is offset by its
  // height via the `--header-height` CSS variable (see Layout.tsx). On
  // very narrow viewports (~<340px) the inner left group wraps to a
  // second line, growing the nav beyond its single-row height — measuring
  // here keeps the offset in sync regardless of wrap, font load, or i18n.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--header-height", `${nav.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--header-height");
    };
  }, []);
  // An article with no `election` field is treated as universal — it applies
  // to every cycle and shows up in the dropdown alongside any per-election piece.
  const articlesForSelectedElection =
    articles?.filter((a) => !a.election || a.election === selected) ?? [];
  const analysisHref =
    articlesForSelectedElection.length === 1
      ? `/articles/${articlesForSelectedElection[0].slug}`
      : "/articles";
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
        <DropdownMenuItem asChild>
          <Link to={item.link}>{t(item.title)}</Link>
        </DropdownMenuItem>
      );
    }
    return <DropdownMenuLabel>{t(item.title)}</DropdownMenuLabel>;
  };
  // Desktop top-level nav as a "split control": the title text links to the
  // section dashboard, a hairline divider separates it from a chevron that
  // toggles the menu of sub-pages. Each half lights up independently on hover
  // so the two targets read as distinct; the active section is tinted
  // rather than underlined.
  const RenderTopMenu: FC<{ topMenu: MenuItem; active: boolean }> = ({
    topMenu,
    active,
  }) => (
    // `modal={false}` keeps the page scrollable while the menu is open — the
    // default modal mode locks body scroll and compensates for the removed
    // scrollbar, which visibly shifts the fixed header and page content.
    <DropdownMenu modal={false}>
      <div
        className={cn(
          "hidden lg:inline-flex items-stretch overflow-hidden rounded-md border text-sm font-medium transition-colors",
          active
            ? "border-primary/50 bg-primary/[0.07]"
            : "border-border/70 hover:border-border",
        )}
      >
        <Link
          to={topMenu.link ?? "/"}
          underline={false}
          className={cn(
            "flex items-center whitespace-nowrap px-2.5 py-1 lowercase transition-colors focus:outline-none focus-visible:bg-foreground/[0.08]",
            active
              ? "text-primary hover:bg-primary/10"
              : "text-secondary-foreground hover:bg-foreground/[0.05] hover:text-primary",
          )}
        >
          {t(topMenu.title)}
        </Link>
        <span
          aria-hidden
          className={cn("w-px", active ? "bg-primary/30" : "bg-border/70")}
        />
        <DropdownMenuTrigger
          aria-label={t(topMenu.title)}
          className={cn(
            "group flex items-center px-1.5 transition-colors focus:outline-none focus-visible:bg-foreground/[0.08]",
            active
              ? "text-primary hover:bg-primary/10 data-[state=open]:bg-primary/10"
              : "text-secondary-foreground hover:bg-foreground/[0.05] hover:text-primary data-[state=open]:bg-foreground/[0.05]",
          )}
        >
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        {topMenu.subMenu?.map((menu, idx) => (
          <RenderMenuItem key={`${menu.title}-${idx}`} item={menu} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const changeLanguage = (language: "en" | "bg") => {
    i18n.changeLanguage(language);
    localStorage.setItem("language", language);
  };
  return (
    <nav
      ref={navRef}
      className="flex shadow-sm fixed w-full z-10 top-0 gap-2 bg-muted border-b-2 justify-between items-center"
    >
      <div className="flex text-xl text-primary flex-wrap items-center gap-3 p-4">
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
        <div aria-hidden className="hidden sm:block h-6 w-px bg-border/70" />
        <ElectionsSelect />
        <CabinetAnchorPill />
        <AreaPill />
      </div>
      <div className="flex flex-1 justify-end gap-3 items-center px-4 min-w-0">
        <AreaSniperButton />
        <Search />
        {electionsMenu.map((topMenu, idx) => (
          <RenderTopMenu
            key={`elec-${topMenu.title}-${idx}`}
            topMenu={topMenu}
            active={inElections}
          />
        ))}
        {governanceMenu.map((topMenu, idx) => (
          <RenderTopMenu
            key={`gov-${topMenu.title}-${idx}`}
            topMenu={topMenu}
            active={inGovernance}
          />
        ))}
        {articles && articles.length > 0 && (
          <Link
            to={analysisHref}
            underline={false}
            className="text-sm font-medium hidden lg:block lowercase whitespace-nowrap text-secondary-foreground hover:text-primary"
          >
            {t("analysis_title")}
          </Link>
        )}

        <button
          className="text-sm font-medium hidden lg:block text-secondary-foreground"
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
          className="hidden lg:flex items-center p-2 w-10 h-10 justify-center rounded-lg text-muted-foreground hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {theme === themeDark ? (
            <SunMedium className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </button>
        <DropdownMenu modal={false}>
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
            {electionsMenu.map((main, idx) => (
              <RenderMenuItem key={`m-elec-${main.title}-${idx}`} item={main} />
            ))}
            {governanceMenu.map((main, idx) => (
              <RenderMenuItem key={`m-gov-${main.title}-${idx}`} item={main} />
            ))}
            {articles && articles.length > 0 && (
              <DropdownMenuItem asChild>
                <Link to={analysisHref}>{t("analysis_title")}</Link>
              </DropdownMenuItem>
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
