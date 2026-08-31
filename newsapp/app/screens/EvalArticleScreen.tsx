import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Breadcrumbs } from "../components/Breadcrumbs";
import {
  EVAL_LEANING_VALUES,
  EVAL_RUSSIA_VALUES,
  EVAL_TONE_VALUES,
  useEvalQueue,
  type EvalTask,
} from "../evals";
import { useOutletArticles, type Tone } from "../data";
import {
  formatDateTime,
  LEANING_META,
  RUSSIA_META,
  TONE_META,
} from "../labels";

type PartyDraft = {
  key: string;
  party: string;
  partyId: string | null;
  tone: Tone | "";
};

const ChoiceGroup = <Value extends string>({
  legend,
  name,
  value,
  choices,
  onChange,
}: {
  legend: string;
  name: string;
  value: Value | "";
  choices: Array<{ value: Value | "unable"; label: string }>;
  onChange: (value: Value | "unable") => void;
}) => (
  <fieldset>
    <legend className="font-title text-lg">{legend}</legend>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {choices.map((choice) => (
        <label
          key={choice.value}
          className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
        >
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const taskParties = (task: EvalTask): PartyDraft[] =>
  task.model_labels.party_tones.map((item, index) => ({
    key: item.party_id ?? `model-${index}-${item.party}`,
    party: item.party,
    partyId: item.party_id,
    tone: "",
  }));

export const EvalArticleScreen = () => {
  const { domain = "", id = "" } = useParams();
  const queue = useEvalQueue();
  const articles = useOutletArticles(domain || null);
  const task = useMemo(
    () =>
      queue.data?.tasks.find(
        (item) => item.domain === domain && item.article_id === id,
      ) ?? null,
    [queue.data?.tasks, domain, id],
  );
  const article =
    articles.data?.articles.find((item) => item.id === id) ?? null;
  const [leaning, setLeaning] = useState<string>("");
  const [russia, setRussia] = useState<string>("");
  const [parties, setParties] = useState<PartyDraft[]>([]);
  const [noParty, setNoParty] = useState(false);
  const [newParty, setNewParty] = useState("");

  useEffect(() => {
    setLeaning("");
    setRussia("");
    setParties(task ? taskParties(task) : []);
    setNoParty(false);
    setNewParty("");
  }, [task]);

  if ((queue.loading && !queue.data) || (articles.loading && !articles.data)) {
    return (
      <section className="py-6">
        <Skeleton className="h-8 w-2/3" />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-[32rem] rounded-xl" />
        </div>
      </section>
    );
  }

  if (queue.error && !queue.data) {
    return (
      <Card className="mx-auto max-w-3xl p-6">
        <h1 className="font-title text-3xl">Задачата не се зареди</h1>
        <p className="mt-2 text-muted-foreground">
          Публичната опашка временно не е достъпна. Не е изпратена оценка.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/evals">Към опашката</Link>
        </Button>
      </Card>
    );
  }

  if (!task) {
    return (
      <Card className="mx-auto max-w-3xl p-6">
        <h1 className="font-title text-3xl">Статията не е в текущата опашка</h1>
        <p className="mt-2 text-muted-foreground">
          Оценяване се приема само за задачите в текущата публична извадка.
        </p>
        <Button asChild className="mt-4">
          <Link to="/evals">Изберете друга статия</Link>
        </Button>
      </Card>
    );
  }

  const addParty = () => {
    const party = newParty.trim();
    if (!party || parties.some((item) => item.party === party)) return;
    setParties((current) => [
      ...current,
      { key: `added-${party}`, party, partyId: null, tone: "" },
    ]);
    setNewParty("");
    setNoParty(false);
  };
  const completed =
    Number(Boolean(leaning)) +
    Number(Boolean(russia)) +
    Number(
      noParty || (parties.length > 0 && parties.every((party) => party.tone)),
    );

  return (
    <article className="mx-auto max-w-7xl py-2">
      <Breadcrumbs
        items={[{ label: "Оценяване", to: "/evals" }, { label: "Статия" }]}
      />
      <header className="mt-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Публичен експеримент · без регистрация
        </p>
        <h1 className="mt-1 max-w-4xl font-title text-3xl leading-tight sm:text-4xl">
          {task.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{task.outlet}</span>
          <span>·</span>
          <time dateTime={task.published ?? undefined}>
            {formatDateTime(task.published)}
          </time>
          {task.primary_topic ? (
            <Badge variant="secondary">{task.primary_topic}</Badge>
          ) : null}
        </div>
      </header>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] lg:items-start">
        <section
          className="min-w-0 space-y-4"
          aria-labelledby="context-heading"
        >
          <Card className="p-5">
            <h2 id="context-heading" className="font-title text-xl">
              Публичен контекст
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Прочетете оригиналната публикация преди да оцените. Пълният текст
              остава при издателя и не се копира в тази форма.
            </p>
            {articles.error && !articles.data ? (
              <p className="mt-4 text-sm text-destructive" role="status">
                Публичният откъс не се зареди. Можете да продължите към
                оригиналната публикация.
              </p>
            ) : article?.excerpt ? (
              <p className="mt-4 border-l-2 border-border pl-4 text-base italic leading-relaxed text-foreground/90">
                {article.excerpt}
              </p>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Няма публикуван откъс за този материал.
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild>
                <a href={task.url} target="_blank" rel="noreferrer">
                  Прочети оригинала <ExternalLink aria-hidden />
                </a>
              </Button>
              <Button asChild variant="outline">
                <Link
                  to={`/article/${encodeURIComponent(domain)}/${encodeURIComponent(id)}`}
                >
                  Публична страница на анализа
                </Link>
              </Button>
            </div>
          </Card>
          <Card className="p-5 text-sm leading-relaxed text-muted-foreground">
            <h2 className="font-title text-lg text-foreground">Важно</h2>
            <p className="mt-2">
              Това не е гласуване. Вашият отговор става необработена обществена
              обратна връзка и не променя автоматично публикуваната оценка.
            </p>
          </Card>
        </section>

        <form
          className="min-w-0"
          onSubmit={(event) => event.preventDefault()}
          aria-labelledby="evaluation-heading"
        >
          <Card className="space-y-7 p-5 lg:sticky lg:top-28">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="evaluation-heading" className="font-title text-2xl">
                  Вашата оценка
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Избрани раздели: {completed} от 3
                </p>
              </div>
              <Badge variant="outline">моделът е скрит</Badge>
            </div>

            <ChoiceGroup
              legend="Политическо рамкиране"
              name="eval-leaning"
              value={leaning}
              onChange={setLeaning}
              choices={[
                ...EVAL_LEANING_VALUES.map((value) => ({
                  value,
                  label: LEANING_META[value].label,
                })),
                { value: "unable", label: "Не мога да преценя" },
              ]}
            />
            <ChoiceGroup
              legend="Позиция спрямо Русия"
              name="eval-russia"
              value={russia}
              onChange={setRussia}
              choices={[
                ...EVAL_RUSSIA_VALUES.map((value) => ({
                  value,
                  label: RUSSIA_META[value].label,
                })),
                { value: "unable", label: "Не мога да преценя" },
              ]}
            />

            <fieldset>
              <legend className="font-title text-lg">
                Отношение към партии
              </legend>
              <label className="mt-3 flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={noParty}
                  onChange={(event) => setNoParty(event.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>Няма съществено спомената политическа партия</span>
              </label>
              {!noParty ? (
                <div className="mt-3 space-y-3">
                  {parties.map((party) => (
                    <fieldset
                      key={party.key}
                      className="relative rounded-md border p-3"
                    >
                      <legend className="max-w-[calc(100%-3rem)] px-1 font-medium">
                        {party.party}
                      </legend>
                      <div className="absolute right-2 top-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Премахни ${party.party}`}
                          onClick={() =>
                            setParties((current) =>
                              current.filter((item) => item.key !== party.key),
                            )
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {EVAL_TONE_VALUES.map((tone) => (
                          <label
                            key={tone}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="radio"
                              name={`party-${party.key}`}
                              value={tone}
                              checked={party.tone === tone}
                              onChange={() =>
                                setParties((current) =>
                                  current.map((item) =>
                                    item.key === party.key
                                      ? { ...item, tone }
                                      : item,
                                  ),
                                )
                              }
                              className="size-4 accent-primary"
                            />
                            {TONE_META[tone].label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <div className="flex min-w-0 gap-2">
                    <Input
                      value={newParty}
                      onChange={(event) => setNewParty(event.target.value)}
                      maxLength={160}
                      placeholder="Добави пропусната партия"
                      aria-label="Име на пропусната партия"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addParty}
                      disabled={!newParty.trim()}
                    >
                      <Plus aria-hidden /> Добави
                    </Button>
                  </div>
                </div>
              ) : null}
            </fieldset>

            <Button type="submit" disabled className="w-full">
              Изпращането ще бъде включено в следващата стъпка
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              На този етап изборите остават само на тази страница и не се
              изпращат към сървъра.
            </p>
          </Card>
        </form>
      </div>
    </article>
  );
};
