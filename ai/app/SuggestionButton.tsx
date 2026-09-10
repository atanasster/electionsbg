import type { Suggestion } from "./suggestions";
import type { Lang } from "../tools/types";

export const SuggestionButton = ({
  suggestion,
  lang,
  onPick,
}: {
  suggestion: Suggestion;
  lang: Lang;
  onPick: (suggestion: Suggestion) => void;
}) => (
  <button
    type="button"
    onMouseDown={(event) => event.preventDefault()}
    onClick={() => onPick(suggestion)}
    className="block w-full px-3 py-2.5 text-left hover:bg-muted sm:py-1.5"
  >
    {suggestion[lang]}
  </button>
);
