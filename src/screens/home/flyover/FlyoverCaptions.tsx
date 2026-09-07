// The band's caption, rendered as DOM TEXT — `docs/plans/home-flyover-v1.md` §4 and §8.5.
//
// ⚠️ THE CANVAS NEVER DRAWS BULGARIAN PROSE. The engine emits `{ key, params }` and this
// renders it through `t()`, which is what makes the sentence translatable, selectable,
// copyable, readable by a screen reader and present in the accessibility tree. A string
// painted into a bitmap is none of those.
//
// The home thumbnail keeps this description available to assistive technology. Visible
// explanatory copy lives in the full article, reached by the preview's link.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Caption } from "@/lib/flyover/captions";

export const FlyoverCaptions: FC<{ caption: Caption | null }> = ({
  caption,
}) => {
  const { t } = useTranslation();
  return (
    <p
      className="sr-only"
      // Announced as one unit when it changes, and only when the reader is idle: this is a
      // decorative band, so interrupting a screen reader mid-sentence would be worse than
      // saying nothing.
      aria-live="polite"
      aria-atomic="true"
      data-flyover-caption={caption?.key ?? ""}
    >
      {caption ? t(caption.key, caption.params) : ""}
    </p>
  );
};
