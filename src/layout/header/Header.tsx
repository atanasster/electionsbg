import {
  FC,
  ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Menu,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
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
import {
  MenuItem,
  electionsMenu,
  localMenu,
  governanceMenu,
  consumptionMenu,
} from "./reportMenus";
import { Search } from "../search/Search";
import { ElectionsSelect } from "./ElectionsSelect";
import { Logo } from "./Logo";
import { CabinetAnchorPill } from "./CabinetAnchorPill";
import { AreaSniperButton } from "./AreaSniperButton";
import { AreaPill } from "./AreaPill";
import { useElectionContext } from "@/data/ElectionContext";
import { useArticles } from "@/data/articles/useArticles";

// Pathname prefixes that mark a page as "in" the Governance world for the
// active-dropdown tint. The Local set marks the parallel municipal-elections
// tree. Everything else is treated as elections — including /reports/* and
// /risk-score, which are election-cycle anomaly analyses folded into the
// Elections dropdown.
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
  "/judiciary",
  "/governments",
  "/indicators",
  "/demographics",
  "/observations",
];

const LOCAL_PREFIXES = ["/local", "/sverka"];

// The Consumption (cost-of-living) world: the new /consumption place tiers plus
// the standalone /prices explorer, which is the same КЗП basket data reframed.
const CONSUMPTION_PREFIXES = ["/consumption", "/prices"];

