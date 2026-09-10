import { ArrowUpRight } from "lucide-react";
import type { Lang, ToolArgs } from "../../tools/types";
import { toChatQuestionIntent } from "../questionAdapter";
import { LIBRARY, QUESTION_CATEGORIES, WELCOME_IDS } from "./library";
export const WelcomeGallery = ({
  lang,
  onSelect,
}: {
  lang: Lang;
  onSelect: (name: string, args: ToolArgs) => void;
}) => (
  <section className="space-y-6 py-3 lg:px-4">
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-popover-foreground">
        {lang === "bg" ? "Започнете от въпрос" : "Start with a question"}
      </p>
      <h2 className="mt-3 font-title text-3xl">
        {lang === "bg"
          ? "Какво искате да проверите?"
          : "What would you like to explore?"}
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        {lang === "bg"
          ? "Изберете пример или намерете инструмент в каталога. Настройте въпроса и вижте резултата с неговите източници."
          : "Choose an example or find a tool in the library. Adjust the inputs and see the result with its sources."}
      </p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {WELCOME_IDS.map((id) => {
        const entry = LIBRARY.find((e) => e.tool.name === id)!;
        const q = entry.questions[0];
        return (
          <button
            key={id}
            className="group flex min-h-40 flex-col justify-between rounded-xl border border-border bg-background p-5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              const intent = toChatQuestionIntent(q.id, lang);
              onSelect(id, intent.args);
            }}
          >
            <span className="text-xs text-muted-foreground">
              {
                QUESTION_CATEGORIES.find((c) => c.id === entry.categoryId)
                  ?.label[lang]
              }
            </span>
            <span className="my-4 text-base font-medium leading-snug">
              {q.question[lang]}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-popover-foreground">
              {lang === "bg" ? "Зареди пример" : "Load example"}
              <ArrowUpRight className="size-3.5" />
            </span>
          </button>
        );
      })}
    </div>
    <p className="text-xs text-muted-foreground">
      {lang === "bg"
        ? "Изчисления от наличните данни. Всеки резултат показва своя обхват и източници."
        : "Calculations from available data. Each result shows its coverage and sources."}
    </p>
  </section>
);
