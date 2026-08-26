// The Bulgarian summary, with the English one behind a disclosure.
//
// Why a shared component rather than two copies: the rubric produces
// `summary_bg` AND `summary_en` for every analysed record (365 of 365
// measured 2026-08-26), and there are two places a summary is read — the
// story page and the article page. Written twice, they drift, and the way
// they drift is that one of them quietly stops rendering the English at all.
//
// ⚠️ On the app's LANGUAGE, which this component does not resolve:
// newsapp is Bulgarian-only — `<html lang="bg">`, `Intl` pinned to bg-BG, no
// /en route tree and no hreflang, while the main site is fully bilingual.
// That is an open decision (docs/plans/news-site-v1.md, Tier 5), and this
// component is deliberately the part that is right under EITHER answer: the
// English we already pay a model to produce is reachable, labelled, and not
// mistaken for the primary text.
//
// It is a <details>, not a toggle or a tab, for three reasons: it needs no
// state, it is keyboard- and screen-reader-navigable for free, and it makes
// the English visibly SECONDARY — which is honest, because the corpus, the
// rubric's evidence strings and every label around it are Bulgarian.

/** Why a summary is absent, when we know.
 *
 *  ⚠️ „Липсва" AND „ЗАДЪРЖАНО" ARE DIFFERENT FACTS and must not share a
 *  sentence. The first says the pipeline produced nothing — an upstream
 *  defect nobody chose. The second says we produced one and refused to
 *  publish it, which is a decision a reader is entitled to see stated
 *  rather than left to look like breakage. */
const WITHHELD_NOTE: Record<string, string> = {
  altered_name:
    "Резюмето на български не се показва — изписваше име по начин, " +
    "по който статията не го изписва.",
};

export const SummaryPair = ({
  bg,
  en,
  withheld,
  className = "",
}: {
  bg: string | null | undefined;
  en: string | null | undefined;
  /** field → reason code, from the build. Absent when nothing was withheld. */
  withheld?: Record<string, string> | null;
  className?: string;
}) => {
  const note = withheld?.summary_bg
    ? (WITHHELD_NOTE[withheld.summary_bg] ?? null)
    : null;
  if (!bg && !en && !note) return null;
  return (
    <div className={className}>
      {bg ? <p className="max-w-3xl text-foreground/90">{bg}</p> : null}
      {/* Where the missing Bulgarian WOULD have been, not after the English —
          an English summary with no Bulgarian one is an upstream defect, and
          the note belongs in the gap it explains. */}
      {!bg ? (
        <p className="text-xs text-muted-foreground">
          {note ?? (en ? "Липсва резюме на български." : null)}
        </p>
      ) : null}
      {en ? (
        <details className="mt-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">
            Резюме на английски
          </summary>
          {/* lang on the text itself: a screen reader switching voice for one
              paragraph is the whole reason this attribute exists, and the
              document is lang="bg". */}
          <p className="mt-1.5" lang="en">
            {en}
          </p>
        </details>
      ) : null}
    </div>
  );
};
