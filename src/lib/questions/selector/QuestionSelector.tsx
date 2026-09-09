import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QuestionParameterError, resolveQuestionSelection } from "../resolve";
import type {
  Language,
  QuestionCatalog,
  QuestionDefinition,
  QuestionParameter,
  ResolvedQuestionSelection,
} from "../types";
import {
  questionsForLeaf,
  searchQuestions,
  surfaceStatus,
  type QuestionSurface,
} from "./model";

export interface QuestionLookupOption {
  value: string;
  label: string;
  detail?: string;
  level?: string;
}

export interface QuestionLookupAdapter {
  search: (query: string) => Promise<QuestionLookupOption[]>;
}

export interface QuestionSelectorProps {
  catalog: QuestionCatalog;
  surface: QuestionSurface;
  lang: Language;
  onSelect: (selection: ResolvedQuestionSelection) => void;
  lookupAdapters?: Partial<
    Record<"place" | "person" | "company", QuestionLookupAdapter>
  >;
  initialCategoryId?: string;
  initialSubcategoryId?: string;
  initialQuestionId?: string;
  className?: string;
}

const text = {
  bg: {
    search: "Търсене на въпрос",
    categories: "Теми",
    more: "Още въпроси",
    fewer: "По-малко",
    use: "Използвай въпроса",
    unavailable: "Покажи и неналичните",
    noQuestions: "Няма въпроси за този избор.",
    back: "Назад",
    required: "Полето е задължително.",
  },
  en: {
    search: "Search questions",
    categories: "Topics",
    more: "More questions",
    fewer: "Show fewer",
    use: "Use question",
    unavailable: "Show unavailable too",
    noQuestions: "No questions match this selection.",
    back: "Back",
    required: "This field is required.",
  },
} as const;

const controlClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const choiceClass =
  "min-h-10 rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-card-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const localizedParameterError = (message: string, lang: Language) => {
  if (lang === "en") return message;
  if (message === "Required parameter missing") return text.bg.required;
  if (message === "Expected a number") return "Въведете число.";
  if (message === "Expected a finite number") return "Въведете крайно число.";
  if (message === "Expected a whole year") return "Въведете цяла година.";
  if (message === "Expected text") return "Въведете текст.";
  if (message === "NUL is not allowed") return "Този знак не е позволен.";
  if (message === "Value is not allowed") return "Изберете позволена стойност.";
  if (message === "Expected a valid YYYY-MM-DD date")
    return "Въведете валидна дата във формат ГГГГ-ММ-ДД.";
  if (message.startsWith("Minimum is "))
    return `Минималната стойност е ${message.slice("Minimum is ".length)}.`;
  if (message.startsWith("Maximum is "))
    return `Максималната стойност е ${message.slice("Maximum is ".length)}.`;
  return "Стойността не е валидна.";
};

