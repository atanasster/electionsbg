// The register of named affairs — plan T3.3. A list, with the same
// statement the case page makes: an editorial selection, not a finding.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCases } from "../data";
import {
  articles as articlesLabel,
  formatDate,
  media as mediaLabel,
  stories as storiesLabel,
} from "../labels";
import { useNewsLocale } from "../i18n";

export const CasesScreen = () => {
  const { language, tr, isEnglish } = useNewsLocale();
  const cases = useCases();
  return (
    <div className="space-y-5">
      <section className="border-b pb-4">
        <p className="app-eyebrow mb-2">{tr("Регистър", "Register")}</p>
        <h1 className="app-page-title">{tr("Казуси", "Cases")}</h1>
        {/* The statement ships IN `cases.json`, in one wording — a build
            without it is a build without cases, so nothing is rendered in
            its place rather than a second wording of it. */}
        {cases.data ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {cases.data.editorial_note[language]}
          </p>
        ) : null}
      </section>
      {cases.error && !cases.data ? (
        <Card className="p-4 text-sm text-destructive">
          {isEnglish
            ? "The register could not be loaded."
            : `Регистърът не се зареди: ${cases.error.message}`}
        </Card>
      ) : !cases.data ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : cases.data.cases.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {tr("Регистърът е празен.", "The register is empty.")}
        </Card>
      ) : (
        <Card className="divide-y p-0">
          {cases.data.cases.map((c) => (
            <div key={c.slug} className="px-4 py-3">
              <Link
                to={`/case/${c.slug}`}
                className="text-sm font-medium hover:underline"
              >
                {c.name[language]}
              </Link>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed">
                {c.description[language]}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tr("от", "since")} {formatDate(c.opened_on, language)}
                {c.membership === "attached"
                  ? ` · ${storiesLabel(c.story_count, language)} · ${articlesLabel(c.article_count, language)} · ${mediaLabel(Object.keys(c.outlets).length, language)}`
                  : ` · ${tr("хронологията не се публикува (правилото е в преглед)", "timeline not published (rule under review)")}`}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};
