import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  TurnstileWidget,
  type TurnstileState,
} from "../components/TurnstileWidget";
import { EVAL_LEANING_VALUES, EVAL_RUSSIA_VALUES } from "../evals";
import { LEANING_META, RUSSIA_META } from "../labels";
import {
  ArticleFeedbackError,
  loadArticleFeedbackTask,
  submitArticleFeedback,
  type ArticleFeedbackTask,
  type FeedbackIssueKind,
} from "../articleFeedback";
import {
  getOrCreateBrowserNonce,
  newIdempotencyKey,
  TURNSTILE_ACTION,
  TURNSTILE_SITE_KEY,
} from "../evalSubmission";
import type { Leaning, RussiaStance, Tone } from "../data";

const PARTY_TONES: Array<{ value: Tone; label: string }> = [
  { value: "favorable", label: "Благоприятен" },
  { value: "unfavorable", label: "Неблагоприятен" },
  { value: "neutral", label: "Неутрален" },
  { value: "mixed", label: "Смесен" },
];

const ISSUES: Array<{ value: FeedbackIssueKind; label: string }> = [
  { value: "missing_analysis", label: "Липсва анализ" },
  {
    value: "missing_entity",
    label: "Липсва лице, партия, място или институция",
  },
  { value: "wrong_entity_link", label: "Връзката води към грешен профил" },
  { value: "missing_topic", label: "Липсва тема" },
  { value: "missing_sector", label: "Липсва сектор" },
  { value: "other", label: "Друго" },
];

