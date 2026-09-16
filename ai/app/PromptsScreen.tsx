import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ListTree,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatNavigation } from "./navigation";
import { STARTER_CATEGORIES, STARTERS, type Starter } from "./starters";
import { translitKey } from "../tools/translit";
import { clearSavedChat } from "./chatStorage";
import { Logo } from "@/layout/header/Logo";

interface PromptsScreenProps {
  integrated?: boolean;
}

export const PromptsScreen = ({ integrated = true }: PromptsScreenProps) => {
  const navigation = useChatNavigation();
  const lang = navigation.lang === "en" ? "en" : "bg";
  const en = lang === "en";

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(STARTER_CATEGORIES.map((c) => c.id)),
  );

  // Pre-calculate count of prompts per category and subcategory
  const counts = useMemo(() => {
    const catMap: Record<string, number> = {};
    const subMap: Record<string, number> = {};
    for (const starter of STARTERS) {
      catMap[starter.category] = (catMap[starter.category] ?? 0) + 1;
      const subKey = `${starter.category}:${starter.subcategory}`;
      subMap[subKey] = (subMap[subKey] ?? 0) + 1;
    }
    return { catMap, subMap };
  }, []);

  const categoryLookup = useMemo(() => {
    return new Map(STARTER_CATEGORIES.map((c) => [c.id, c]));
  }, []);

  const subcategoryLookup = useMemo(() => {
    const map = new Map<string, { id: string; bg: string; en: string }>();
    for (const cat of STARTER_CATEGORIES) {
      for (const sub of cat.subcategories) {
        map.set(`${cat.id}:${sub.id}`, sub);
      }
    }
    return map;
  }, []);

  const toggleExpand = (catId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedCategory(null);
    setSelectedSubcategory(null);
  };

  const handleSelectCategory = (catId: string) => {
    if (selectedCategory === catId && selectedSubcategory === null) {
      return;
    }
    setSelectedCategory(catId);
    setSelectedSubcategory(null);
    setExpandedCategories((prev) => new Set([...prev, catId]));
  };

  const handleSelectSubcategory = (catId: string, subId: string) => {
    setSelectedCategory(catId);
    setSelectedSubcategory(subId);
    setExpandedCategories((prev) => new Set([...prev, catId]));
  };

  // Filter prompts
  const filteredPrompts = useMemo(() => {
    const query = translitKey(searchQuery.trim());
    return STARTERS.filter((starter) => {
      if (selectedCategory && starter.category !== selectedCategory) {
        return false;
      }
      if (selectedSubcategory && starter.subcategory !== selectedSubcategory) {
        return false;
      }
      if (!query) return true;

      const catObj = categoryLookup.get(starter.category);
      const subObj = subcategoryLookup.get(
        `${starter.category}:${starter.subcategory}`,
      );

      const haystack = translitKey(
        [
          starter.bg,
          starter.en,
          starter.tool,
          catObj?.bg ?? "",
          catObj?.en ?? "",
          subObj?.bg ?? "",
          subObj?.en ?? "",
        ].join(" "),
      );

      const terms = query.split(/\s+/).filter(Boolean);
      return terms.every((term) => haystack.includes(term));
    });
  }, [
    selectedCategory,
    selectedSubcategory,
    searchQuery,
    categoryLookup,
    subcategoryLookup,
  ]);

  // Group filtered prompts by category (and subcategory) if viewing all or when appropriate
  const groupedPrompts = useMemo(() => {
    const groups: {
      category: (typeof STARTER_CATEGORIES)[number];
      subgroups: {
        subcategory: { id: string; bg: string; en: string };
        prompts: Starter[];
      }[];
      totalPrompts: number;
    }[] = [];

    const catMap = new Map<string, (typeof groups)[0]>();

    for (const starter of filteredPrompts) {
      let g = catMap.get(starter.category);
      if (!g) {
        const cat = categoryLookup.get(starter.category);
        if (!cat) continue;
        g = { category: cat, subgroups: [], totalPrompts: 0 };
        catMap.set(starter.category, g);
        groups.push(g);
      }
      g.totalPrompts++;

      let subGroup = g.subgroups.find(
        (s) => s.subcategory.id === starter.subcategory,
      );
      if (!subGroup) {
        const sub = subcategoryLookup.get(
          `${starter.category}:${starter.subcategory}`,
        ) ?? {
          id: starter.subcategory,
          bg: starter.subcategory,
          en: starter.subcategory,
        };
        subGroup = { subcategory: sub, prompts: [] };
        g.subgroups.push(subGroup);
      }
      subGroup.prompts.push(starter);
    }

    return groups;
  }, [filteredPrompts, categoryLookup, subcategoryLookup]);

  const prefix =
    navigation.pathname.startsWith("/en/") || lang === "en" ? "/en" : "";
  const chatBase = `${prefix}/chat`;

  const handleLaunch = (promptText: string) => {
    clearSavedChat();
    navigation.navigate(`${chatBase}?q=${encodeURIComponent(promptText)}`);
  };

  const currentCategoryObj = selectedCategory
    ? categoryLookup.get(selectedCategory)
    : null;
  const currentSubcategoryObj =
    selectedCategory && selectedSubcategory
      ? subcategoryLookup.get(`${selectedCategory}:${selectedSubcategory}`)
      : null;

  const Content = integrated ? "div" : "main";

  return (
    <div className="flex flex-1 flex-col bg-card text-foreground">
      {!integrated && (
        <header className="flex w-full shrink-0 items-center justify-between border-b bg-muted px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="font-semibold">{en ? "Naiasno" : "Наясно"}</span>
          </div>
        </header>
      )}

      <Content className="container mx-auto flex min-h-full flex-col px-2 py-6 sm:px-4">
        {/* Page Hero Header */}
        <div className="mb-6 max-w-3xl space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" />
            <span>{en ? "Prompt Library" : "Каталог с въпроси"}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {en
              ? "Sample Prompts for Naiasno AI"
              : "Примерни въпроси за Наясно AI"}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            {en
              ? "Browse verified starter prompts across civic topics and subtopics. Click any prompt to launch it directly in the AI chat with official data sources."
              : "Разгледайте проверени примерни въпроси по теми и подтеми. Кликнете върху който и да е въпрос, за да го зададете директно в чата с официални източници."}
          </p>
        </div>

        {/* Layout Grid: TOC Sidebar (Desktop) + Prompts Content */}
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
          {/* Table of Contents (TOC) Sidebar */}
          <aside
            aria-label={en ? "Topics table of contents" : "Съдържание по теми"}
            className="flex flex-col space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-sm lg:sticky lg:top-[calc(var(--header-height,70px)+3.5rem)] lg:self-start lg:max-h-[calc(100dvh-var(--header-height,70px)-4.5rem)]"
          >
            <div className="flex shrink-0 items-center justify-between border-b pb-2 px-1">
              <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                <ListTree className="size-4 text-primary" />
                {en ? "Topics & Subtopics" : "Теми и подтеми"}
              </span>
              <span className="text-xs text-muted-foreground">
                {STARTERS.length} {en ? "prompts" : "въпроса"}
              </span>
            </div>

            {/* Search Input inside sidebar */}
            <div className="relative shrink-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label={en ? "Search prompts" : "Търсене на въпроси"}
                placeholder={
                  en
                    ? "Search prompts, topics, or keywords…"
                    : "Търсене на въпроси, теми или ключови думи…"
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-9 pr-8 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label={en ? "Clear search" : "Изчисти търсенето"}
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Mobile topic dropdown (visible on screens < lg) */}
            <div className="block shrink-0 lg:hidden">
              <label htmlFor="mobile-topic-select" className="sr-only">
                {en ? "Select topic" : "Изберете тема"}
              </label>
              <select
                id="mobile-topic-select"
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={
                  selectedSubcategory
                    ? `${selectedCategory}:${selectedSubcategory}`
                    : (selectedCategory ?? "")
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    handleSelectAll();
                  } else if (val.includes(":")) {
                    const [c, s] = val.split(":");
                    handleSelectSubcategory(c, s);
                  } else {
                    handleSelectCategory(val);
                  }
                }}
              >
                <option value="">
                  {en ? "All topics" : "Всички теми"} ({STARTERS.length})
                </option>
                {STARTER_CATEGORIES.map((cat) => (
                  <optgroup
                    key={cat.id}
                    label={`${cat[lang]} (${counts.catMap[cat.id] ?? 0})`}
                  >
                    <option value={cat.id}>
                      {cat[lang]} - {en ? "All" : "Всички"} (
                      {counts.catMap[cat.id] ?? 0})
                    </option>
                    {cat.subcategories.map((sub) => (
                      <option key={sub.id} value={`${cat.id}:${sub.id}`}>
                        ↳ {sub[lang]} (
                        {counts.subMap[`${cat.id}:${sub.id}`] ?? 0})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <nav className="hidden lg:block min-h-0 flex-1 overflow-y-auto space-y-1 pt-0.5">
              {/* All Topics Option */}
              <button
                type="button"
                onClick={handleSelectAll}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                  selectedCategory === null && !searchQuery
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span>{en ? "All topics" : "Всички теми"}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    selectedCategory === null && !searchQuery
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {STARTERS.length}
                </span>
              </button>

              {/* Categories Tree */}
              {STARTER_CATEGORIES.map((cat) => {
                const catCount = counts.catMap[cat.id] ?? 0;
                const isCatActive =
                  selectedCategory === cat.id && selectedSubcategory === null;
                const isCatExpanded = expandedCategories.has(cat.id);

                return (
                  <div key={cat.id} className="space-y-0.5 pt-1">
                    <div
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                        isCatActive
                          ? "bg-primary/15 font-semibold text-primary"
                          : selectedCategory === cat.id
                            ? "bg-muted/60 font-medium text-foreground"
                            : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectCategory(cat.id)}
                        className="flex-1 truncate text-left"
                      >
                        {cat[lang]}
                      </button>
                      <div className="flex items-center gap-1">
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {catCount}
                        </span>
                        <button
                          type="button"
                          aria-label={
                            isCatExpanded
                              ? `${en ? "Collapse" : "Свий"} ${cat[lang]}`
                              : `${en ? "Expand" : "Разгъни"} ${cat[lang]}`
                          }
                          onClick={(e) => toggleExpand(cat.id, e)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {isCatExpanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Subcategories (if expanded) */}
                    {isCatExpanded && (
                      <div className="ml-3.5 space-y-0.5 border-l border-border/80 pl-2">
                        {cat.subcategories.map((sub) => {
                          const subKey = `${cat.id}:${sub.id}`;
                          const subCount = counts.subMap[subKey] ?? 0;
                          const isSubActive =
                            selectedCategory === cat.id &&
                            selectedSubcategory === sub.id;

                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() =>
                                handleSelectSubcategory(cat.id, sub.id)
                              }
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${
                                isSubActive
                                  ? "bg-primary text-primary-foreground font-semibold"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                              }`}
                            >
                              <span className="truncate">{sub[lang]}</span>
                              <span
                                className={`ml-1 shrink-0 rounded px-1.5 py-0.2 text-[10px] tabular-nums ${
                                  isSubActive
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {subCount}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>

          {/* Prompts Main List / Content Area */}
          <section
            aria-label={en ? "Prompts list" : "Списък с въпроси"}
            className="min-w-0 space-y-6"
          >
            {/* Active Filter Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-foreground">
                  {selectedCategory === null ? (
                    searchQuery ? (
                      `${en ? "Search results for" : "Резултати от търсенето за"} "${searchQuery}"`
                    ) : en ? (
                      "All Prompts"
                    ) : (
                      "Всички примерни въпроси"
                    )
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span>{currentCategoryObj?.[lang]}</span>
                      {currentSubcategoryObj && (
                        <>
                          <span className="text-muted-foreground">›</span>
                          <span className="font-medium text-primary">
                            {currentSubcategoryObj[lang]}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                  {filteredPrompts.length}{" "}
                  {en
                    ? filteredPrompts.length === 1
                      ? "prompt"
                      : "prompts"
                    : filteredPrompts.length === 1
                      ? "въпрос"
                      : "въпроса"}
                </span>
              </div>

              {(selectedCategory !== null || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleSelectAll();
                    setSearchQuery("");
                  }}
                  className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                  {en ? "Show all prompts" : "Покажи всички"}
                </Button>
              )}
            </div>

            {/* Empty state */}
            {filteredPrompts.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <Sparkles className="mx-auto size-8 text-muted-foreground" />
                <h3 className="mt-3 text-base font-semibold text-foreground">
                  {en ? "No prompts found" : "Няма намерени въпроси"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {en
                    ? "Try adjusting your search keywords or topic filter."
                    : "Опитайте с други ключови думи или изберете друга тема."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleSelectAll();
                    setSearchQuery("");
                  }}
                  className="mt-4"
                >
                  {en ? "Clear filters" : "Изчисти филтрите"}
                </Button>
              </div>
            )}

            {/* If viewing all (or search), render grouped by category */}
            {selectedCategory === null && !searchQuery ? (
              <div className="space-y-8">
                {groupedPrompts.map((group) => (
                  <div
                    key={group.category.id}
                    id={`cat-${group.category.id}`}
                    className="scroll-mt-20 space-y-4"
                  >
                    <div className="flex items-center justify-between border-b pb-2">
                      <h2 className="text-lg font-bold text-foreground sm:text-xl">
                        {group.category[lang]}
                      </h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSelectCategory(group.category.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        {en ? "Filter to topic" : "Филтрирай по тази тема"} →
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.subgroups.flatMap((sg) =>
                        sg.prompts.map((starter) => (
                          <PromptCard
                            key={starter.id}
                            starter={starter}
                            lang={lang}
                            en={en}
                            chatBase={chatBase}
                            onLaunch={handleLaunch}
                            onSelectCategory={handleSelectCategory}
                            onSelectSubcategory={handleSelectSubcategory}
                            categoryTitle={group.category[lang]}
                            subcategoryTitle={sg.subcategory[lang]}
                          />
                        )),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Flat grid when filtered */
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredPrompts.map((starter) => {
                  const cat = categoryLookup.get(starter.category);
                  const sub = subcategoryLookup.get(
                    `${starter.category}:${starter.subcategory}`,
                  );
                  return (
                    <PromptCard
                      key={starter.id}
                      starter={starter}
                      lang={lang}
                      en={en}
                      chatBase={chatBase}
                      onLaunch={handleLaunch}
                      onSelectCategory={handleSelectCategory}
                      onSelectSubcategory={handleSelectSubcategory}
                      categoryTitle={cat ? cat[lang] : starter.category}
                      subcategoryTitle={sub ? sub[lang] : starter.subcategory}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </Content>
    </div>
  );
};

interface PromptCardProps {
  starter: Starter;
  lang: "bg" | "en";
  en: boolean;
  chatBase: string;
  categoryTitle: string;
  subcategoryTitle: string;
  onLaunch: (promptText: string) => void;
  onSelectCategory: (catId: string) => void;
  onSelectSubcategory: (catId: string, subId: string) => void;
}

const PromptCard = ({
  starter,
  lang,
  en,
  chatBase,
  categoryTitle,
  subcategoryTitle,
  onLaunch,
  onSelectCategory,
  onSelectSubcategory,
}: PromptCardProps) => {
  const promptText = starter[lang];
  const launchHref = `${chatBase}?q=${encodeURIComponent(promptText)}`;

  return (
    <div
      role="article"
      tabIndex={0}
      data-tool={starter.tool}
      onClick={() => onLaunch(promptText)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLaunch(promptText);
        }
      }}
      className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/50 hover:bg-muted/20 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="space-y-2">
        {/* Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectCategory(starter.category);
            }}
            className="rounded bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary transition-colors"
          >
            {categoryTitle}
          </button>
          <span className="text-muted-foreground text-xs">/</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectSubcategory(starter.category, starter.subcategory);
            }}
            className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
          >
            {subcategoryTitle}
          </button>
        </div>

        {/* Prompt Question */}
        <p className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors sm:text-base">
          {promptText}
        </p>
      </div>

      {/* Launch Action */}
      <div className="mt-3 flex items-center">
        <a
          href={launchHref}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onLaunch(promptText);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-popover-foreground hover:underline"
        >
          <span>{en ? "Try in chat" : "Пробвай в чата"}</span>
          <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </div>
  );
};
