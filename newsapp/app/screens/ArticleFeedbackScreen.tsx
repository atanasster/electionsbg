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
  loadCurrentFeedbackLinks,
  loadFeedbackTargets,
  searchFeedbackTargets,
  submitArticleFeedback,
  type ArticleFeedbackTask,
  type CurrentFeedbackLink,
  type FeedbackIssueKind,
  type FeedbackTarget,
  type FeedbackTargetKind,
  type FeedbackTargetRegistry,
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

const TARGET_KINDS: Array<{ value: FeedbackTargetKind; label: string }> = [
  { value: "person", label: "Лице / длъжностно лице" },
  { value: "party", label: "Партия" },
  { value: "settlement", label: "Населено място" },
  { value: "institution", label: "Институция" },
  { value: "company", label: "Дружество" },
  { value: "sector", label: "Сектор" },
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
    Array<{
      party: string;
      target: FeedbackTarget | null;
      tone: Tone | "";
      evidence: string;
    }>
  >([]);
  const [issues, setIssues] = useState<FeedbackIssueKind[]>([]);
  const [targetRegistry, setTargetRegistry] =
    useState<FeedbackTargetRegistry | null>(null);
  const [currentLinks, setCurrentLinks] = useState<CurrentFeedbackLink[]>([]);
  const [links, setLinks] = useState<
    Array<{
      action: "add" | "replace";
      surface: string;
      kind: FeedbackTargetKind;
      query: string;
      target: FeedbackTarget | null;
      currentHref: string | null;
      context: string;
      evidence: string;
    }>
  >([]);
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
    setTargetRegistry(null);
    setCurrentLinks([]);
    setLinks([]);
    setEvidence("");
    setNote("");
    setTurnstileToken(null);
    setTurnstileState("loading");
    setTurnstileReset((value) => value + 1);
    setSubmitting(false);
    setSubmitted(false);
    setSubmitError(null);
    setAttempt(null);
    void Promise.all([
      loadArticleFeedbackTask(domain, articleId),
      loadFeedbackTargets(),
      loadCurrentFeedbackLinks(domain, articleId),
    ]).then(
      ([value, registry, articleLinks]) => {
        if (value.target_registry_sha256 !== registry.targets_sha256)
          throw new Error("feedback target registry is stale");
        if (active) {
          setTask(value);
          setTargetRegistry(registry);
          setCurrentLinks(articleLinks);
        }
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
    (hasGeneralFeedback || parties.length || links.length) &&
    (!hasGeneralFeedback || evidence.trim()) &&
    parties.every(
      (party) =>
        party.party.trim() &&
        party.tone &&
        party.evidence.trim() &&
        (party.target === null || party.target.kind === "party"),
    ) &&
    links.every(
      (link) =>
        link.surface.trim() &&
        link.context.trim() &&
        link.evidence.trim() &&
        (link.action === "add" || Boolean(link.currentHref)) &&
        (link.target === null || link.target.kind === link.kind),
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
                party_id: party.target?.id ?? null,
                resolution_status: party.target
                  ? ("selected" as const)
                  : ("unresolved" as const),
                tone: party.tone as Tone,
                evidence: party.evidence.trim(),
              })),
              link_proposals: links.map((link) => ({
                action: link.action,
                surface: link.surface.trim(),
                target_kind: link.kind,
                resolution_status: link.target
                  ? ("selected" as const)
                  : ("unresolved" as const),
                target_ref: link.target
                  ? { kind: link.target.kind, id: link.target.id }
                  : null,
                current_href:
                  link.action === "replace" ? link.currentHref : null,
                context: link.context.trim(),
                evidence: link.evidence.trim(),
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
              target_registry_sha256: task.target_registry_sha256,
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
                                ? {
                                    ...item,
                                    party: event.target.value,
                                    target: null,
                                  }
                                : item,
                            ),
                          )
                        }
                        className="h-10 rounded-md border border-input bg-background px-3"
                      />
                    </label>
                    {targetRegistry && party.party.trim().length >= 2 ? (
                      <div
                        className="flex flex-wrap gap-2 sm:col-span-3"
                        aria-label="Канонични партии"
                      >
                        {searchFeedbackTargets(
                          targetRegistry,
                          party.party,
                          "party",
                        ).map((candidate) => (
                          <Button
                            key={candidate.id}
                            type="button"
                            size="sm"
                            variant={
                              party.target?.id === candidate.id
                                ? "default"
                                : "outline"
                            }
                            onClick={() =>
                              setParties((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        party: candidate.canonical,
                                        target: candidate,
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {candidate.canonical} · {candidate.id}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-muted-foreground sm:col-span-3">
                      {party.target
                        ? `Избрана канонична партия: ${party.target.canonical} (${party.target.id})`
                        : "Нерешено име — ще бъде проверено ръчно."}
                    </p>
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
                        { party: "", target: null, tone: "", evidence: "" },
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
                Липсващи или грешни профилни връзки
              </legend>
              <p className="mt-1 text-xs text-muted-foreground">
                Изберете каноничен профил. Ако не го намирате, оставете целта
                нерешена — редактор няма да отгатва самоличност.
              </p>
              <div className="mt-2 space-y-3">
                {links.map((link, index) => {
                  const candidates = targetRegistry
                    ? searchFeedbackTargets(
                        targetRegistry,
                        link.query,
                        link.kind,
                      )
                    : [];
                  return (
                    <div
                      key={index}
                      className="space-y-2 rounded-md border p-3"
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-sm">
                          Действие
                          <select
                            value={link.action}
                            onChange={(event) =>
                              setLinks((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        action: event.target.value as
                                          | "add"
                                          | "replace",
                                        currentHref:
                                          event.target.value === "add"
                                            ? null
                                            : item.currentHref,
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="h-10 rounded-md border bg-background px-3"
                          >
                            <option value="add">Добавяне</option>
                            <option value="replace">
                              Замяна на грешна връзка
                            </option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm">
                          Вид
                          <select
                            value={link.kind}
                            onChange={(event) =>
                              setLinks((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        kind: event.target
                                          .value as FeedbackTargetKind,
                                        target: null,
                                        query: "",
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="h-10 rounded-md border bg-background px-3"
                          >
                            {TARGET_KINDS.map((kind) => (
                              <option key={kind.value} value={kind.value}>
                                {kind.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {link.action === "replace" ? (
                        <label className="grid gap-1 text-sm">
                          Коя съществуваща връзка е грешна
                          <select
                            value={link.currentHref ?? ""}
                            onChange={(event) => {
                              const selected = currentLinks.find(
                                (item) => item.href === event.target.value,
                              );
                              setLinks((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        currentHref: selected?.href ?? null,
                                        surface:
                                          selected?.surface ?? item.surface,
                                      }
                                    : item,
                                ),
                              );
                            }}
                            className="h-10 rounded-md border bg-background px-3"
                          >
                            <option value="">
                              Изберете връзка от статията
                            </option>
                            {currentLinks.map((current) => (
                              <option
                                key={`${current.surface}:${current.href}`}
                                value={current.href}
                              >
                                {current.surface} → {current.href}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="grid gap-1 text-sm">
                        Име както е изписано в статията
                        <input
                          value={link.surface}
                          maxLength={300}
                          onChange={(event) =>
                            setLinks((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, surface: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-10 rounded-md border bg-background px-3"
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        Търсене на каноничен профил
                        <input
                          value={link.query}
                          onChange={(event) =>
                            setLinks((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      query: event.target.value,
                                      target: null,
                                    }
                                  : item,
                              ),
                            )
                          }
                          className="h-10 rounded-md border bg-background px-3"
                        />
                      </label>
                      {candidates.length ? (
                        <div
                          className="flex flex-wrap gap-2"
                          aria-label="Канонични резултати"
                        >
                          {candidates.map((candidate) => (
                            <Button
                              key={`${candidate.kind}:${candidate.id}`}
                              type="button"
                              size="sm"
                              variant={
                                link.target?.id === candidate.id
                                  ? "default"
                                  : "outline"
                              }
                              onClick={() =>
                                setLinks((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, target: candidate }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {candidate.canonical} · {candidate.id} ·
                              {new URL(candidate.href).pathname}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {link.target
                          ? `Избрано: ${link.target.canonical}`
                          : "Нерешена цел — ще бъде проверена ръчно."}
                      </p>
                      <label className="grid gap-1 text-sm">
                        Контекст от статията
                        <Textarea
                          value={link.context}
                          maxLength={600}
                          rows={2}
                          placeholder="Кратък цитат около името, който определя точното срещане"
                          onChange={(event) =>
                            setLinks((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, context: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        Основание за връзката
                        <Textarea
                          value={link.evidence}
                          maxLength={600}
                          rows={2}
                          onChange={(event) =>
                            setLinks((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, evidence: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setLinks((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Премахни връзката
                      </Button>
                    </div>
                  );
                })}
                {links.length < 20 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setLinks((current) => [
                        ...current,
                        {
                          action: "add",
                          surface: "",
                          kind: "person",
                          query: "",
                          target: null,
                          currentHref: null,
                          context: "",
                          evidence: "",
                        },
                      ])
                    }
                  >
                    Добави предложение за връзка
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
