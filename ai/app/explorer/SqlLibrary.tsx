import { useState } from "react";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { ArrowUpRight, Database } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SQL_QUESTION_DEFINITIONS } from "../../../src/lib/questions/sql/catalog";
import { sqlQuestionHref } from "../../../src/lib/questions/sql/url";
import { QUESTION_CATEGORIES } from "../../../src/lib/questions/catalog";
import { searchQuestions } from "../../../src/lib/questions/selector/model";
import type { Lang } from "../../tools/types";
export default function SqlLibrary({ lang }: { lang: Lang }) {
  const [query, setQuery] = useState("");
  const questions = query.trim()
    ? searchQuestions(
        {
          categories: QUESTION_CATEGORIES,
          questions: SQL_QUESTION_DEFINITIONS,
        },
        "sql",
        lang,
        query,
      )
    : SQL_QUESTION_DEFINITIONS;
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-title text-2xl">
        <Database className="size-5" />
        {lang === "bg" ? "Браузър за данни" : "Data browser"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {lang === "bg"
          ? "Тези въпроси са налични като SQL справки. Отворете пример в браузъра за данни, където можете да промените параметрите и да го изпълните."
          : "These questions are available as SQL queries. Open an example in the data browser to adjust its parameters and run it."}
      </p>
      <Input
        aria-label={
          lang === "bg" ? "Търсене на SQL въпрос" : "Search SQL questions"
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p role="status" className="text-xs text-muted-foreground">
        {questions.length} {lang === "bg" ? "въпроса" : "questions"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => (
          <a
            key={q.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-4 text-sm hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href={`${SITE_ORIGIN}${sqlQuestionHref(q.id, {})}`}
          >
            <span>
              {q.question[lang]}
              <span className="mt-2 block text-xs text-muted-foreground">
                SQL · {lang === "bg" ? "Отвори пример" : "Open example"}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0" />
          </a>
        ))}
      </div>
      {!questions.length && (
        <p>
          {lang === "bg"
            ? "Няма съвпадения. Опитайте друга дума."
            : "No matches. Try another word."}
        </p>
      )}
    </section>
  );
}
