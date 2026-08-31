import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Breadcrumbs } from "../components/Breadcrumbs";
import {
  TurnstileWidget,
  type TurnstileState,
} from "../components/TurnstileWidget";
import {
  EVAL_LEANING_VALUES,
  EVAL_RUSSIA_VALUES,
  EVAL_TONE_VALUES,
  useEvalQueue,
} from "../evals";
import {
  useOutletArticles,
  type Leaning,
  type RussiaStance,
  type Tone,
} from "../data";
import {
  buildSubmissionRequest,
  clearEvalDraft,
  createEvalDraft,
  EVAL_EVIDENCE_LIMIT,
  EVAL_NOTE_LIMIT,
  evaluationFingerprint,
  EvaluationSubmissionError,
  getOrCreateBrowserNonce,
  loadEvalDraft,
  markLocalEvalComplete,
  newIdempotencyKey,
  REASON_CODE_LABELS,
  saveEvalDraft,
  submitEvaluation,
  TURNSTILE_ACTION,
  TURNSTILE_SITE_KEY,
  validateEvalDraft,
  type EvalDraft,
  type EvalPartyDraft,
  type EvalReasonCode,
  type ScalarDraftValue,
  type SubmissionReceipt,
} from "../evalSubmission";
import {
  formatDateTime,
  LEANING_META,
  RUSSIA_META,
  TONE_META,
} from "../labels";

