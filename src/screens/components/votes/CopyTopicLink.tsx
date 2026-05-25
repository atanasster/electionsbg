import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Link2 } from "lucide-react";

interface Props {
  date: string;
  // "${itemNo}-${slug}" if a title is present, else bare item-number string.
  slug: string;
}

// Small "copy share URL" button rendered next to an expanded vote item. Reads
// window.location.origin so the copied URL works against the deployed origin
// or localhost — whichever the user happens to be on.
export const CopyTopicLink: FC<Props> = ({ date, slug }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const url = `${window.location.origin}/votes/${date}/item-${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers / non-secure-context fallback: select-and-copy via a
      // hidden textarea. Don't bother — the SPA targets modern Chromium/
      // Firefox/Safari that all support navigator.clipboard.
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          {t("votes_topic_copied") || "Copied"}
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" />
          {t("votes_topic_copy_link") || "Copy link"}
        </>
      )}
    </button>
  );
};
