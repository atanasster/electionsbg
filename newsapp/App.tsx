import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  type ComponentType,
} from "react";
import { Route, Routes, NavLink, Link, useLocation } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { siteChrome } from "@/layout/siteChrome";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { AnalyticsRouteTracker } from "./app/components/AnalyticsRouteTracker";
import { SHELL_MAIN } from "./app/shell";
import {
  NewsLocaleProvider,
  newsPathForLanguage,
  writeNewsLanguagePreference,
  useNewsLocale,
  type NewsLanguage,
} from "./app/i18n";

const lazyScreen = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) =>
  lazy(() =>
    loader().then((module) => ({
      default: module[exportName] as ComponentType,
    })),
  );

const HomeScreen = lazyScreen(
  () => import("./app/screens/HomeScreen"),
  "HomeScreen",
);
const StoryScreen = lazyScreen(
  () => import("./app/screens/StoryScreen"),
  "StoryScreen",
);
const OutletsScreen = lazyScreen(
  () => import("./app/screens/OutletsScreen"),
  "OutletsScreen",
);
const OutletScreen = lazyScreen(
  () => import("./app/screens/OutletScreen"),
  "OutletScreen",
);
const TopicsScreen = lazyScreen(
  () => import("./app/screens/TopicsScreen"),
  "TopicsScreen",
);
const ArticleScreen = lazyScreen(
  () => import("./app/screens/ArticleScreen"),
  "ArticleScreen",
);
const MethodologyScreen = lazyScreen(
  () => import("./app/screens/MethodologyScreen"),
  "MethodologyScreen",
);
const SavedScreen = lazyScreen(
  () => import("./app/screens/SavedScreen"),
  "SavedScreen",
);
const AboutScreen = lazyScreen(
  () => import("./app/screens/AboutScreen"),
  "AboutScreen",
);
const CorrectionsScreen = lazyScreen(
  () => import("./app/screens/CorrectionsScreen"),
  "CorrectionsScreen",
);

const EvalsScreen = lazy(() =>
  import("./app/screens/EvalsScreen").then(({ EvalsScreen }) => ({
    default: EvalsScreen,
  })),
);
const EvalArticleScreen = lazy(() =>
  import("./app/screens/EvalArticleScreen").then(({ EvalArticleScreen }) => ({
    default: EvalArticleScreen,
  })),
);

const RouteFallback = () => <LocalizedRouteFallback />;

const EnglishEvaluationNotice = () => (
  <section className="mx-auto max-w-2xl py-12">
    <h1 className="app-page-title">Public evaluation</h1>
    <p className="mt-3 leading-relaxed text-muted-foreground">
      The experimental evaluation form is currently available only in Bulgarian.
      It is kept out of the English interface so the two languages are not mixed
      on one page.
    </p>
    <Link
      to="/methodology"
      className="mt-4 inline-block font-medium text-primary underline underline-offset-4"
    >
      Read the methodology
    </Link>
  </section>
);

const LocalizedRouteFallback = () => {
  const { tr } = useNewsLocale();
  return (
    <section className="py-12" aria-busy="true" aria-live="polite">
      <p className="text-sm text-muted-foreground">
        {tr("Зареждане…", "Loading…")}
      </p>
    </section>
  );
};

const NotFoundScreen = () => {
  const { tr } = useNewsLocale();
  return (
    <section className="py-12">
      <h1 className="app-page-title">
        {tr("Страницата не е намерена", "Page not found")}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {tr("Адресът не съществува.", "This address does not exist.")}{" "}
        <Link
          to="/"
          className="font-medium text-primary underline underline-offset-4"
        >
          {tr("Към историите", "Go to stories")}
        </Link>
      </p>
    </section>
  );
};

