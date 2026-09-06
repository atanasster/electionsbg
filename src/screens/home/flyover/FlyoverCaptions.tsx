// The band's caption, rendered as DOM TEXT — `docs/plans/home-flyover-v1.md` §4 and §8.5.
//
// ⚠️ THE CANVAS NEVER DRAWS BULGARIAN PROSE. The engine emits `{ key, params }` and this
// renders it through `t()`, which is what makes the sentence translatable, selectable,
// copyable, readable by a screen reader and present in the accessibility tree. A string
// painted into a bitmap is none of those.
//
// ⚠️ AND THE ROW IS A FIXED HEIGHT, taken from `box.ts` rather than written here. This text
// changes every few seconds on a page budgeted at CLS < 0.1, above eight destination tiles;
// a row that grew with the caption would move all of them under a reader's cursor.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Caption } from "@/lib/flyover/captions";
import { CAPTION_ROW_CLASS } from "./box";

export const FlyoverCaptions: FC<{ caption: Caption | null }> = ({
  caption,
}) => {
  const { t } = useTranslation();
  return (
    <p
      className={`${CAPTION_ROW_CLASS} leading-snug text-muted-foreground`}
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