const LookupField = ({
  parameter,
  value,
  lang,
  adapter,
  onChange,
  invalid,
  describedBy,
}: {
  parameter: QuestionParameter;
  value: unknown;
  lang: Language;
  adapter: QuestionLookupAdapter;
  onChange: (value: string, option?: QuestionLookupOption) => void;
  invalid?: boolean;
  describedBy?: string;
}) => {
  const [query, setQuery] = useState(String(value ?? ""));
  const [options, setOptions] = useState<QuestionLookupOption[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lookupError, setLookupError] = useState(false);
  useEffect(() => {
    let current = true;
    if (query.trim().length < 2) {
      setOptions([]);
      setOpen(false);
      setLookupError(false);
      return;
    }
    setLookupError(false);
    adapter
      .search(query)
      .then((next) => {
        if (!current) return;
        setOptions(next.slice(0, 8));
        setActiveIndex(-1);
      })
      .catch(() => {
        if (!current) return;
        setOptions([]);
        setOpen(false);
        setLookupError(true);
      });
    return () => {
      current = false;
    };
  }, [adapter, query]);
  return (
    <div className="relative">
      <input
        id={`question-parameter-${parameter.id}`}
        className={controlClass}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && options.length > 0}
        aria-controls={`question-options-${parameter.id}`}
        aria-activedescendant={
          open && activeIndex >= 0
            ? `question-option-${parameter.id}-${activeIndex}`
            : undefined
        }
        aria-required={parameter.required}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
          onChange("");
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActiveIndex(-1);
          } else if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => (current + 1) % options.length);
          } else if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              current <= 0 ? options.length - 1 : current - 1,
            );
          } else if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            const option = options[activeIndex];
            setQuery(option.label);
            setOpen(false);
            setActiveIndex(-1);
            onChange(option.value, option);
          }
        }}
        autoComplete="off"
      />
      {open && options.length > 0 && (
        <ul
          id={`question-options-${parameter.id}`}
          role="listbox"
          aria-label={`${parameter.label[lang]} — ${lang === "bg" ? "резултати" : "results"}`}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {options.map((option, index) => (
            <li
              key={`${option.value}:${option.label}`}
              id={`question-option-${parameter.id}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              className="cursor-pointer rounded px-3 py-2 text-left text-sm hover:bg-secondary aria-selected:bg-secondary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(option.label);
                setOpen(false);
                setActiveIndex(-1);
                onChange(option.value, option);
              }}
            >
              <span className="block font-medium">{option.label}</span>
              {(option.detail || option.level) && (
                <span className="block text-xs text-muted-foreground">
                  {[option.level, option.detail].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {lookupError && (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {lang === "bg"
            ? "Търсенето временно не е достъпно. Опитайте отново."
            : "Search is temporarily unavailable. Try again."}
        </p>
      )}
      <span className="sr-only">
        {lang === "bg"
          ? "Изберете еднозначен резултат"
          : "Choose an unambiguous result"}
      </span>
    </div>
  );
};

export const QuestionSelector = ({
  catalog,
  surface,
  lang,
  onSelect,
  lookupAdapters = {},
  initialCategoryId,
  initialSubcategoryId,
  initialQuestionId,
  className = "",
}: QuestionSelectorProps) => {
  const copy = text[lang];
  const requestedQuestion = catalog.questions.find(
    (item) =>
      item.id === initialQuestionId && surfaceStatus(item, surface) === "ready",
  );
  const requestedCategory = catalog.categories.find(
    (item) => item.id === initialCategoryId,
  );
  const requestedSubcategory = requestedCategory?.subcategories.find(
    (item) => item.id === initialSubcategoryId,
  );
  const [categoryId, setCategoryId] = useState(
    requestedQuestion?.categoryId ?? requestedCategory?.id,
  );
  const [subcategoryId, setSubcategoryId] = useState(
    requestedQuestion?.subcategoryId ?? requestedSubcategory?.id,
  );
  const [questionId, setQuestionId] = useState(requestedQuestion?.id);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(
    requestedQuestion?.defaults ?? {},
  );
  const [lookupChoice, setLookupChoice] = useState<
    Record<string, QuestionLookupOption | undefined>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const questionHeading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (questionId) questionHeading.current?.focus();
  }, [questionId]);

  const category = catalog.categories.find((item) => item.id === categoryId);
  const subcategory = category?.subcategories.find(
    (item) => item.id === subcategoryId,
  );
  const question = catalog.questions.find((item) => item.id === questionId);
  const matches = useMemo(
    () =>
      query
        ? searchQuestions(catalog, surface, lang, query, includeUnavailable)
        : categoryId && subcategoryId
          ? questionsForLeaf(
              catalog,
              surface,
              categoryId,
              subcategoryId,
              includeUnavailable,
            )
          : [],
    [
      catalog,
      surface,
      lang,
      query,
      categoryId,
      subcategoryId,
      includeUnavailable,
    ],
  );
  const visibleQuestions = showAll ? matches : matches.slice(0, 5);

  const focusAfter = (id: string) =>
    queueMicrotask(() => {
      document.getElementById(id)?.focus();
    });
  const clearQuestion = () => {
    const previousQuestionId = questionId;
    setQuestionId(undefined);
    setValues({});
    setLookupChoice({});
    setErrors({});
    if (previousQuestionId) focusAfter(`question-choice-${previousQuestionId}`);
  };
  const back = () => {
    if (questionId) return clearQuestion();
    if (query) {
      setQuery("");
      focusAfter("question-search");
      return;
    }
    if (subcategoryId) {
      const previousSubcategoryId = subcategoryId;
      setSubcategoryId(undefined);
      focusAfter(`question-subcategory-${previousSubcategoryId}`);
      return;
    }
    if (categoryId) {
      const previousCategoryId = categoryId;
      setCategoryId(undefined);
      focusAfter(`question-category-${previousCategoryId}`);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && (questionId || categoryId)) {
      event.preventDefault();
      back();
    }
  };
  const chooseQuestion = (selected: QuestionDefinition) => {
    setQuestionId(selected.id);
    setValues(selected.defaults);
    setLookupChoice({});
    setErrors({});
  };
  const clearParameterError = (parameterId: string) =>
    setErrors((current) => {
      if (!(parameterId in current)) return current;
      const next = { ...current };
      delete next[parameterId];
      return next;
    });
  const setParameterValue = (parameterId: string, value: unknown) => {
    setValues((current) => ({ ...current, [parameterId]: value }));
    clearParameterError(parameterId);
  };
  const clearLookupValue = (parameterId: string) => {
    setValues((current) => {
      const next = { ...current };
      delete next[parameterId];
      return next;
    });
    setLookupChoice((current) => {
      const next = { ...current };
      delete next[parameterId];
      return next;
    });
    clearParameterError(parameterId);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!question || surfaceStatus(question, surface) !== "ready") return;
    try {
      onSelect(resolveQuestionSelection(question, values));
      setErrors({});
    } catch (error) {
      if (error instanceof QuestionParameterError)
        setErrors({
          [error.parameterId]: localizedParameterError(error.message, lang),
        });
      else throw error;
    }
  };

  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 text-card-foreground sm:p-4 ${className}`}
      onKeyDown={onKeyDown}
      aria-label={copy.categories}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(categoryId || query) && (
          <button type="button" className={choiceClass} onClick={back}>
            ← {copy.back}
          </button>
        )}
        <nav aria-label="Breadcrumb" className="text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li>{copy.categories}</li>
            {category && (
              <li aria-current={!subcategory ? "page" : undefined}>
                / {category.label[lang]}
              </li>
            )}
            {subcategory && (
              <li aria-current={!question ? "page" : undefined}>
                / {subcategory.label[lang]}
              </li>
            )}
          </ol>
        </nav>
      </div>

      <label
        className="mt-3 block text-sm font-medium"
        htmlFor="question-search"
      >
        {copy.search}
      </label>
      <input
        id="question-search"
        type="search"
        className={`${controlClass} mt-1`}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setQuestionId(undefined);
          setShowAll(false);
        }}
      />

      {!query && !categoryId && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.categories
            .filter((item) =>
              catalog.questions.some(
                (questionItem) =>
                  questionItem.categoryId === item.id &&
                  (includeUnavailable ||
                    surfaceStatus(questionItem, surface) === "ready"),
              ),
            )
            .map((item) => (
              <button
                key={item.id}
                id={`question-category-${item.id}`}
                type="button"
                className={choiceClass}
                onClick={() => {
                  setCategoryId(item.id);
                  setSubcategoryId(undefined);
                }}
              >
                {item.label[lang]}
              </button>
            ))}
        </div>
      )}

      {!query && category && !subcategoryId && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {category.subcategories
            .filter((item) =>
              catalog.questions.some(
                (questionItem) =>
                  questionItem.categoryId === category.id &&
                  questionItem.subcategoryId === item.id &&
                  (includeUnavailable ||
                    surfaceStatus(questionItem, surface) === "ready"),
              ),
            )
            .map((item) => (
              <button
                key={item.id}
                id={`question-subcategory-${item.id}`}
                type="button"
                className={choiceClass}
                onClick={() => {
                  setSubcategoryId(item.id);
                }}
              >
                {item.label[lang]}
              </button>
            ))}
        </div>
      )}

      {(query || subcategoryId) && !question && (
        <div className="mt-3 space-y-2">
          {visibleQuestions.map((item) => {
            const status = surfaceStatus(item, surface);
            return (
              <button
                key={item.id}
                id={`question-choice-${item.id}`}
                type="button"
                className={`${choiceClass} block w-full ${status !== "ready" ? "opacity-70" : ""}`}
                aria-disabled={status !== "ready"}
                onClick={() => {
                  if (status === "ready") chooseQuestion(item);
                }}
              >
                <span className="block">{item.question[lang]}</span>
                {status !== "ready" && item[surface].reason && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {item[surface].reason?.[lang]}
                  </span>
                )}
              </button>
            );
          })}
          {!visibleQuestions.length && (
            <p className="py-4 text-sm text-muted-foreground">
              {copy.noQuestions}
            </p>
          )}
          {matches.length > 5 && (
            <button
              type="button"
              className={choiceClass}
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? copy.fewer : copy.more}
            </button>
          )}
        </div>
      )}

      {question && (
        <form className="mt-4 space-y-3" onSubmit={submit} noValidate>
          <h3
            ref={questionHeading}
            tabIndex={-1}
            className="font-semibold outline-none"
          >
            {question.question[lang]}
          </h3>
          {question.parameters.map((parameter) => {
            const adapter =
              parameter.kind === "place" ||
              parameter.kind === "person" ||
              parameter.kind === "company"
                ? lookupAdapters[parameter.kind]
                : undefined;
            const selected = lookupChoice[parameter.id];
            const errorId = `question-parameter-${parameter.id}-error`;
            const hasError = Boolean(errors[parameter.id]);
            return (
              <div key={parameter.id}>
                <label
                  htmlFor={`question-parameter-${parameter.id}`}
                  className="block text-sm font-medium"
                >
                  {parameter.label[lang]}
                </label>
                {adapter ? (
                  <LookupField
                    parameter={parameter}
                    value={values[parameter.id]}
                    lang={lang}
                    adapter={adapter}
                    invalid={hasError}
                    describedBy={hasError ? errorId : undefined}
                    onChange={(value, option) => {
                      if (!option) return clearLookupValue(parameter.id);
                      setParameterValue(parameter.id, value);
                      setLookupChoice((current) => ({
                        ...current,
                        [parameter.id]: option,
                      }));
                    }}
                  />
                ) : parameter.kind === "enum" ? (
                  <select
                    id={`question-parameter-${parameter.id}`}
                    className={controlClass}
                    required={parameter.required}
                    aria-invalid={hasError}
                    aria-describedby={hasError ? errorId : undefined}
                    value={String(values[parameter.id] ?? "")}
                    onChange={(event) =>
                      setParameterValue(parameter.id, event.target.value)
                    }
                  >
                    <option value="">—</option>
                    {parameter.values?.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`question-parameter-${parameter.id}`}
                    className={controlClass}
                    type={
                      parameter.kind === "date"
                        ? "date"
                        : parameter.kind === "number" ||
                            parameter.kind === "year"
                          ? "number"
                          : "text"
                    }
                    min={parameter.min}
                    max={parameter.max}
                    required={parameter.required}
                    aria-invalid={hasError}
                    aria-describedby={hasError ? errorId : undefined}
                    value={String(values[parameter.id] ?? "")}
                    onChange={(event) =>
                      setParameterValue(parameter.id, event.target.value)
                    }
                  />
                )}
                {selected && (selected.level || selected.detail) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[selected.level, selected.detail]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {errors[parameter.id] && (
                  <p
                    id={errorId}
                    className="mt-1 text-sm text-destructive"
                    role="alert"
                  >
                    {errors[parameter.id] || copy.required}
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="submit"
            className="min-h-10 rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-accent-strong-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {copy.use}
          </button>
        </form>
      )}

      <label className="mt-4 flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={includeUnavailable}
          onChange={(event) => setIncludeUnavailable(event.target.checked)}
          className="h-4 w-4 accent-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {copy.unavailable}
      </label>
    </div>
  );
};
