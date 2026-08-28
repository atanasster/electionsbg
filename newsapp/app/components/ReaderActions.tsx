import { useEffect, useState } from "react";
import { Bookmark, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readSavedNewsFromBrowser, writeSavedNewsToBrowser } from "./savedNews";
import { newsUrlFor } from "../site";
import { emitNewsEvent } from "../analytics";

export const ReaderActions = ({
  path,
  title,
}: {
  path: string;
  title: string;
}) => {
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
      setMessage("Браузърът не позволи локално запазване.");
      return;
    }
    setSaved(nextSaved);
    emitNewsEvent({
      name: "reader_save",
      content: path.startsWith("/story/") ? "story" : "article",
      saved: nextSaved,
    });
    setMessage(
      nextSaved ? "Запазено в този браузър." : "Премахнато от запазените.",
    );
  };

  const share = async () => {
    const url = newsUrlFor(path);
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
        setMessage("Споделянето е отворено.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: "clipboard",
          outcome: "copied",
        });
        setMessage("Връзката е копирана.");
      } else {
        emitNewsEvent({
          name: "reader_share",
          content: path.startsWith("/story/") ? "story" : "article",
          method: "unavailable",
          outcome: "failed",
        });
        setMessage("Копирайте адреса от адресната лента.");
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
        setMessage("Споделянето не успя.");
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
        {saved ? "Запазено" : "Запази"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void share()}
      >
        <Share2 aria-hidden className="size-4" />
        Сподели
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
