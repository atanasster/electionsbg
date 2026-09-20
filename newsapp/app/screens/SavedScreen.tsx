// ⚠️⚠️ UNREACHABLE ON PURPOSE, AND NOT DEAD CODE. The „Запазени" nav entry,
// the /saved route, its prerendered page and the „Запази" button were all
// withdrawn (2026-09-21) because saving wrote to ONE BROWSER: a reader who
// cleared site data, or opened the site anywhere else, lost the list with
// nothing saying so. This module is kept intact for the account-backed
// version — restoring it is re-adding the route and the button, not
// rewriting the storage layer. `ReaderActions.test.tsx` asserts the button
// stays absent until then.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLatest, useStoryTitles } from "../data";
import {
  readSavedNewsFromBrowser,
  savedStoryIds,
  writeSavedNewsToBrowser,
} from "../components/savedNews";
import { useNewsLocale, type NewsLanguage } from "../i18n";

const labelFor = (
  path: string,
  storyTitles: Map<string, string | "gone" | "failed">,
  articleTitles: Map<string, string>,
  language: NewsLanguage,
): string => {
  const story = path.match(/^\/story\/([^/]+)$/);
  if (story) {
    // ⚠️ FOUR STATES, AND EACH READS DIFFERENTLY TO A PERSON. `undefined`
    // is still loading; `"gone"` is a story the release retired (they
    // merge, so a saved id can stop being a story); `"failed"` is a
    // request that did not land. Collapsing loading into gone tells a
    // reader their saved item has disappeared every time the page opens,
    // and collapsing FAILED into gone tells an offline reader that every
    // story they saved has been merged away.
    const title = storyTitles.get(story[1]);
    if (title === undefined)
      return language === "bg" ? "Зарежда се…" : "Loading…";
    if (title === "gone")
      return language === "bg"
        ? "Историята вече не е отделна"
        : "No longer a separate story";
    if (title === "failed")
      return language === "bg"
        ? "Заглавието не можа да се зареди"
        : "Title could not be loaded";
    return title;
  }
  const article = path.match(/^\/article\/([^/]+)\/([^/]+)$/);
  if (article)
    return (
      articleTitles.get(path) ??
      (language === "bg"
        ? `Материал ${article[2].slice(-8)} от ${article[1]}`
        : `Article ${article[2].slice(-8)} from ${article[1]}`)
    );
  return language === "bg" ? "Запазена страница" : "Saved page";
};

export const SavedScreen = ({
  persistSaved = writeSavedNewsToBrowser,
}: {
  persistSaved?: (paths: string[]) => boolean;
}) => {
  const { language, tr } = useNewsLocale();
  const latest = useLatest();
  const [paths, setPaths] = useState(readSavedNewsFromBrowser);
  const [message, setMessage] = useState("");
  // ⚠️ ONE ~1.4 KB FILE PER SAVED STORY, not the 1,456 KB corpus this
  // screen used to download to read a handful of titles — it was the last
  // screen still doing so. Twenty saves is ~28 KB, and any story the
  // reader has opened is already cached.
  const ids = useMemo(() => savedStoryIds(paths), [paths]);
  const saved = useStoryTitles(ids);
  const storyTitles = new Map<string, string | "gone" | "failed">(
    [...saved.titles].map(([id, story]) => [
      id,
      typeof story === "string"
        ? story
        : ((language === "bg" ? story.title_bg : story.title_en) ??
          tr("История без заглавие", "Untitled story")),
    ]),
  );
  const articleTitles = new Map(
    (latest.data?.articles ?? []).map((article) => [
      `/article/${article.domain}/${article.id}`,
      article.title ??
        tr(
          `Материал ${article.id.slice(-8)} от ${article.domain}`,
          `Article ${article.id.slice(-8)} from ${article.domain}`,
        ),
    ]),
  );
  const persist = (next: string[]) => {
    if (persistSaved(next)) {
      setPaths(next);
      setMessage("");
    } else {
      setMessage(
        tr(
          "Браузърът не позволи промяната на запазените.",
          "The browser did not allow saved items to be changed.",
        ),
      );
    }
  };

  return (
    <section className="space-y-5">
      <header>
        <h1 className="app-page-title">{tr("Запазени", "Saved")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {tr(
            "Този списък остава само в този браузър. Не се изпраща към сървър и не се синхронизира между устройства.",
            "This list stays in this browser. It is not sent to a server or synchronized across devices.",
          )}
        </p>
      </header>
      {paths.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          {tr(
            "Още няма запазени истории или статии.",
            "No stories or articles have been saved yet.",
          )}
        </Card>
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card px-4">
            {paths.map((path) => {
              const label = labelFor(
                path,
                storyTitles,
                articleTitles,
                language,
              );
              return (
                <li
                  key={path}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <Link
                    to={path}
                    className="min-w-0 font-medium hover:text-primary"
                  >
                    {label}
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${tr("Премахни", "Remove")} ${label}`}
                    onClick={() =>
                      persist(paths.filter((item) => item !== path))
                    }
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button type="button" variant="outline" onClick={() => persist([])}>
            {tr("Изчисти всички", "Clear all")}
          </Button>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm text-destructive">
        {message}
      </p>
    </section>
  );
};
