import { useContext } from "react";
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
  { to: "/methodology", label: "Методология" },
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
        {/* Mobile nav — one row of scrollable pills under the header row. */}
        <nav
          className="container flex items-center gap-1 overflow-x-auto px-2 pb-2 md:hidden"
          aria-label="Основна навигация"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`
              }
            >
              {item.label}
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
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </main>

      <footer className="news-footer flex flex-wrap items-center justify-between gap-2 border-t bg-background p-4 text-sm">
        <div className="hidden font-medium lowercase text-secondary-foreground sm:block">
          © {new Date().getFullYear()} · всички права запазени
        </div>
        <ul className="flex flex-wrap items-center gap-1">
          {[
            ["https://electionsbg.com", "electionsbg.com"],
            ["/about", "за редакцията"],
            ["/corrections", "поправки"],
            ["https://github.com/atanasster/electionsbg", "отворен код"],
            ["/methodology", "методология"],
          ].map(([href, label]) => (
            <li key={href}>
              {href.startsWith("/") ? (
                <Link
                  to={href}
                  className="mx-2 font-medium lowercase text-secondary-foreground hover:text-primary"
                >
                  {label}
                </Link>
              ) : (
                <a
                  href={href}
                  className="mx-2 font-medium lowercase text-secondary-foreground hover:text-primary"
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