export const ArticleFeedbackScreen = ({
  domain,
  articleId,
}: {
  domain: string;
  articleId: string;
}) => {
  const [task, setTask] = useState<ArticleFeedbackTask | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [leaning, setLeaning] = useState<Leaning | "">("");
  const [russia, setRussia] = useState<RussiaStance | "">("");
  const [parties, setParties] = useState<
    Array<{ party: string; tone: Tone | ""; evidence: string }>
  >([]);
  const [issues, setIssues] = useState<FeedbackIssueKind[]>([]);
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileState, setTurnstileState] =
    useState<TurnstileState>("loading");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{
    fingerprint: string;
    key: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setTask(null);
    setLoadError(false);
    setLeaning("");
    setRussia("");
    setParties([]);
    setIssues([]);
    setEvidence("");
    setNote("");
    setTurnstileToken(null);
    setTurnstileState("loading");
    setTurnstileReset((value) => value + 1);
    setSubmitting(false);
    setSubmitted(false);
    setSubmitError(null);
    setAttempt(null);
    void loadArticleFeedbackTask(domain, articleId).then(
      (value) => {
        if (active) setTask(value);
      },
      () => {
        if (active) setLoadError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [articleId, domain]);

  const onTurnstileToken = useCallback((value: string | null) => {
    setTurnstileToken(value);
  }, []);
  const onTurnstileState = useCallback((value: TurnstileState) => {
    setTurnstileState(value);
  }, []);
  const hasGeneralFeedback = Boolean(
    leaning || russia || issues.length || note.trim(),
  );
  const valid = Boolean(
    task &&
    (hasGeneralFeedback || parties.length) &&
    (!hasGeneralFeedback || evidence.trim()) &&
    parties.every(
      (party) => party.party.trim() && party.tone && party.evidence.trim(),
    ) &&
    turnstileToken,
  );

  if (submitted)
    return (
      <Card className="mx-auto max-w-3xl p-6" role="status">
        <h1 className="font-title text-3xl">Благодарим за предложението</h1>
        <p className="mt-2 text-muted-foreground">
          То е записано като необработена обществена обратна връзка и ще бъде
          прегледано преди евентуална промяна.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to={`/article/${domain}/${articleId}`}>
            Обратно към статията
          </Link>
        </Button>
      </Card>
    );

  return (
    <article className="mx-auto max-w-3xl py-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Обществен принос · без регистрация
      </p>
      <h1 className="mt-1 font-title text-3xl">Допълнете анализа</h1>
      <p className="mt-2 text-muted-foreground">
        Предложете оценка или посочете липсващ елемент. Моделните и обществените
        отговори остават отделни до редакционен преглед.
      </p>
      {loadError ? (
        <Card className="mt-6 p-5 text-destructive" role="status">
          Формулярът за тази статия още не е достъпен. Не е изпратена обратна
          връзка.
        </Card>
      ) : !task ? (
        <Card className="mt-6 p-5 text-muted-foreground" role="status">
          Зареждане на формуляра…
        </Card>
      ) : (
        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!task || !turnstileToken || !valid || submitting) return;
            const feedback = {
              leaning: leaning
                ? { label: leaning, evidence: evidence.trim() }
                : null,
              russia_stance: russia
                ? { label: russia, evidence: evidence.trim() }
                : null,
              party_tones: parties.map((party) => ({
                party: party.party.trim(),
                party_id: null,
                tone: party.tone as Tone,
                evidence: party.evidence.trim(),
              })),
              issue_kinds: issues,
              public_note: note.trim() || null,
            };
            const fingerprint = JSON.stringify(feedback);
            const idempotencyKey =
              attempt?.fingerprint === fingerprint
                ? attempt.key
                : newIdempotencyKey();
            setAttempt({ fingerprint, key: idempotencyKey });
            setSubmitting(true);
            setSubmitError(null);
            void submitArticleFeedback({
              schema_version: 1,
              article_key: task.article_key,
              base_task_revision: task.revision,
              content_sha256: task.content_sha256,
              analysis_sha256: task.analysis_sha256,
              idempotency_key: idempotencyKey,
              turnstile_token: turnstileToken,
              browser_nonce: getOrCreateBrowserNonce(),
              feedback,
            })
              .then(
                () => setSubmitted(true),
                (error: unknown) => {
                  if (
                    error instanceof ArticleFeedbackError &&
                    error.code === "idempotency_conflict"
                  )
                    setAttempt(null);
                  setSubmitError(
                    error instanceof ArticleFeedbackError &&
                      error.code === "stale_task"
                      ? "Статията е обновена. Презаредете формуляра."
                      : "Не успяхме да изпратим предложението. Опитайте отново.",
                  );
                  setTurnstileToken(null);
                  setTurnstileReset((value) => value + 1);
                },
              )
              .finally(() => setSubmitting(false));
          }}
        >
          <Card className="space-y-6 p-5">
            <label className="grid gap-1 text-sm font-medium">
              Политическо рамкиране (по желание)
              <select
                value={leaning}
                onChange={(event) =>
                  setLeaning(event.target.value as Leaning | "")
                }
                className="h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="">Не предлагам оценка</option>
                {EVAL_LEANING_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {LEANING_META[value].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Позиция спрямо Русия (по желание)
              <select
                value={russia}
                onChange={(event) =>
                  setRussia(event.target.value as RussiaStance | "")
                }
                className="h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="">Не предлагам оценка</option>
                {EVAL_RUSSIA_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {RUSSIA_META[value].label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="text-sm font-medium">
                Тон към политически партии (по желание)
              </legend>
              <div className="mt-2 space-y-3">
                {parties.map((party, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_12rem_auto]"
                  >
                    <label className="grid gap-1 text-sm">
                      Партия
                      <input
                        value={party.party}
                        maxLength={160}
                        onChange={(event) =>
                          setParties((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, party: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="h-10 rounded-md border border-input bg-background px-3"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      Тон
                      <select
                        value={party.tone}
                        onChange={(event) =>
                          setParties((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    tone: event.target.value as Tone | "",
                                  }
                                : item,
                            ),
                          )
                        }
                        className="h-10 rounded-md border border-input bg-background px-3"
                      >
                        <option value="">Изберете</option>
                        {PARTY_TONES.map((tone) => (
                          <option key={tone.value} value={tone.value}>
                            {tone.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setParties((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Премахни
                    </Button>
                    <label className="grid gap-1 text-sm sm:col-span-3">
                      Основание за партията
                      <Textarea
                        value={party.evidence}
                        maxLength={600}
                        rows={2}
                        onChange={(event) =>
                          setParties((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, evidence: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
                {parties.length < 20 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setParties((current) => [
                        ...current,
                        { party: "", tone: "", evidence: "" },
                      ])
                    }
                  >
                    Добави партия
                  </Button>
                ) : null}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">
                Какво липсва или е грешно?
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ISSUES.map((issue) => (
                  <label
                    key={issue.value}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={issues.includes(issue.value)}
                      onChange={(event) =>
                        setIssues((current) =>
                          event.target.checked
                            ? [...current, issue.value]
                            : current.filter((value) => value !== issue.value),
                        )
                      }
                      className="mt-0.5 size-4 accent-primary"
                    />
                    {issue.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1 text-sm font-medium">
              Общо проверимо основание
              <Textarea
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                maxLength={600}
                rows={4}
                required={hasGeneralFeedback}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Допълнителна бележка (по желание)
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={600}
                rows={3}
              />
            </label>
            <TurnstileWidget
              siteKey={TURNSTILE_SITE_KEY}
              action={TURNSTILE_ACTION}
              resetSignal={turnstileReset}
              onToken={onTurnstileToken}
              onStateChange={onTurnstileState}
            />
            {turnstileState === "unavailable" ? (
              <p className="text-sm text-destructive" role="status">
                Проверката срещу злоупотреба не е достъпна.
              </p>
            ) : null}
            {submitError ? (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
            <Button type="submit" disabled={!valid || submitting}>
              {submitting ? "Изпращане…" : "Изпратете предложението"}
            </Button>
          </Card>
        </form>
      )}
    </article>
  );
};
