import { useState } from "react";
import { Search, ChevronRight, Wrench, Database, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Lang } from "../../tools/types";
import { filterLibrary, LIBRARY, QUESTION_CATEGORIES } from "./library";

export const ToolLibrary = ({
  lang,
  selected,
  recent,
  onSelect,
  sql,
  onSql,
}: {
  lang: Lang;
  selected?: string;
  recent: string[];
  onSelect: (name: string) => void;
  sql: boolean;
  onSql: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  const bg = lang === "bg";
  const entries = filterLibrary(
    query,
    category,
    subcategory,
    recentOnly ? recent : undefined,
  );
  const categories = QUESTION_CATEGORIES.filter((c) =>
    LIBRARY.some((e) => e.categoryId === c.id),
  );
  return (
    <aside
      aria-label={bg ? "Каталог инструменти" : "Tool library"}
      className="min-w-0 space-y-3.5 rounded-xl border border-border bg-card p-3.5 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto"
    >
      <div className="mb-3 flex items-center justify-between border-b pb-2 px-1">
        <span className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Wrench className="size-4 text-primary" />
          {bg ? "Инструменти" : "Tools"}
        </span>
        <span className="text-xs text-muted-foreground">
          {LIBRARY.length} {bg ? "инструмента" : "tools"}
        </span>
      </div>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="h-9 pl-9 pr-8 text-sm"
          aria-label={bg ? "Търсене на инструмент" : "Search tools"}
          placeholder={
            bg ? "Въпрос, тема или инструмент…" : "Question, topic or tool…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label={bg ? "Изчисти търсенето" : "Clear search"}
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5" role="group">
        <button
          type="button"
          aria-pressed={!recentOnly}
          onClick={() => setRecentOnly(false)}
          className={cn(
            "flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition-colors",
            !recentOnly
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {bg ? "Всички" : "All"}
        </button>
        <button
          type="button"
          aria-pressed={recentOnly}
          onClick={() => setRecentOnly(true)}
          className={cn(
            "flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition-colors",
            recentOnly
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {bg ? "Последни" : "Recent"}
        </button>
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">
          <span>{bg ? "Тема" : "Topic"}</span>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubcategory("");
            }}
          >
            <option value="">
              {bg ? "Всички теми" : "All topics"} (
              {
                filterLibrary(query, "", "", recentOnly ? recent : undefined)
                  .length
              }
              )
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label[lang]} (
                {
                  filterLibrary(
                    query,
                    c.id,
                    "",
                    recentOnly ? recent : undefined,
                  ).length
                }
                )
              </option>
            ))}
          </select>
        </label>
        {category && (
          <label className="block text-xs font-medium text-muted-foreground">
            <span>{bg ? "Подтема" : "Subtopic"}</span>
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
            >
              <option value="">
                {bg ? "Всички подтеми" : "All subtopics"}
              </option>
              {QUESTION_CATEGORIES.find((c) => c.id === category)
                ?.subcategories.filter((s) =>
                  LIBRARY.some(
                    (e) =>
                      e.categoryId === category && e.subcategoryId === s.id,
                  ),
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label[lang]} (
                    {
                      filterLibrary(
                        query,
                        category,
                        s.id,
                        recentOnly ? recent : undefined,
                      ).length
                    }
                    )
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span role="status">
          {entries.length} {bg ? "инструмента" : "tools"}
        </span>
        {(query || category || recentOnly) && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => {
              setQuery("");
              setCategory("");
              setSubcategory("");
              setRecentOnly(false);
            }}
          >
            {bg ? "Изчисти" : "Clear"}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {entries.map((entry) => {
          const isActive = !sql && selected === entry.tool.name;
          return (
            <li key={entry.tool.name}>
              <button
                data-tool-id={entry.tool.name}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelect(entry.tool.name)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <span className="truncate">{entry.title[lang]}</span>
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
      {!entries.length && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {bg
            ? "Няма съвпадения. Опитайте друга дума или изчистете филтрите."
            : "No matches. Try another word or clear the filters."}
        </p>
      )}
      <div className="border-t border-border/80 pt-3">
        <button
          type="button"
          onClick={onSql}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            sql
              ? "bg-primary/15 font-semibold text-primary"
              : "text-foreground hover:bg-muted",
          )}
        >
          <Database
            className={cn(
              "size-4 shrink-0",
              sql ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className="truncate">
            {bg
              ? "Още въпроси в браузъра за данни"
              : "More questions in the data browser"}
          </span>
        </button>
      </div>
    </aside>
  );
};
