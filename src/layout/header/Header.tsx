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
import { changeLanguage as switchLanguage, type AppLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
import { Link } from "@/ux/Link";
import {
  MenuItem,
  electionsMenu,
  governanceMenu,
  consumptionMenu,
} from "./reportMenus";
import { Search } from "../search/Search";
import { FollowingHeaderLink } from "./FollowingHeaderLink";
import { ElectionsSelect } from "./ElectionsSelect";
import { Logo } from "./Logo";
import { CabinetAnchorPill } from "./CabinetAnchorPill";
import { AreaSniperButton } from "./AreaSniperButton";
import { AreaPill } from "./AreaPill";
import { useElectionContext } from "@/data/ElectionContext";
import { useArticles } from "@/data/articles/useArticles";
import { siteChrome } from "@/layout/siteChrome";
import { balanceGroups, headerSection } from "./headerSection";

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
  // The rule lives in ./headerSection so the gate can execute it rather than
  // restate it — see that module's header for why the copy had to go.
  const { inElections, inGovernance, inConsumption } = headerSection(
    location.pathname,
  );

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
          active ? siteChrome.activeSurface : siteChrome.idleSurface,
        )}
      >
        <Link
          to={topMenu.link ?? "/"}
          underline={false}
          className={cn(
            "flex items-center whitespace-nowrap px-2.5 py-1 lowercase transition-colors focus:outline-none focus-visible:bg-foreground/[0.08]",
            active ? siteChrome.activeText : siteChrome.idleText,
          )}
        >
          {t(topMenu.title)}
        </Link>
        <span
          aria-hidden
          className={cn(
            "w-px",
            active ? siteChrome.activeDivider : siteChrome.idleDivider,
          )}
        />
        <DropdownMenuTrigger
          aria-label={t(topMenu.title)}
          className={cn(
            "group flex items-center px-1.5 transition-colors focus:outline-none focus-visible:bg-foreground/[0.08]",
            active ? siteChrome.activeTrigger : siteChrome.idleTrigger,
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
          // ⚠ THE WIDTH IS CONTENT-DRIVEN, and that replaced three measured constants.
          // `w-56`, then `w-72`, then `w-[30rem]` were each fitted by hand to the longest
          // label in the longer of the two corpora — a number that goes stale the next time
          // anyone edits a menu string, in a way only a screenshot shows. `w-max` sizes each
          // column to its own widest leaf instead, so a label can no longer wrap by
          // construction and no menu is wider than it needs to be. `max-w` is the only cap
          // that has to stay: a runaway label must not push the panel off-screen.
          "w-max max-w-[calc(100vw-2rem)] whitespace-nowrap",
          // Section groups sit side by side once a menu has enough of them — see `columns`
          // in reportMenus.ts. All three carry it: single-column Избори measured 677px tall
          // at a 900px viewport and already scrolled inside its own panel.
          topMenu.columns === 2 && "flex gap-x-4",
        )}
      >
        {topMenu.columns === 2
          ? // ⚠ BALANCED FLEX COLUMNS, NOT A 2-COLUMN GRID. A grid aligns ROWS, so two groups
            // of unequal length leave a hole under the shorter one — visibly, under „Държавни
            // сектори" on Управление and under „Промоции" on Потребление. Packing each group
            // onto the currently-shortest column removes the hole and preserves the reading
            // order the grid produced anyway (row-major placement of N groups into 2 columns
            // and greedy min-fill agree on every menu here).
            balanceGroups(
              topMenu.subMenu?.filter(
                (menu) => menu.group && (import.meta.env.DEV || !menu.devOnly),
              ) ?? [],
            ).map((column, colIdx) => (
              <div key={`col-${colIdx}`} className="min-w-0">
                {column.map((menu, idx) => (
                  <div key={`${menu.title}-${idx}`}>
                    <DropdownMenuLabel>{t(menu.title)}</DropdownMenuLabel>
                    {menu.subMenu?.map((sub, subIdx) => (
                      <RenderMenuItem
                        key={`${sub.title}-${subIdx}`}
                        item={sub}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))
          : topMenu.subMenu?.map((menu, idx) => (
              <RenderMenuItem key={`${menu.title}-${idx}`} item={menu} />
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // Only the language the visitor arrived in is bundled at boot, so the other
  // one has to be fetched before switching — switchLanguage does that (and owns
  // persisting the preference), and is a no-op on a bundle already in memory.
  // Catch here rather than letting it reach the global unhandledrejection
  // handler, which is written for stale-chunk recovery and would either reload
  // the page mid-session or do nothing at all depending on a one-shot guard.
  const changeLanguage = (language: AppLanguage) => {
    void switchLanguage(language).catch((err) => {
      console.error("language switch failed", err);
    });
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
      className={cn(
        siteChrome.headerSurface,
        "fixed top-0 z-10 flex w-full items-center justify-between gap-1 sm:gap-2",
      )}
    >
      <div className="flex min-w-0 text-xl text-primary items-center gap-1.5 p-2 sm:gap-2 sm:px-3 sm:py-4">
        <Link to="/" className="flex shrink-0 flex-row items-center">
          {/* The logo goes to `/`, which is the whole platform rather than the election
              section, so its accessible name says so — and through `t()`, since a
              hard-coded English literal was the only untranslated string in a bilingual
              header. */}
          <span className="sr-only">{t("nav_logo_home_label")}</span>
          <Logo className="size-7" />
          <div className="hidden pl-2 font-title text-2xl transition-all duration-200 sm:flex">
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
        <FollowingHeaderLink />
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
              type="button"
              className="inline-flex items-center justify-center rounded-lg lg:hidden text-muted-foreground hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <span className="sr-only">Open main menu</span>
              <Menu />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            // Inline-expanded sub-menus can run the tree tall — cap to the
            // space Radix leaves before collision and scroll past it.
            //
            // ⚠ THE WIDTH IS NOT `w-56`, AND THE REASON IS THE NESTING RATHER THAN THE
            // LABELS. A mobile group is an inline accordion (`MenuSub`), and each level costs
            // `ml-2 pl-1` — so a leaf inside a group inside a section sits 24px in, leaving a
            // `w-56` panel just 168px of text. Every Elections leaf over „Парламентарни
            // избори" wrapped to two lines there, and the Управление and Потребление trees
            // joined them the day they gained groups. 19rem restores ~248px, which clears the
            // widest label in both corpora („Общини с разделено управление", 230px).
            //
            // ⚠ CAPPED AGAINST THE VIEWPORT, not a bare 19rem: this panel opens on phones as
            // narrow as 320px, where a fixed 304px would leave no margin and hand Radix a
            // collision to solve on every open.
            className="w-[min(19rem,calc(100vw-2rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
          >
            {electionsMenu.map((main, idx) => (
              <RenderMenuItem
                key={`m-elec-${main.title}-${idx}`}
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