const isInSection = (pathname: string, prefixes: string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Sub-menus are Radix flyouts on desktop, but a flyout anchors beside its
// trigger and gets clipped by the viewport edge on phones — the hamburger
// tree expands them inline (accordion) instead. Module-level so the open
// state isn't remounted away when Header re-renders.
const MenuSub: FC<{
  label: string;
  isMobile?: boolean;
  children: ReactNode;
}> = ({ label, isMobile, children }) => {
  const [open, setOpen] = useState(false);
  if (!isMobile) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>{children}</DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    );
  }
  return (
    <>
      <DropdownMenuItem
        className={cn(
          "flex justify-between",
          open && "bg-secondary text-secondary-foreground",
        )}
        onSelect={(event) => {
          event.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <span>{label}</span>
        <ChevronRight
          className={cn(
            "transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </DropdownMenuItem>
      {open && (
        <div className="ml-2 border-l border-border/70 pl-1">{children}</div>
      )}
    </>
  );
};

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();
  const { electionStats, selected } = useElectionContext();
  const { data: articles } = useArticles();
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const inGovernance = isInSection(location.pathname, GOVERNANCE_PREFIXES);
  const inLocal = isInSection(location.pathname, LOCAL_PREFIXES);
  const inConsumption = isInSection(location.pathname, CONSUMPTION_PREFIXES);
  const inElections = !inGovernance && !inLocal && !inConsumption;

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
  const RenderMenuItem: FC<{ item: MenuItem; isMobile?: boolean }> = ({
    item,
    isMobile,
  }) => {
    // `mobileOnly` items (section "Overview" home links) appear only in the
    // hamburger tree — on desktop the split-button title already links there.
    if (item.mobileOnly && !isMobile) {
      return null;
    }
    // `devOnly` items (and their leading separator) drop out of the production
    // build, matching the dev-gated route they point at.
    if (item.devOnly && !import.meta.env.DEV) {
      return null;
    }
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
      // A `group` is a section header: flat (label + inline links) on desktop
      // so every leaf stays one open away, but a collapsible accordion on
      // mobile so an expanded section doesn't dump every leaf at once.
      // Non-group sub-menus (the reports matrix) stay nested in both layouts.
      if (item.group && !isMobile) {
        return (
          <>
            <DropdownMenuLabel>{t(item.title)}</DropdownMenuLabel>
            {item.subMenu.map((sub, idx) => (
              <RenderMenuItem key={`${sub.title}-${idx}`} item={sub} />
            ))}
          </>
        );
      }
      return (
        <MenuSub label={t(item.title)} isMobile={isMobile}>
          {item.subMenu.map((sub, idx) => (
            <RenderMenuItem
              key={`${sub.title}-${idx}`}
              item={sub}
              isMobile={isMobile}
            />
          ))}
        </MenuSub>
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
          "hidden lg:inline-flex shrink-0 items-stretch overflow-hidden rounded-md border text-sm font-medium transition-colors",
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
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={cn(
          // Cap tall panels to the space Radix leaves before collision and
          // scroll past it.
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
          // A `columns` menu lays its section groups out side by side so a
          // four-group panel (governance) is half as tall; one group per grid
          // cell keeps every leaf one open away, matching the flat layout.
          topMenu.columns === 2 ? "grid w-[30rem] grid-cols-2 gap-x-2" : "w-56",
        )}
      >
        {topMenu.columns === 2
          ? topMenu.subMenu
              ?.filter(
                (menu) => menu.group && (import.meta.env.DEV || !menu.devOnly),
              )
              .map((menu, idx) => (
                <div key={`${menu.title}-${idx}`}>
                  <DropdownMenuLabel>{t(menu.title)}</DropdownMenuLabel>
                  {menu.subMenu?.map((sub, subIdx) => (
                    <RenderMenuItem key={`${sub.title}-${subIdx}`} item={sub} />
                  ))}
                </div>
              ))
          : topMenu.subMenu?.map((menu, idx) => (
              <RenderMenuItem key={`${menu.title}-${idx}`} item={menu} />
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const changeLanguage = (language: "en" | "bg") => {
    i18n.changeLanguage(language);
    localStorage.setItem("language", language);
  };
  // The low-frequency controls (analysis link, language, theme) that used to
  // sit inline on desktop. They now live in the gear overflow on desktop and
  // the hamburger on mobile — one shared block so the two stay in sync.
  const SettingsItems: FC<{ isMobile?: boolean }> = ({ isMobile }) => (
    <>
      {articles && articles.length > 0 && (
        <>
          <DropdownMenuItem asChild>
            <Link to={analysisHref}>{t("analysis_title")}</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <MenuSub label={t("language")} isMobile={isMobile}>
        <DropdownMenuItem
          className="flex justify-between"
          onSelect={() => changeLanguage("en")}
        >
          <span className="mr-4">{t("english")}</span>
          {i18n.language === "en" && <Check />}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex justify-between"
          onSelect={() => changeLanguage("bg")}
        >
          <span className="mr-4">{t("bulgarian")}</span>
          {i18n.language === "bg" && <Check />}
        </DropdownMenuItem>
      </MenuSub>
      <MenuSub label={t("skin")} isMobile={isMobile}>
        <DropdownMenuItem
          className="flex justify-between"
          onSelect={() => setTheme(themeLight)}
        >
          <span className="mr-4">{t("light")}</span>
          {theme === themeLight && <Check />}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex justify-between"
          onSelect={() => setTheme(themeDark)}
        >
          <span className="mr-4">{t("dark")}</span>
          {theme === themeDark && <Check />}
        </DropdownMenuItem>
      </MenuSub>
    </>
  );
  return (
    <nav
      ref={navRef}
      className="flex shadow-sm fixed w-full z-10 top-0 gap-1 sm:gap-2 bg-muted border-b-2 justify-between items-center"
    >
      <div className="flex min-w-0 text-xl text-primary items-center gap-1.5 p-2 sm:gap-2 sm:px-3 sm:py-4">
        <Link to="/" className="flex shrink-0 flex-row items-center">
          <span className="sr-only">Elections in Bulgaria data statistics</span>
          <Logo className="size-7" />
          <div className="hidden sm:flex font-title ext-2xl transition-all duration-200 pl-2">
            <div className="lowercase text-popover-foreground">
              {t("elections")}
            </div>
            <div className="font-semibold uppercase">{t("bg")}</div>
          </div>
        </Link>
        <div aria-hidden className="hidden lg:block h-6 w-px bg-border/70" />
        <ElectionsSelect />
        <CabinetAnchorPill />
        <AreaPill />
      </div>
      <div className="flex shrink-0 justify-end gap-1 sm:gap-2 items-center px-2 sm:px-3">
        <AreaSniperButton />
        <Search />
        {electionsMenu.map((topMenu, idx) => (
          <RenderTopMenu
            key={`elec-${topMenu.title}-${idx}`}
            topMenu={topMenu}
            active={inElections}
          />
        ))}
        {localMenu.map((topMenu, idx) => (
          <RenderTopMenu
            key={`local-${topMenu.title}-${idx}`}
            topMenu={topMenu}
            active={inLocal}
          />
        ))}
        {governanceMenu.map((topMenu, idx) => (
          <RenderTopMenu
            key={`gov-${topMenu.title}-${idx}`}
            topMenu={topMenu}
            active={inGovernance}
          />
        ))}
        {consumptionMenu.map((topMenu, idx) => (
          <RenderTopMenu
            key={`cons-${topMenu.title}-${idx}`}
            topMenu={topMenu}
            active={inConsumption}
          />
        ))}
        {/* Desktop overflow: the analysis link + language + theme toggles,
            moved off the bar to make room for the three section menus. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("more")}
              className="hidden lg:flex items-center p-2 w-10 h-10 justify-center rounded-lg text-muted-foreground hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring data-[state=open]:bg-accent/10"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-48">
            <SettingsItems />
          </DropdownMenuContent>
        </DropdownMenu>
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
          <DropdownMenuContent
            // Inline-expanded sub-menus can run the tree tall — cap to the
            // space Radix leaves before collision and scroll past it.
            className="w-56 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
          >
            {electionsMenu.map((main, idx) => (
              <RenderMenuItem
                key={`m-elec-${main.title}-${idx}`}
                item={main}
                isMobile
              />
            ))}
            {localMenu.map((main, idx) => (
              <RenderMenuItem
                key={`m-local-${main.title}-${idx}`}
                item={main}
                isMobile
              />
            ))}
            {governanceMenu.map((main, idx) => (
              <RenderMenuItem
                key={`m-gov-${main.title}-${idx}`}
                item={main}
                isMobile
              />
            ))}
            {consumptionMenu.map((main, idx) => (
              <RenderMenuItem
                key={`m-cons-${main.title}-${idx}`}
                item={main}
                isMobile
              />
            ))}
            <DropdownMenuSeparator />
            <SettingsItems isMobile />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
};
