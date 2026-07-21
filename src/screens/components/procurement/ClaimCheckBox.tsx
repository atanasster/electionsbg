// "Провери твърдение" — the fact-check on-ramp on /procurement (§0g.4 / §4.3b).
// A distinct gesture from "build a dossier": the citizen pastes a sentence from
// the news, we keyword-extract the object/firm (claimSeed.ts, no AI in v1) and
// land on the dossier whose honesty block answers the specific figure.
// Bilingual-inline, matching the rest of the project-file feature.

import { FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import {
  projectFromClaim,
  extractClaimTerms,
} from "@/data/procurement/claimSeed";
import { projectHref } from "@/data/procurement/projectStore";

export const ClaimCheckBox: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const navigate = useNavigate();
  const [text, setText] = useState("");

  // The distinctive terms we'd search — also gates the button and previews what
  // the dossier will track, so the extraction isn't a black box.
  const terms = useMemo(() => extractClaimTerms(text), [text]);

  const submit = () => {
    const spec = projectFromClaim(text);
    if (spec) navigate(projectHref(spec));
  };

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <ShieldQuestion className="h-4 w-4 text-primary" />
        {bg
          ? "Провери твърдение за обществена поръчка"
          : "Fact-check a procurement claim"}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {bg
          ? "Постави изречение от новина — ще извлечем обекта и ще сглобим досие, чиито числа отговарят на твърдението."
          : "Paste a sentence from the news — we extract the object and assemble a file whose numbers answer the claim."}
      </p>
      <textarea
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
        rows={2}
        value={text}
        aria-label={bg ? "Твърдение за проверка" : "Claim to fact-check"}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          bg
            ? "напр. Видин–Ботевград взе 35% аванс и нищо не е построено"
            : "e.g. Vidin–Botevgrad took a 35% advance and nothing was built"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {terms
            ? `${bg ? "Ще проследим" : "We'll track"}: „${terms}"`
            : bg
              ? "Въведи твърдение"
              : "Enter a claim"}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!terms}
          className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
        >
          {bg ? "Провери" : "Check"}
        </button>
      </div>
    </div>
  );
};
