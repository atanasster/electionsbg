import { lazy, Suspense, useContext } from "react";
import { Route, Routes, NavLink, Link, useLocation } from "react-router-dom";
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
import {
  NewsLocaleProvider,
  newsPathForLanguage,
  writeNewsLanguagePreference,
  useNewsLocale,
  type NewsLanguage,
} from "./app/i18n";

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

const EvalRouteFallback = () => <LocalizedEvalRouteFallback />;

const EnglishEvaluationNotice = () => (
  <section className="mx-auto max-w-2xl py-12">
    <h1 className="font-title text-3xl">Public evaluation</h1>
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

const LocalizedEvalRouteFallback = () => {
  const { tr } = useNewsLocale();
  return (
    <section className="py-12" aria-busy="true" aria-live="polite">
      <p className="text-sm text-muted-foreground">
        {tr("Зареждане на оценяването…", "Loading the evaluation…")}
      </p>
    </section>
  );
};

const NotFoundScreen = () => {
  const { tr } = useNewsLocale();
  return (
    <section className="py-12">
      <h1 className="font-title text-3xl">
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
  const nav = [
    { to: "/", label: tr("Истории", "Stories"), end: true },
    { to: "/outlets", label: tr("Източници", "Sources") },
    { to: "/topics", label: tr("Теми", "Topics") },
    { to: "/saved", label: tr("Запазени", "Saved") },
    {
      to: "/methodology",
      label: tr("Методология", "Methodology"),
      mobileLabel: tr("Метод", "Method"),
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
      mobileLabel: "electionsbg",
    },
    {
      href: "/about",
      label: tr("за редакцията", "about"),
      mobileLabel: tr("за нас", "about"),
    },
    {
      href: "/corrections",
      label: tr("поправки", "corrections"),
      mobileLabel: tr("поправки", "corrections"),
    },
    {
      href: "https://github.com/atanasster/electionsbg",
      label: tr("отворен код", "open source"),
      mobileLabel: tr("код", "code"),
    },
    {
      href: "/methodology",
      label: tr("методология", "methodology"),
      mobileLabel: tr("метод", "method"),
    },
  ] as const;

  return (
    <div className="news-shell flex min-h-dvh flex-col bg-background text-foreground">
      <AnalyticsRouteTracker />
      <a href="#news-main" className="news-skip-link">
        {tr("Към основното съдържание", "Skip to main content")}
      </a>
      <header className="news-masthead sticky top-0 z-40 border-b bg-background">
        <div className="container flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 sm:px-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 text-xl text-primary"
              aria-label={tr("Наясно Новини", "Naiasno News")}
            >
              <Logo className="size-7" />
              <span className="font-title">
                <span className="text-[hsl(var(--editorial-kicker))]">
                  {tr("Наясно", "Naiasno")}
                </span>
                <span className="pl-1 font-semibold uppercase text-primary">
                  {tr("Новини", "News")}
                </span>
              </span>
            </Link>
            <nav
              className="hidden items-center gap-1 md:flex"
              aria-label={tr("Основна навигация", "Primary navigation")}
            >
              {nav.map((item) => (
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
              <a href={mainSite}>electionsbg.com</a>
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
          </div>
        </div>
        {/* Mobile nav — one bounded row of pills under the header row. */}
        <nav
          className="news-mobile-nav container grid grid-cols-5 items-stretch gap-0.5 px-2 pb-2 md:hidden"
          aria-label={tr("Основна навигация", "Primary navigation")}
        >
          {nav.map((item) => (
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
              language === "en" ? (
                <EnglishEvaluationNotice />
              ) : (
                <Suspense fallback={<EvalRouteFallback />}>
                  <EvalsScreen />
                </Suspense>
              )
            }
          />
          <Route
            path="/evals/article/:domain/:id"
            element={
              language === "en" ? (
                <EnglishEvaluationNotice />
              ) : (
                <Suspense fallback={<EvalRouteFallback />}>
                  <EvalArticleScreen />
                </Suspense>
              )
            }
          />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </main>

      <footer className="news-footer border-t bg-background p-2 text-sm sm:p-4 lg:flex lg:items-center lg:justify-between lg:gap-4">
        <div className="hidden shrink-0 font-medium lowercase text-secondary-foreground lg:block">
          © {new Date().getFullYear()} ·{" "}
          {tr("всички права запазени", "all rights reserved")}
        </div>
        <ul className="news-footer-links grid w-full grid-cols-5 items-stretch lg:flex lg:w-auto lg:items-center lg:gap-3">
          {footerLinks.map(({ href, label, mobileLabel }) => (
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

export const App = ({ language = "bg" }: { language?: NewsLanguage }) => (
  <NewsLocaleProvider language={language}>
    <NewsAppShell />
  </NewsLocaleProvider>
);