const SCALAR_REASONS: EvalReasonCode[] = [
  "model_missed_context",
  "model_overweighted_quote",
  "label_too_strong",
  "label_too_weak",
  "neutral_vs_not_applicable",
  "other",
];
const PARTY_REASONS: EvalReasonCode[] = [
  "tone_misread",
  "model_missed_context",
  "party_missing",
  "other",
];
const LEANING_RUBRIC: Record<Leaning, string> = {
  strong_progressive:
    "Прогресивната позиция доминира и е защитена категорично.",
  progressive: "Има ясна, но не доминираща прогресивна посока.",
  neutral: "Представянето е фактическо или балансирано без ясна посока.",
  conservative: "Има ясна, но не доминираща консервативна посока.",
  strong_conservative:
    "Консервативната позиция доминира и е защитена категорично.",
  not_applicable:
    "Темата не позволява смислена оценка по прогресивно–консервативната ос.",
};
const RUSSIA_RUBRIC: Record<RussiaStance, string> = {
  strong_pro_russia: "Проруската позиция доминира и е защитена категорично.",
  pro_russia: "Има ясно, но не доминиращо благоприятно рамкиране на Русия.",
  neutral: "Русия е представена фактически или балансирано без ясна позиция.",
  anti_russia: "Има ясно, но не доминиращо критично рамкиране на Русия.",
  strong_anti_russia: "Критичната позиция доминира и е изразена категорично.",
  not_applicable: "Русия няма съдържателна роля в материала.",
};
const TONE_RUBRIC: Record<Tone, string> = {
  favorable: "Авторският разказ представя партията благоприятно.",
  unfavorable: "Авторският разказ представя партията критично.",
  neutral: "Споменаването е фактическо или балансирано без оценъчен тон.",
  mixed: "Има едновременно благоприятни и критични сигнали.",
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
  value: ScalarDraftValue<Value>;
  choices: Array<{
    value: Value | "unable";
    label: string;
    description: string;
  }>;
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
            aria-label={choice.label}
            aria-describedby={`${name}-${choice.value}-hint`}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="block font-medium">{choice.label}</span>
            <span
              id={`${name}-${choice.value}-hint`}
              className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
            >
              {choice.description}
            </span>
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

const ReasonChecks = ({
  legend,
  values,
  choices,
  onChange,
}: {
  legend: string;
  values: EvalReasonCode[];
  choices: EvalReasonCode[];
  onChange: (values: EvalReasonCode[]) => void;
}) => (
  <fieldset className="mt-3">
    <legend className="text-xs font-medium text-muted-foreground">
      {legend}
    </legend>
    <div className="mt-1 grid gap-1 sm:grid-cols-2">
      {choices.map((reason) => (
        <label
          key={reason}
          className="flex items-start gap-2 text-xs leading-relaxed"
        >
          <input
            type="checkbox"
            checked={values.includes(reason)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...values, reason]
                  : values.filter((item) => item !== reason),
              )
            }
            className="mt-0.5 size-4 accent-primary"
          />
          <span>{REASON_CODE_LABELS[reason]}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const TextCounter = ({ value, limit }: { value: string; limit: number }) => (
  <span className="text-xs text-muted-foreground" aria-hidden>
    {value.length}/{limit}
  </span>
);

const hasStarted = (draft: EvalDraft): boolean =>
  Boolean(
    draft.leaning.value ||
    draft.russia.value ||
    draft.leaning.evidence ||
    draft.russia.evidence ||
    draft.publicNote ||
    draft.noParty ||
    draft.removedParties.length ||
    draft.parties.some(
      (party) =>
        party.source === "added" ||
        party.tone ||
        party.evidence ||
        party.reasonCodes.length,
    ),
  );

const errorMessage = (error: unknown): string => {
  if (!(error instanceof EvaluationSubmissionError)) {
    return "Не успяхме да изпратим оценката. Черновата е запазена в този браузър.";
  }
  switch (error.code) {
    case "stale_task":
      return "Статията или анализът са обновени. Презаредете задачата преди да изпратите.";
    case "duplicate_submission":
      return "Този браузър вече е изпратил оценка за тази версия на задачата.";
    case "rate_limited":
      return error.retryAfterSeconds
        ? `Има твърде много опити. Опитайте отново след около ${error.retryAfterSeconds} секунди.`
        : "Има твърде много опити. Опитайте отново по-късно.";
    case "challenge_failed":
      return "Проверката срещу злоупотреба изтече или не бе приета. Завършете я отново.";
    case "challenge_unavailable":
    case "service_unavailable":
    case "network_error":
      return "Услугата временно не е достъпна. Черновата е запазена; опитайте отново.";
    case "task_unavailable":
    case "task_not_found":
      return "Тази задача вече не приема публични оценки.";
    case "invalid_evaluation":
      return "Оценката не мина проверката за пълнота. Прегледайте основанията и опитайте отново.";
    case "idempotency_conflict":
      return "Формата е променена след предишен опит. Опитайте изпращането отново.";
    default:
      return "Не успяхме да изпратим оценката. Черновата е запазена в този браузър.";
  }
};

const Comparison = ({ receipt }: { receipt: SubmissionReceipt }) => {
  const evaluation = receipt.evaluation;
  const model = receipt.model_labels;
  return (
    <Card
      className="space-y-4 border-primary/40 bg-primary/5 p-5"
      role="status"
    >
      <div>
        <Badge>Оценката е приета</Badge>
        <h2 className="mt-2 font-title text-2xl">Сравнение с модела</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Моделните оценки бяха скрити до изпращането. Един публичен отговор не
          променя автоматично анализа; той влиза в набор за последващ офлайн
          преглед.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border bg-background p-3">
          <dt className="text-xs font-medium text-muted-foreground">
            Политическо рамкиране
          </dt>
          <dd className="mt-1 text-sm">
            Вие:{" "}
            <strong>
              {evaluation.leaning.label
                ? LEANING_META[evaluation.leaning.label].label
                : "Не мога да преценя"}
            </strong>
          </dd>
          <dd className="text-sm">
            Модел: {LEANING_META[model.leaning].label}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-3">
          <dt className="text-xs font-medium text-muted-foreground">
            Позиция спрямо Русия
          </dt>
          <dd className="mt-1 text-sm">
            Вие:{" "}
            <strong>
              {evaluation.russia_stance.label
                ? RUSSIA_META[evaluation.russia_stance.label].label
                : "Не мога да преценя"}
            </strong>
          </dd>
          <dd className="text-sm">
            Модел: {RUSSIA_META[model.russia_stance].label}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="font-title text-lg">Партии</h3>
        {evaluation.party_tones.length ? (
          <ul className="mt-2 space-y-2 text-sm">
            {evaluation.party_tones.map((party) => {
              const modelParty = model.party_tones.find((candidate) =>
                party.party_id
                  ? candidate.party_id === party.party_id
                  : candidate.party.toLocaleLowerCase("bg") ===
                    party.party.toLocaleLowerCase("bg"),
              );
              return (
                <li
                  key={`${party.party_id ?? "surface"}:${party.party}`}
                  className="rounded-md border bg-background p-3"
                >
                  <strong>{party.party}</strong>: вие —{" "}
                  {TONE_META[party.tone].label}; модел —{" "}
                  {modelParty
                    ? TONE_META[modelParty.tone].label
                    : "не е разпозната"}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Не сте потвърдили съществено спомената партия.
          </p>
        )}
        {evaluation.removed_model_parties.length ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Премахнати от моделния списък:{" "}
            {evaluation.removed_model_parties
              .map((party) => party.party)
              .join(", ")}
            .
          </p>
        ) : null}
      </div>
      <Button asChild variant="outline">
        <Link to="/evals">Към опашката</Link>
      </Button>
    </Card>
  );
};

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
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<EvalDraft | null>(null);
  const [newParty, setNewParty] = useState("");
  const [draftStatus, setDraftStatus] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [online, setOnline] = useState(() => navigator.onLine);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileState, setTurnstileState] =
    useState<TurnstileState>("loading");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!task) {
      setDraft(null);
      return;
    }
    setDraft(loadEvalDraft(task) ?? createEvalDraft(task));
    setNewParty("");
    setReceipt(null);
    setSubmitError(null);
    setSubmitErrorCode(null);
  }, [task]);

  useEffect(() => {
    if (!task || !draft || receipt) return;
    const next = { ...draft, updatedAt: new Date().toISOString() };
    const timer = window.setTimeout(() => {
      setDraftStatus(saveEvalDraft(task, next) ? "saved" : "error");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, receipt, task]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const warnOnLeave = Boolean(draft && hasStarted(draft) && !receipt);
  useEffect(() => {
    if (!warnOnLeave) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const links = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.target === "_blank" ||
        target.hasAttribute("download")
      )
        return;
      const next = new URL(target.href, window.location.href);
      if (
        next.href === window.location.href ||
        (next.pathname === window.location.pathname &&
          next.search === window.location.search &&
          next.hash)
      )
        return;
      if (
        !window.confirm(
          "Оценката още не е изпратена. Да напуснете ли страницата?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", links, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", links, true);
    };
  }, [warnOnLeave]);

  const validation = useMemo(
    () =>
      task && draft
        ? validateEvalDraft(task, draft)
        : { evaluation: null, errors: [] },
    [draft, task],
  );
  const updateDraft = (change: (current: EvalDraft) => EvalDraft) =>
    setDraft((current) => (current ? change(current) : current));
  const updateParty = (key: string, change: Partial<EvalPartyDraft>) =>
    updateDraft((current) => ({
      ...current,
      parties: current.parties.map((party) =>
        party.key === key ? { ...party, ...change } : party,
      ),
    }));
  const onTurnstileToken = useCallback(
    (value: string | null) => setTurnstileToken(value),
    [],
  );
  const onTurnstileState = useCallback(
    (value: TurnstileState) => setTurnstileState(value),
    [],
  );

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
  if (!task || !draft) {
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

  const scalar = <Key extends "leaning" | "russia">(
    key: Key,
    change: Partial<EvalDraft[Key]>,
  ) =>
    updateDraft((current) => ({
      ...current,
      [key]: { ...current[key], ...change },
    }));
  const addParty = () => {
    const party = newParty.trim();
    if (
      !party ||
      draft.parties.some(
        (item) =>
          item.party.toLocaleLowerCase("bg") === party.toLocaleLowerCase("bg"),
      )
    )
      return;
    updateDraft((current) => ({
      ...current,
      noParty: false,
      parties: [
        ...current.parties,
        {
          key: `added:${newIdempotencyKey()}`,
          source: "added",
          party,
          partyId: null,
          tone: "",
          evidence: "",
          reasonCodes: ["party_missing"],
        },
      ],
    }));
    setNewParty("");
  };
  const removeParty = (party: EvalPartyDraft) =>
    updateDraft((current) => ({
      ...current,
      parties: current.parties.filter((item) => item.key !== party.key),
      removedParties:
        party.source === "model"
          ? [...current.removedParties, { party, reasonCode: "" }]
          : current.removedParties,
    }));
  const restoreParty = (key: string) =>
    updateDraft((current) => {
      const removed = current.removedParties.find(
        (item) => item.party.key === key,
      );
      return !removed
        ? current
        : {
            ...current,
            parties: [...current.parties, removed.party],
            removedParties: current.removedParties.filter(
              (item) => item.party.key !== key,
            ),
          };
    });

  const submit = async () => {
    if (!validation.evaluation || !turnstileToken || !online || submitting)
      return;
    const fingerprint = evaluationFingerprint(validation.evaluation);
    const idempotencyKey =
      draft.attemptFingerprint === fingerprint && draft.idempotencyKey
        ? draft.idempotencyKey
        : newIdempotencyKey();
    const attempted = {
      ...draft,
      attemptFingerprint: fingerprint,
      idempotencyKey,
      updatedAt: new Date().toISOString(),
    };
    setDraft(attempted);
    saveEvalDraft(task, attempted);
    setSubmitting(true);
    setSubmitError(null);
    setSubmitErrorCode(null);
    try {
      const result = await submitEvaluation(
        task,
        buildSubmissionRequest(
          task,
          validation.evaluation,
          turnstileToken,
          idempotencyKey,
          getOrCreateBrowserNonce(),
        ),
      );
      clearEvalDraft(task);
      markLocalEvalComplete(task);
      setReceipt(result.submission);
    } catch (error) {
      if (
        error instanceof EvaluationSubmissionError &&
        error.code === "duplicate_submission"
      )
        markLocalEvalComplete(task);
      if (
        error instanceof EvaluationSubmissionError &&
        error.code === "idempotency_conflict"
      ) {
        const retryable = {
          ...attempted,
          attemptFingerprint: null,
          idempotencyKey: null,
          updatedAt: new Date().toISOString(),
        };
        setDraft(retryable);
        saveEvalDraft(task, retryable);
      }
      setSubmitError(errorMessage(error));
      setSubmitErrorCode(
        error instanceof EvaluationSubmissionError ? error.code : null,
      );
    } finally {
      setSubmitting(false);
      setTurnstileToken(null);
      setTurnstileReset((value) => value + 1);
    }
  };
  const completed =
    Number(Boolean(draft.leaning.value)) +
    Number(Boolean(draft.russia.value)) +
    Number(
      draft.noParty ||
        (draft.parties.length > 0 &&
          draft.parties.every((party) => party.tone)),
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
        {receipt ? (
          <Comparison receipt={receipt} />
        ) : (
          <form
            ref={formRef}
            className="min-w-0"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
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
              <section className="space-y-3">
                <ChoiceGroup<Leaning>
                  legend="Политическо рамкиране"
                  name="eval-leaning"
                  value={draft.leaning.value}
                  onChange={(value) => scalar("leaning", { value })}
                  choices={[
                    ...EVAL_LEANING_VALUES.map((value) => ({
                      value,
                      label: LEANING_META[value].label,
                      description: LEANING_RUBRIC[value],
                    })),
                    {
                      value: "unable",
                      label: "Не мога да преценя",
                      description:
                        "Публичният контекст не е достатъчен за надеждна оценка.",
                    },
                  ]}
                />
                <label className="grid gap-1 text-sm">
                  Кратко основание{" "}
                  {draft.leaning.value === "unable"
                    ? "(по желание)"
                    : "(задължително)"}
                  <Textarea
                    value={draft.leaning.evidence}
                    onChange={(event) =>
                      scalar("leaning", { evidence: event.target.value })
                    }
                    maxLength={EVAL_EVIDENCE_LIMIT}
                    rows={3}
                  />
                  <TextCounter
                    value={draft.leaning.evidence}
                    limit={EVAL_EVIDENCE_LIMIT}
                  />
                </label>
                <ReasonChecks
                  legend="Допълнителни причини (по желание)"
                  values={draft.leaning.reasonCodes}
                  choices={SCALAR_REASONS}
                  onChange={(reasonCodes) => scalar("leaning", { reasonCodes })}
                />
              </section>
              <section className="space-y-3">
                <ChoiceGroup<RussiaStance>
                  legend="Позиция спрямо Русия"
                  name="eval-russia"
                  value={draft.russia.value}
                  onChange={(value) => scalar("russia", { value })}
                  choices={[
                    ...EVAL_RUSSIA_VALUES.map((value) => ({
                      value,
                      label: RUSSIA_META[value].label,
                      description: RUSSIA_RUBRIC[value],
                    })),
                    {
                      value: "unable",
                      label: "Не мога да преценя",
                      description:
                        "Публичният контекст не е достатъчен за надеждна оценка.",
                    },
                  ]}
                />
                <label className="grid gap-1 text-sm">
                  Кратко основание{" "}
                  {draft.russia.value === "unable"
                    ? "(по желание)"
                    : "(задължително)"}
                  <Textarea
                    value={draft.russia.evidence}
                    onChange={(event) =>
                      scalar("russia", { evidence: event.target.value })
                    }
                    maxLength={EVAL_EVIDENCE_LIMIT}
                    rows={3}
                  />
                  <TextCounter
                    value={draft.russia.evidence}
                    limit={EVAL_EVIDENCE_LIMIT}
                  />
                </label>
                <ReasonChecks
                  legend="Допълнителни причини (по желание)"
                  values={draft.russia.reasonCodes}
                  choices={SCALAR_REASONS}
                  onChange={(reasonCodes) => scalar("russia", { reasonCodes })}
                />
              </section>
              <fieldset>
                <legend className="font-title text-lg">
                  Отношение към партии
                </legend>
                <label className="mt-3 flex items-start gap-2 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.noParty}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        noParty: event.target.checked,
                      }))
                    }
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>Няма съществено спомената политическа партия</span>
                </label>
                {!draft.noParty ? (
                  <div className="mt-3 space-y-3">
                    {draft.parties.map((party) => (
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
                            onClick={() => removeParty(party)}
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
                                name={`party-${party.partyId ?? party.key}`}
                                value={tone}
                                checked={party.tone === tone}
                                onChange={() =>
                                  updateParty(party.key, { tone })
                                }
                                aria-label={TONE_META[tone].label}
                                aria-describedby={`party-${party.key}-${tone}-hint`}
                                className="size-4 accent-primary"
                              />
                              <span>
                                <span className="block font-medium">
                                  {TONE_META[tone].label}
                                </span>
                                <span
                                  id={`party-${party.key}-${tone}-hint`}
                                  className="block text-xs leading-relaxed text-muted-foreground"
                                >
                                  {TONE_RUBRIC[tone]}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <label className="mt-3 grid gap-1 text-sm">
                          {party.tone === "mixed"
                            ? "Кратко основание: посочете и благоприятната, и критичната посока (задължително)"
                            : party.tone === "neutral"
                              ? "Кратко основание: посочете фактическата или балансираната основа (задължително)"
                              : "Кратко основание (задължително)"}
                          <Textarea
                            value={party.evidence}
                            onChange={(event) =>
                              updateParty(party.key, {
                                evidence: event.target.value,
                              })
                            }
                            maxLength={EVAL_EVIDENCE_LIMIT}
                            rows={2}
                          />
                          <TextCounter
                            value={party.evidence}
                            limit={EVAL_EVIDENCE_LIMIT}
                          />
                        </label>
                        <ReasonChecks
                          legend="Допълнителни причини (по желание)"
                          values={party.reasonCodes}
                          choices={PARTY_REASONS}
                          onChange={(reasonCodes) =>
                            updateParty(party.key, { reasonCodes })
                          }
                        />
                      </fieldset>
                    ))}
                    {draft.removedParties.map((removed) => (
                      <div
                        key={removed.party.key}
                        className="rounded-md border border-dashed p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {removed.party.party} — премахната
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => restoreParty(removed.party.key)}
                          >
                            <RotateCcw aria-hidden /> Върни
                          </Button>
                        </div>
                        <label className="mt-2 grid gap-1 text-sm">
                          Причина за премахване
                          <select
                            value={removed.reasonCode}
                            onChange={(event) =>
                              updateDraft((current) => ({
                                ...current,
                                removedParties: current.removedParties.map(
                                  (item) =>
                                    item.party.key === removed.party.key
                                      ? {
                                          ...item,
                                          reasonCode: event.target
                                            .value as typeof item.reasonCode,
                                        }
                                      : item,
                                ),
                              }))
                            }
                            className="h-10 rounded-md border border-input bg-background px-3"
                          >
                            <option value="">Изберете причина</option>
                            <option value="wrong_party_identity">
                              Грешно разпозната партия
                            </option>
                            <option value="party_not_meaningful">
                              Само инцидентно споменаване
                            </option>
                            <option value="other">Друга причина</option>
                          </select>
                        </label>
                      </div>
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
                    <p className="text-xs text-muted-foreground">
                      Добавеното име ще бъде прегледано и свързано с канонична
                      партия офлайн.
                    </p>
                  </div>
                ) : null}
              </fieldset>
              <label className="grid gap-1 text-sm">
                Бележка към редакционния преглед (по желание)
                <Textarea
                  value={draft.publicNote}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      publicNote: event.target.value,
                    }))
                  }
                  maxLength={EVAL_NOTE_LIMIT}
                  rows={3}
                />
                <TextCounter value={draft.publicNote} limit={EVAL_NOTE_LIMIT} />
                <span className="text-xs text-muted-foreground">
                  Бележката не се публикува автоматично; вижда се само при
                  офлайн редакционния преглед.
                </span>
              </label>
              <div>
                <p className="text-sm font-medium">
                  Проверка срещу автоматизирани изпращания
                </p>
                <TurnstileWidget
                  siteKey={TURNSTILE_SITE_KEY}
                  action={TURNSTILE_ACTION}
                  resetSignal={turnstileReset}
                  onToken={onTurnstileToken}
                  onStateChange={onTurnstileState}
                />
              </div>
              {!online ? (
                <p
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                  role="status"
                >
                  Няма връзка с интернет. Попълненото остава като чернова в този
                  браузър.
                </p>
              ) : null}
              {submitError ? (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <p>{submitError}</p>
                  {submitErrorCode === "stale_task" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => window.location.reload()}
                    >
                      Презареди задачата
                    </Button>
                  ) : null}
                  {submitErrorCode === "duplicate_submission" ? (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="mt-2"
                    >
                      <Link to="/evals">Към опашката</Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {validation.errors.length ? (
                <div className="text-xs text-muted-foreground">
                  <p>За изпращане остава:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {validation.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Button
                type="submit"
                disabled={
                  !validation.evaluation ||
                  !turnstileToken ||
                  !online ||
                  submitting ||
                  turnstileState !== "verified"
                }
                className="w-full"
              >
                {submitting ? "Изпращане…" : "Изпрати оценката"}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Ctrl/⌘ + Enter изпраща само когато формата и проверката са
                готови.{" "}
                {draftStatus === "saved"
                  ? "Черновата е запазена само в този браузър."
                  : draftStatus === "error"
                    ? "Локалното запазване не е достъпно."
                    : ""}
              </p>
            </Card>
          </form>
        )}
      </div>
    </article>
  );
};
