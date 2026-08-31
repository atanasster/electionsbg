import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_EVAL_FILTERS,
  EVAL_LEANING_VALUES,
  EVAL_RUSSIA_VALUES,
  evalTaskPath,
  filterEvalTasks,
  orderEvalTasks,
  pickRandomEvalTask,
  useEvalQueue,
  type EvalFilters,
  type EvalTask,
} from "../evals";
import { formatDate, LEANING_META, RUSSIA_META } from "../labels";

const PAGE_SIZE = 12;
const REVIEW_FIELD_LABELS: Record<string, string> = {
  leaning: "политическо рамкиране",
  russia_stance: "позиция спрямо Русия",
  party_tones: "отношение към партии",
};

const unique = (values: Array<string | null>): string[] =>
  [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (left, right) => left.localeCompare(right, "bg"),
  );

const Filter = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) => (
  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
    {label}
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

const TaskCard = ({ task }: { task: EvalTask }) => (
  <Card className="flex min-w-0 flex-col p-4">
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{task.outlet}</span>
      {task.published ? <span>· {formatDate(task.published)}</span> : null}
      {task.primary_topic ? (
        <Badge variant="secondary" className="font-normal">
          {task.primary_topic}
        </Badge>
      ) : null}
    </div>
    <h2 className="mt-3 line-clamp-3 font-title text-xl leading-snug">
      <Link to={evalTaskPath(task)} className="hover:text-primary">
        {task.title}
      </Link>
    </h2>
    <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
      {task.model_labels.party_tones.length ? (
        <Badge variant="outline">
          {task.model_labels.party_tones.length}{" "}
          {task.model_labels.party_tones.length === 1 ? "партия" : "партии"}
        </Badge>
      ) : (
        <Badge variant="outline">без партия</Badge>
      )}
      {task.review_fields.map((field) => (
        <Badge key={field} variant="outline">
          проверка: {REVIEW_FIELD_LABELS[field] ?? field}
        </Badge>
      ))}
    </div>
    <Button asChild className="mt-4 self-start" size="sm">
      <Link to={evalTaskPath(task)}>Оцени статията</Link>
    </Button>
  </Card>
);

export const EvalsScreen = () => {
  const queue = useEvalQueue();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<EvalFilters>(DEFAULT_EVAL_FILTERS);
  const [page, setPage] = useState(1);
  const tasks = useMemo(() => queue.data?.tasks ?? [], [queue.data?.tasks]);

  const setFilter = <Key extends keyof EvalFilters>(
    key: Key,
    value: EvalFilters[Key],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const filtered = useMemo(
    () => orderEvalTasks(filterEvalTasks(tasks, filters)),
    [tasks, filters],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const outlets = useMemo(
    () => unique(tasks.map((task) => task.outlet)),
    [tasks],
  );
  const topics = useMemo(
    () => unique(tasks.map((task) => task.primary_topic)),
    [tasks],
  );
  const datasets = useMemo(
    () => unique(tasks.flatMap((task) => task.dataset_ids)),
    [tasks],
  );
  const reviewFields = useMemo(
    () => unique(tasks.flatMap((task) => task.review_fields)),
    [tasks],
  );
  const random = () => {
    const task = pickRandomEvalTask(filtered);
    if (task) navigate(evalTaskPath(task));
  };

  return (
    <article className="mx-auto max-w-6xl py-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Публичен експеримент
        </p>
        <h1 className="mt-1 font-title text-3xl sm:text-4xl">
          Помогнете да проверим анализите
        </h1>
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-foreground/90">
          Изберете статия и оценете политическото рамкиране, позицията спрямо
          Русия и отношението към партиите. Не е необходим профил или вход.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Публичните оценки са обратна връзка, а не гласуване. Те не променят
          автоматично анализа; всяка предложена поправка се преглежда офлайн.
        </p>
      </header>

      {queue.loading && !queue.data ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : null}
      {queue.error && !queue.data ? (
        <Card className="mt-8 p-5">
          <h2 className="font-title text-xl">Опашката още не е достъпна</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Публичните задачи не се заредиха. Опитайте отново по-късно или
            прегледайте определенията в методологията.
          </p>
          <Link
            to="/methodology"
            className="mt-3 inline-block font-medium text-primary underline underline-offset-4"
          >
            Прочетете методологията
          </Link>
        </Card>
      ) : null}

      {queue.data ? (
        <>
          <Card className="mt-8 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-title text-xl">Филтрирай задачите</h2>
                <p className="mt-1 text-sm text-muted-foreground" role="status">
                  {filtered.length} от {tasks.length} статии
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFilters(DEFAULT_EVAL_FILTERS);
                    setPage(1);
                  }}
                >
                  Изчисти
                </Button>
                <Button
                  type="button"
                  onClick={random}
                  disabled={!filtered.length}
                >
                  <Shuffle aria-hidden /> Случайна статия
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Filter
                label="Политическо рамкиране"
                value={filters.leaning}
                onChange={(value) =>
                  setFilter("leaning", value as EvalFilters["leaning"])
                }
                options={[
                  { value: "all", label: "Всички оценки" },
                  ...EVAL_LEANING_VALUES.map((value) => ({
                    value,
                    label: LEANING_META[value].short,
                  })),
                ]}
              />
              <Filter
                label="Позиция спрямо Русия"
                value={filters.russia}
                onChange={(value) =>
                  setFilter("russia", value as EvalFilters["russia"])
                }
                options={[
                  { value: "all", label: "Всички оценки" },
                  ...EVAL_RUSSIA_VALUES.map((value) => ({
                    value,
                    label: RUSSIA_META[value].short,
                  })),
                ]}
              />
              <Filter
                label="Партийно покритие"
                value={filters.party}
                onChange={(value) =>
                  setFilter("party", value as EvalFilters["party"])
                }
                options={[
                  { value: "all", label: "Всички статии" },
                  { value: "with_party", label: "С партии" },
                  { value: "without_party", label: "Без партии" },
                ]}
              />
              <Filter
                label="Период"
                value={filters.date}
                onChange={(value) =>
                  setFilter("date", value as EvalFilters["date"])
                }
                options={[
                  { value: "all", label: "Без ограничение" },
                  { value: "7", label: "Последните 7 дни" },
                  { value: "30", label: "Последните 30 дни" },
                  { value: "365", label: "Последната година" },
                ]}
              />
              <Filter
                label="Източник"
                value={filters.outlet}
                onChange={(value) => setFilter("outlet", value)}
                options={[
                  { value: "all", label: "Всички източници" },
                  ...outlets.map((value) => ({ value, label: value })),
                ]}
              />
              <Filter
                label="Тема"
                value={filters.topic}
                onChange={(value) => setFilter("topic", value)}
                options={[
                  { value: "all", label: "Всички теми" },
                  ...topics.map((value) => ({ value, label: value })),
                ]}
              />
              <Filter
                label="Публична извадка"
                value={filters.dataset}
                onChange={(value) => setFilter("dataset", value)}
                options={[
                  { value: "all", label: "Всички извадки" },
                  ...datasets.map((value) => ({ value, label: value })),
                ]}
              />
              <Filter
                label="Причина за проверка"
                value={filters.reviewField}
                onChange={(value) => setFilter("reviewField", value)}
                options={[
                  { value: "all", label: "Всички причини" },
                  ...reviewFields.map((value) => ({
                    value,
                    label: REVIEW_FIELD_LABELS[value] ?? value,
                  })),
                ]}
              />
            </div>
          </Card>

          {visible.length ? (
            <section className="mt-6" aria-labelledby="eval-task-heading">
              <h2 id="eval-task-heading" className="sr-only">
                Статии за оценяване
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {visible.map((task) => (
                  <TaskCard key={task.article_key} task={task} />
                ))}
              </div>
              <nav
                className="mt-6 flex items-center justify-between gap-3"
                aria-label="Страници със задачи"
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft aria-hidden /> Предишна
                </Button>
                <span className="text-sm text-muted-foreground">
                  Страница {safePage} от {pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={safePage >= pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                >
                  Следваща <ChevronRight aria-hidden />
                </Button>
              </nav>
            </section>
          ) : (
            <Card className="mt-6 p-6 text-sm text-muted-foreground">
              Няма задачи за тази комбинация от филтри.
            </Card>
          )}
        </>
      ) : null}
    </article>
  );
};
