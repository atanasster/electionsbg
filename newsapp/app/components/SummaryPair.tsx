// The summary in the page language — never both translations together.
//
// Why a shared component rather than two copies: the rubric produces
// `summary_bg` AND `summary_en` for every analysed record, and there are two
// places a summary is read — the story page and the article page. Written
// twice, they drift. Rendering both on one page also makes the language
// switch redundant and forces every reader through duplicate prose.
//
// The locale context chooses exactly one sibling. Missing selected-language
// copy stays visibly missing rather than falling through to the other
// language, because that fallthrough recreates the mixed-language page this
// component exists to prevent.

import { useNewsLocale } from "../i18n";

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
const WITHHELD_NOTE_EN: Record<string, string> = {
  altered_name:
    "The English summary is not shown because it spelled a name differently from the article.",
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
  const { language, tr } = useNewsLocale();
  const selected = language === "en" ? en : bg;
  const field = language === "en" ? "summary_en" : "summary_bg";
  const notes = language === "en" ? WITHHELD_NOTE_EN : WITHHELD_NOTE;
  const note = withheld?.[field] ? (notes[withheld[field]] ?? null) : null;
  const otherLanguageExists = Boolean(language === "en" ? bg : en);
  if (!selected && !note && !otherLanguageExists) return null;
  return (
    <div className={className}>
      {selected ? (
        <p className="max-w-3xl text-foreground/90" lang={language}>
          {selected}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {note ??
            tr("Липсва резюме на български.", "English summary unavailable.")}
        </p>
      )}
    </div>
  );
};
