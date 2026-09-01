import { useEffect, useState } from "react";
import { Bookmark, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readSavedNewsFromBrowser, writeSavedNewsToBrowser } from "./savedNews";
import { newsUrlFor } from "../site";
import { emitNewsEvent } from "../analytics";
import { newsPathForLanguage, useNewsLocale } from "../i18n";

export const ReaderActions = ({
  path,
  title,
}: {
  path: string;
  title: string;
}) => {
  const { language, tr } = useNewsLocale();
  const [saved, setSaved] = useState(() => {
    return readSavedNewsFromBrowser().includes(path);
  });
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSaved(readSavedNewsFromBrowser().includes(path));
    setMessage("");
  }, [path]);

  const toggleSaved = () => {
    const paths = readSavedNewsFromBrowser();
    const nextSaved = !paths.includes(path);
    const next = nextSaved
      ? [path, ...paths]
      : paths.filter((item) => item !== path);
    if (!writeSavedNewsToBrowser(next)) {
      setMessage(
        tr(
          "Браузърът не позволи локално запазване.",
          "The browser did not allow local saving.",
        ),
      );
      return;
    }
    setSaved(nextSaved);
    emitNewsEvent({
      name: "reader_save",
      content: path.startsWith("/story/") ? "story" : "article",
      saved: nextSaved,
    });
    setMessage(
      nextSaved
        ? tr("Запазено в този браузър.", "Saved in this browser.")
        : tr("Премахнато от запазените.", "Removed from saved items."),
    );
  };

  const share = async () => {
    const url = newsUrlFor(newsPathForLanguage(path, language));
    const attemptedMethod =
      typeof navigator.share === "function" ? "native" : "clipboard";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: "native",
          outcome: "opened",
        });
        setMessage(tr("Споделянето е отворено.", "Sharing opened."));
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: "clipboard",
          outcome: "copied",
        });
        setMessage(tr("Връзката е копирана.", "Link copied."));
      } else {
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: "unavailable",
          outcome: "failed",
        });
        setMessage(
          tr(
            "Копирайте адреса от адресната лента.",
            "Copy the address from the address bar.",
          ),
        );
      }
    } catch (error) {
      if (
        attemptedMethod === "native" &&
        (error as DOMException)?.name === "AbortError"
      ) {
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: "native",
          outcome: "cancelled",
        });
      } else {
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: attemptedMethod,
          outcome: "failed",
        });
        setMessage(tr("Споделянето не успя.", "Sharing failed."));
      }
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={saved}
        onClick={toggleSaved}
      >
        {saved ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Bookmark aria-hidden className="size-4" />
        )}
        {saved ? tr("Запазено", "Saved") : tr("Запази", "Save")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void share()}
      >
        <Share2 aria-hidden className="size-4" />
        {tr("Сподели", "Share")}
      </Button>
      <span
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        {message}
      </span>
    </div>
  );
};
