import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLatest, useStories } from "../data";
import {
  readSavedNewsFromBrowser,
  writeSavedNewsToBrowser,
} from "../components/savedNews";

const labelFor = (
  path: string,
  storyTitles: Map<string, string>,
  articleTitles: Map<string, string>,
): string => {
  const story = path.match(/^\/story\/([^/]+)$/);
  if (story)
    return storyTitles.get(story[1]) ?? "История, която вече не е налична";
  const article = path.match(/^\/article\/([^/]+)\/([^/]+)$/);
  if (article)
    return (
      articleTitles.get(path) ??
      `Материал ${article[2].slice(-8)} от ${article[1]}`
    );
  return "Запазена страница";
};

export const SavedScreen = ({
  persistSaved = writeSavedNewsToBrowser,
}: {
  persistSaved?: (paths: string[]) => boolean;
}) => {
  const stories = useStories();
  const latest = useLatest();
  const [paths, setPaths] = useState(readSavedNewsFromBrowser);
  const [message, setMessage] = useState("");
  const storyTitles = new Map(
    (stories.data?.stories ?? []).map((story) => [
      story.id,
      story.title_bg ?? story.title_en ?? "История без заглавие",
    ]),
  );
  const articleTitles = new Map(
    (latest.data?.articles ?? []).map((article) => [
      `/article/${article.domain}/${article.id}`,
      article.title ?? `Материал ${article.id.slice(-8)} от ${article.domain}`,
    ]),
  );
  const persist = (next: string[]) => {
    if (persistSaved(next)) {
      setPaths(next);
      setMessage("");
    } else {
      setMessage("Браузърът не позволи промяната на запазените.");
    }
  };

  return (
    <section className="space-y-5">
      <header>
        <h1 className="font-title text-3xl">Запазени</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Този списък остава само в този браузър. Не се изпраща към сървър и не
          се синхронизира между устройства.
        </p>
      </header>
      {paths.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Още няма запазени истории или статии.
        </Card>
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card px-4">
            {paths.map((path) => {
              const label = labelFor(path, storyTitles, articleTitles);
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
                    aria-label={`Премахни ${label}`}
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
            Изчисти всички
          </Button>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm text-destructive">
        {message}
      </p>
    </section>
  );
};
