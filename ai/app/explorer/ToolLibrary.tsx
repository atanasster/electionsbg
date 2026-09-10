import { useState } from "react";
import { Search, ChevronRight, Wrench, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      className="min-w-0 space-y-4 rounded-xl border border-border bg-background p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="size-4" />
          {bg ? "Инструменти" : "Tools"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
          {LIBRARY.length}
        </span>
      </div>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
        />
        <Input
          className="h-11 pl-9"
          aria-label={bg ? "Търсене на инструмент" : "Search tools"}
          placeholder={
            bg ? "Въпрос, тема или инструмент…" : "Question, topic or tool…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={!recentOnly ? "secondary" : "ghost"}
          aria-pressed={!recentOnly}
          onClick={() => setRecentOnly(false)}
        >
          {bg ? "Всички" : "All"}
        </Button>
        <Button
          size="sm"
          variant={recentOnly ? "secondary" : "ghost"}
          aria-pressed={recentOnly}
          onClick={() => setRecentOnly(true)}
        >
          {bg ? "Последни" : "Recent"}
        </Button>
      </div>
      <label className="block text-xs font-medium text-muted-foreground">
        {bg ? "Тема" : "Topic"}
        <select
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
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
                filterLibrary(query, c.id, "", recentOnly ? recent : undefined)
                  .length
              }
              )
            </option>
          ))}
        </select>
      </label>
      {category && (
        <label className="block text-xs font-medium text-muted-foreground">
          {bg ? "Подтема" : "Subtopic"}
          <select
            className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
          >
            <option value="">{bg ? "Всички подтеми" : "All subtopics"}</option>
            {QUESTION_CATEGORIES.find((c) => c.id === category)
              ?.subcategories.filter((s) =>
                LIBRARY.some(
                  (e) => e.categoryId === category && e.subcategoryId === s.id,
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
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span role="status">
          {entries.length} {bg ? "инструмента" : "tools"}
        </span>
        {(query || category || recentOnly) && (
          <button
            className="underline"
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
        {entries.map((entry) => (
          <li key={entry.tool.name}>
            <button
              aria-current={
                !sql && selected === entry.tool.name ? "true" : undefined
              }
              onClick={() => onSelect(entry.tool.name)}
              className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${!sql && selected === entry.tool.name ? "border-primary/30 bg-primary/10 font-semibold text-foreground" : "border-transparent hover:bg-muted"}`}
            >
              <span>{entry.title[lang]}</span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
      {!entries.length && (
        <p className="py-5 text-sm text-muted-foreground">
          {bg
            ? "Няма съвпадения. Опитайте друга дума или изчистете филтрите."
            : "No matches. Try another word or clear the filters."}
        </p>
      )}
      <div className="border-t border-border pt-3">
        <Button
          variant={sql ? "secondary" : "ghost"}
          className="h-auto min-h-11 w-full justify-start whitespace-normal"
          onClick={onSql}
        >
          <Database className="size-4 shrink-0" />
          {bg
            ? "Още въпроси в браузъра за данни"
            : "More questions in the data browser"}
        </Button>
      </div>
    </aside>
  );
};
