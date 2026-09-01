import { lazy, Suspense, useContext } from "react";
import { Route, Routes, NavLink, Link } from "react-router-dom";
import { Logo } from "@/layout/header/Logo";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark, themeLight } from "@/theme/utils";
import { HomeScreen } from "./app/screens/HomeScreen";
import { StoryScreen } from "./app/screens/StoryScreen";
import { OutletsScreen } from "./app/screens/OutletsScreen";
import { OutletScreen } from "./app/screens/OutletScreen";
import { TopicsScreen } from "./app/screens/TopicsScreen";
import { ArticleScreen } from "./app/screens/ArticleScreen";
import { MethodologyScreen } from "./app/screens/MethodologyScreen";
import { SavedScreen } from "./app/screens/SavedScreen";
import { AboutScreen } from "./app/screens/AboutScreen";
import { AnalyticsRouteTracker } from "./app/components/AnalyticsRouteTracker";
import { CorrectionsScreen } from "./app/screens/CorrectionsScreen";

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

const EvalRouteFallback = () => (
  <section className="py-12" aria-busy="true" aria-live="polite">
    <p className="text-sm text-muted-foreground">Зареждане на оценяването…</p>
  </section>
);

const NotFoundScreen = () => (
  <section className="py-12">
    <h1 className="font-title text-3xl">Страницата не е намерена</h1>
    <p className="mt-2 text-muted-foreground">
      Адресът не съществува.{" "}
      <Link
        to="/"
        className="font-medium text-primary underline underline-offset-4"
      >
        Към историите
      </Link>
    </p>
  </section>
);

const NAV = [
  { to: "/", label: "Истории", end: true },
  { to: "/outlets", label: "Източници" },
  { to: "/topics", label: "Теми" },
  { to: "/saved", label: "Запазени" },
  { to: "/methodology", label: "Методология", mobileLabel: "Метод" },
] as const;

const FOOTER_LINKS = [
  {
    href: "https://electionsbg.com",
    label: "electionsbg.com",
    mobileLabel: "electionsbg",
  },
  { href: "/about", label: "за редакцията", mobileLabel: "за нас" },
  { href: "/corrections", label: "поправки", mobileLabel: "поправки" },
  {
    href: "https://github.com/atanasster/electionsbg",
    label: "отворен код",
    mobileLabel: "код",
  },
  { href: "/methodology", label: "методология", mobileLabel: "метод" },
] as const;

export const App = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const isDark = theme === themeDark;

  return (
    <div className="news-shell flex min-h-dvh flex-col bg-background text-foreground">
      <AnalyticsRouteTracker />
      <a href="#news-main" className="news-skip-link">
        Към основното съдържание
      </a>
      <header className="news-masthead sticky top-0 z-40 border-b bg-background">
        <div className="container flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 sm:px-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 text-xl text-primary"
              aria-label="Наясно Новини"
            >
              <Logo className="size-7" />
              <span className="font-title">
                <span className="text-[hsl(var(--editorial-kicker))]">
                  Наясно
                </span>
                <span className="pl-1 font-semibold uppercase text-primary">
                  Новини
                </span>
              </span>
            </Link>
            <nav
              className="hidden items-center gap-1 md:flex"
              aria-label="Основна навигация"
            >
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={"end" in item ? item.end : false}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
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
              className="hidden sm:inline-flex"
            >
              <a href="https://electionsbg.com">electionsbg.com</a>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(isDark ? themeLight : themeDark)}
              aria-label={isDark ? "Включи светла тема" : "Включи тъмна тема"}
              title={isDark ? "Включи светла тема" : "Включи тъмна тема"}
            >
              {isDark ? "☀" : "☾"}
            </Button>
          </div>
        </div>
        {/* Mobile nav — one bounded row of pills under the header row. */}
        <nav
          className="news-mobile-nav container grid grid-cols-5 items-stretch gap-0.5 px-2 pb-2 md:hidden"
          aria-label="Основна навигация"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              aria-label={item.label}
              className={({ isActive }) =>
                `news-mobile-nav-link flex min-w-0 items-center justify-center rounded-full font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`
              }
            >
              <span className="sm:hidden">
                {"mobileLabel" in item ? item.mobileLabel : item.label}
              </span>
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>

      <main
        id="news-main"
        className="news-main container flex-1 px-2 py-6 sm:px-4"
      >
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
              <Suspense fallback={<EvalRouteFallback />}>
                <EvalsScreen />
              </Suspense>
            }
          />
          <Route
            path="/evals/article/:domain/:id"
            element={
              <Suspense fallback={<EvalRouteFallback />}>
                <EvalArticleScreen />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </main>

      <footer className="news-footer border-t bg-background p-2 text-sm sm:p-4 lg:flex lg:items-center lg:justify-between lg:gap-4">
        <div className="hidden shrink-0 font-medium lowercase text-secondary-foreground lg:block">
          © {new Date().getFullYear()} · всички права запазени
        </div>
        <ul className="news-footer-links grid w-full grid-cols-5 items-stretch lg:flex lg:w-auto lg:items-center lg:gap-3">
          {FOOTER_LINKS.map(({ href, label, mobileLabel }) => (
            <li key={href}>
              {href.startsWith("/") ? (
                <Link
                  to={href}
                  aria-label={label}
                  className="news-footer-link flex min-w-0 items-center justify-center whitespace-nowrap rounded-sm font-medium lowercase text-secondary-foreground hover:text-primary"
                >
                  <span className="sm:hidden">{mobileLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              ) : (
                <a
                  href={href}
                  aria-label={label}
                  className="news-footer-link flex min-w-0 items-center justify-center whitespace-nowrap rounded-sm font-medium lowercase text-secondary-foreground hover:text-primary"
                >
                  <span className="sm:hidden">{mobileLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
};
