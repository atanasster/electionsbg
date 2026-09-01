import { Link } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { correctionIssueUrl } from "../corrections";

interface ArticleContributionCardProps {
  articlePath: string;
  evaluationPath: string | null;
  hasAnalysis: boolean;
}

/**
 * Universal contribution entry point for one article.
 *
 * The structured evaluator is shown when the article belongs to an active
 * evaluation task. Every other article still gets an article-bound intake
 * path while the broader structured feedback contract is rolled out.
 */
export const ArticleContributionCard = ({
  articlePath,
  evaluationPath,
  hasAnalysis,
}: ArticleContributionCardProps) => (
  <Card className="mt-6 border-primary/30 bg-primary/5 p-4">
    <div className="flex items-start gap-3">
      <MessageSquarePlus
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-primary"
      />
      <div className="min-w-0">
        <h2 className="font-title text-xl">
          {hasAnalysis
            ? "Проверете и допълнете анализа"
            : "Предложете първа оценка"}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Можете да предложите политическо рамкиране или липсваща връзка към
          официално лице, партия, населено място, институция или сектор. Всеки
          принос се преглежда преди да промени публикуваното съдържание.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {evaluationPath ? (
            <Button asChild>
              <Link to={evaluationPath}>Оценете тази статия</Link>
            </Button>
          ) : null}
          <Button
            asChild
            variant={evaluationPath ? "outline" : "default"}
            className="h-auto min-h-11 w-full max-w-full whitespace-normal py-2 text-center sm:min-h-9 sm:w-auto"
          >
            <a
              href={correctionIssueUrl(articlePath)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Добавете липсващ анализ или връзка
              <span className="sr-only"> (отваря се в нов раздел)</span>
            </a>
          </Button>
        </div>
      </div>
    </div>
  </Card>
);
