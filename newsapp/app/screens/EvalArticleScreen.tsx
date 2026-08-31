import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const EvalArticleScreen = () => {
  const { domain = "", id = "" } = useParams();
  const articlePath =
    domain && id
      ? `/article/${encodeURIComponent(domain)}/${encodeURIComponent(id)}`
      : "/evals";

  return (
    <article className="mx-auto max-w-4xl py-2">
      <Breadcrumbs
        items={[{ label: "Оценяване", to: "/evals" }, { label: "Статия" }]}
      />
      <header className="mt-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Публичен експеримент · без регистрация
        </p>
        <h1 className="mt-1 font-title text-3xl">Оценяване на статия</h1>
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-foreground/90">
          Тази страница е публично работно пространство. Подаването на оценка
          няма да изисква профил или вход.
        </p>
      </header>

      <Card className="mt-8 p-5">
        <h2 className="font-title text-xl">Преди да оцените</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          Прегледайте публичната страница на материала и отворете оригиналния
          източник от нея. Формулярът ще показва само вече публикувани метаданни
          и няма да препубликува пълния текст на статията.
        </p>
        <Link
          to={articlePath}
          className="mt-4 inline-block font-medium text-primary underline underline-offset-4"
        >
          Към публичната страница на статията
        </Link>
      </Card>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Формулярът и задачата за тази статия се зареждат само когато материалът
        е включен в текущата публична опашка за оценяване.
      </p>
    </article>
  );
};
