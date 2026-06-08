// A small reusable "share to Facebook" button. Defaults to sharing the
// current page; pass `url` to share a specific page. Uses the shared
// openFacebookShare helper so the sharer behaviour stays consistent.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { openFacebookShare } from "@/lib/community";

type Props = {
  url?: string;
  label?: string;
  className?: string;
};

export const ShareButton: FC<Props> = ({ url, label, className }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => openFacebookShare(url ?? window.location.href)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Share2 className="size-4" />
      {label ?? t("share_action")}
    </button>
  );
};