const LanguageSwitcher = () => {
  const { language, tr } = useNewsLocale();
  const location = useLocation();
  const href = (target: NewsLanguage) =>
    `${newsPathForLanguage(location.pathname, target)}${location.search}${location.hash}`;
  const remember = (target: NewsLanguage) => {
    writeNewsLanguagePreference(target);
  };

  return (
    <div
      className="flex h-9 items-center rounded-md border border-input bg-background p-0.5 text-xs font-semibold"
      role="group"
      aria-label={tr("Език", "Language")}
    >
      {(["bg", "en"] as const).map((target) => (
        <a
          key={target}
          href={href(target)}
          hrefLang={target}
          lang={target}
          aria-current={language === target ? "true" : undefined}
          onClick={() => remember(target)}
          className={`flex h-7 min-w-8 items-center justify-center rounded px-1.5 transition-colors ${
            language === target
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          {target.toUpperCase()}
        </a>
      ))}
    </div>
  );
};

const NewsAppShell = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const isDark = theme === themeDark;
  const { language, tr } = useNewsLocale();
  const location = useLocation();

  useEffect(() => {
    if (location.hash !== "#news-search") return;
    const frame = window.requestAnimationFrame(() => {
      const search = document.getElementById("news-search");
      if (!(search instanceof HTMLInputElement)) return;
      search.focus({ preventScroll: true });
      search.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.pathname]);
  const nav = [
    { to: "/", label: tr("Истории", "Stories"), end: true },
    { to: "/outlets", label: tr("Източници", "Sources") },
    { to: "/topics", label: tr("Теми", "Topics") },
    { to: "/saved", label: tr("Запазени", "Saved") },
    {
      to: "/methodology",
      label: tr("Методология", "Methodology"),
    },
  ] as const;
  const mainSite =
    language === "en"
      ? "https://electionsbg.com/en"
      : "https://electionsbg.com";
  const footerLinks = [
    {
      href: mainSite,
      label: "electionsbg.com",
    },
    {
      href: "/about",
      label: tr("за редакцията", "about"),
    },
    {
      href: "/corrections",
      label: tr("поправки", "corrections"),
    },
    {
      href: "https://github.com/atanasster/electionsbg",
      label: tr("отворен код", "open source"),
    },
    {
      href: "/methodology",
      label: tr("методология", "methodology"),
    },
  ] as const;

  return (
    <div className="news-shell flex min-h-dvh flex-col bg-background text-foreground">
      <AnalyticsRouteTracker />
      <a href="#news-main" className="news-skip-link">
        {tr("Към основното съдържание", "Skip to main content")}
      </a>
      <header
        className={cn(
          siteChrome.headerSurface,
          "news-masthead sticky top-0 z-40",
        )}
      >
        <div className="container flex min-h-12 items-center justify-between gap-2 p-2 sm:px-3 sm:py-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 text-xl text-primary"
              aria-label={tr("Наясно Новини", "Naiasno News")}
            >
              <Logo className="size-7" />
              <span className="hidden font-title sm:inline">
                <span className="text-[hsl(var(--editorial-kicker))]">
                  {tr("Наясно", "Naiasno")}
                </span>
                <span className="pl-1 font-semibold uppercase text-primary">
                  {tr("Новини", "News")}
                </span>
              </span>
            </Link>
            <nav
              className="hidden items-center gap-1 lg:flex"
              aria-label={tr("Основна навигация", "Primary navigation")}
            >
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={"end" in item ? item.end : false}
                  className={({ isActive }) =>
                    `rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive ? siteChrome.activeNav : siteChrome.idleNav
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="hidden xl:inline-flex"
            >
              <a href={mainSite}>electionsbg.com</a>
            </Button>
            <Button variant="ghost" size="icon" asChild className="lg:hidden">
              <Link
                to="/#news-search"
                aria-label={tr("Търсене в новините", "Search the news")}
              >
                <Search aria-hidden />
              </Link>
            </Button>
            <LanguageSwitcher />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(isDark ? themeLight : themeDark)}
              aria-label={
                isDark
                  ? tr("Включи светла тема", "Use light theme")
                  : tr("Включи тъмна тема", "Use dark theme")
              }
              title={
                isDark
                  ? tr("Включи светла тема", "Use light theme")
                  : tr("Включи тъмна тема", "Use dark theme")
              }
            >
              {isDark ? "☀" : "☾"}
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={tr("Отвори менюто", "Open menu")}
                >
                  <Menu aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {nav.map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <NavLink
                      to={item.to}
                      end={"end" in item ? item.end : false}
                      className="w-full"
                    >
                      {item.label}
                    </NavLink>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={mainSite}>electionsbg.com</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="news-main" className={SHELL_MAIN}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/story/:id" element={<StoryScreen />} />
            <Route path="/outlets" element={<OutletsScreen />} />
            <Route path="/outlet/:domain" element={<OutletScreen />} />
            <Route path="/topics" element={<TopicsScreen />} />
            <Route path="/article/:domain/:id" element={<ArticleScreen />} />
            <Route path="/methodology" element={<MethodologyScreen />} />
            <Route path="/saved" element={<SavedScreen />} />
            <Route path="/about" element={<AboutScreen />} />
            <Route path="/corrections" element={<CorrectionsScreen />} />
            <Route
              path="/evals"
              element={
                language === "en" ? (
                  <EnglishEvaluationNotice />
                ) : (
                  <EvalsScreen />
                )
              }
            />
            <Route
              path="/evals/article/:domain/:id"
              element={
                language === "en" ? (
                  <EnglishEvaluationNotice />
                ) : (
                  <EvalArticleScreen />
                )
              }
            />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
      </main>

      <footer
        className={cn(
          siteChrome.footerSurface,
          "news-footer flex items-center justify-end gap-4 p-4 text-sm sm:justify-between",
        )}
      >
        <div className="hidden shrink-0 font-medium lowercase text-secondary-foreground sm:block">
          © {new Date().getFullYear()} ·{" "}
          {tr("всички права запазени", "all rights reserved")}
        </div>
        <ul className="news-footer-links flex flex-wrap items-center justify-end gap-x-1 gap-y-1 sm:gap-x-3">
          {footerLinks.map(({ href, label }) => (
            <li key={href}>
              {href.startsWith("/") ? (
                <Link
                  to={href}
                  aria-label={label}
                  className="news-footer-link flex items-center justify-center whitespace-nowrap rounded-sm px-2 font-medium lowercase text-secondary-foreground hover:text-primary"
                >
                  {label}
                </Link>
              ) : (
                <a
                  href={href}
                  aria-label={label}
                  className="news-footer-link flex items-center justify-center whitespace-nowrap rounded-sm px-2 font-medium lowercase text-secondary-foreground hover:text-primary"
                >
                  {label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
};

export const App = ({ language = "bg" }: { language?: NewsLanguage }) => (
  <NewsLocaleProvider language={language}>
    <NewsAppShell />
  </NewsLocaleProvider>
);
