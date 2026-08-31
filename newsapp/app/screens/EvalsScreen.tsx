import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";

export const EvalsScreen = () => (
  <article className="mx-auto max-w-4xl py-6">
    <header>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Публичен експеримент
      </p>
      <h1 className="mt-1 font-title text-3xl">
        Помогнете да проверим анализите
      </h1>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-foreground/90">
        Всеки може да оцени политическото рамкиране, позицията спрямо Русия и
        отношението към партиите в избрани статии. Не е необходим профил или
        вход.
      </p>
    </header>

    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-title text-xl">Как работи</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-foreground/90">
          <li>Отворете оригиналната публикация и я прочетете.</li>
          <li>Оценете трите групи признаци по публикуваната рубрика.</li>
          <li>Изпратете оценката без регистрация.</li>
        </ol>
      </Card>
      <Card className="p-5">
        <h2 className="font-title text-xl">Как използваме отговорите</h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/90">
          Публичните оценки са обратна връзка, а не гласуване. Те не променят
          автоматично публикувания анализ. Екипът преглежда приноса офлайн,
          преди да приеме поправка или пример за набора за оценяване.
        </p>
      </Card>
    </div>

    <section className="mt-8 rounded-lg border bg-secondary/30 p-5">
      <h2 className="font-title text-xl">Опашка за оценяване</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Публичната опашка и филтрите се подготвят. Междувременно можете да
        прочетете точните определения за всяка оценка в методологията.
      </p>
      <Link
        to="/methodology"
        className="mt-3 inline-block font-medium text-primary underline underline-offset-4"
      >
        Прочетете методологията
      </Link>
    </section>
  </article>
);
