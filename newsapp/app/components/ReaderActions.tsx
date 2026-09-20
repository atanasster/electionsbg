import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage("");
  }, [path]);

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
