import { Input } from "@/components/ui/input";
import { electionNames } from "../../tools/dataset";
import {
  localCycleValues,
  numericParameter,
  parameterBounds,
  type ArgumentIssue,
} from "../../orchestrator/validateArguments";
import type { Lang, ToolArgs, ToolDef, ToolParam } from "../../tools/types";
const messages: Record<ArgumentIssue, [string, string]> = {
  required: ["Попълнете това поле.", "Complete this field."],
  number: ["Въведете цяло число.", "Enter a whole number."],
  range: [
    "Изберете стойност в посочения диапазон.",
    "Use a value within the shown range.",
  ],
  choice: ["Изберете поддържана стойност.", "Choose a supported value."],
  unknown: ["Неподдържан параметър.", "Unsupported parameter."],
  conflict: ["Противоречащи стойности.", "Conflicting values."],
};
export const ParameterForm = ({
  tool,
  lang,
  draft,
  errors,
  onChange,
}: {
  tool: ToolDef;
  lang: Lang;
  draft: ToolArgs;
  errors: Record<string, ArgumentIssue>;
  onChange: (draft: ToolArgs) => void;
}) => {
  const field = (p: ToolParam) => {
    const id = `param-${tool.name}-${p.name}`;
    const options =
      p.values ??
      (p.type === "cycle"
        ? localCycleValues()
        : p.type === "election"
          ? [
              ...electionNames(),
              ...new Set(electionNames().map((e) => e.slice(0, 4))),
            ]
          : p.type === "electionList"
            ? electionNames()
            : undefined);
    const value = draft[p.name] ?? p.default ?? "";
    const update = (value: ToolArgs[string]) =>
      onChange({ ...draft, [p.name]: value });
    const bounds = parameterBounds(p);
    return (
      <div key={p.name} className="min-w-0 space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium">
          {p.description[lang]}
          {p.required ? " *" : ""}
        </label>
        {options ? (
          <select
            id={id}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            multiple={p.type === "electionList"}
            value={
              p.type === "electionList"
                ? Array.isArray(value)
                  ? value
                  : []
                : String(value)
            }
            aria-invalid={!!errors[p.name]}
            aria-describedby={`${id}-hint`}
            onChange={(e) =>
              update(
                p.type === "electionList"
                  ? Array.from(e.target.selectedOptions, (o) => o.value)
                  : e.target.value,
              )
            }
          >
            {p.type !== "electionList" && (
              <option value="">
                {lang === "bg"
                  ? "Изберете (незадължително, ако няма *)"
                  : "Choose (optional unless marked *)"}
              </option>
            )}
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={id}
            className="min-h-11"
            type={numericParameter(p) ? "number" : "text"}
            step={numericParameter(p) ? 1 : undefined}
            min={bounds.min}
            max={bounds.max}
            value={String(value)}
            aria-invalid={!!errors[p.name]}
            aria-describedby={`${id}-hint`}
            onChange={(e) => update(e.target.value)}
          />
        )}
        <p
          id={`${id}-hint`}
          className={`text-xs ${errors[p.name] ? "text-destructive" : "text-muted-foreground"}`}
        >
          {errors[p.name]
            ? messages[errors[p.name]][lang === "bg" ? 0 : 1]
            : numericParameter(p) && bounds.min !== undefined
              ? `${bounds.min}–${bounds.max}`
              : p.type === "company"
                ? lang === "bg"
                  ? "Име на фирма или ЕИК"
                  : "Company name or EIK"
                : p.type === "person"
                  ? lang === "bg"
                    ? "Име на лице"
                    : "Person’s name"
                  : p.type === "electionList"
                    ? lang === "bg"
                      ? "Изберете една или повече дати (Ctrl / ⌘)."
                      : "Select one or more dates (Ctrl / ⌘)."
                    : ""}
        </p>
      </div>
    );
  };
  const required = tool.params.filter((p) => p.required);
  const optional = tool.params.filter((p) => !p.required);
  return (
    <div className="space-y-4">
      {required.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">{required.map(field)}</div>
      )}
      {optional.length > 0 && (
        <details
          open={
            required.length === 0 ||
            optional.some((p) => !!errors[p.name]) ||
            undefined
          }
        >
          <summary className="mb-3 cursor-pointer py-2 text-sm font-medium">
            {lang === "bg" ? "Допълнителни настройки" : "Optional settings"} (
            {optional.length})
          </summary>
          <div className="grid gap-4 sm:grid-cols-2">{optional.map(field)}</div>
        </details>
      )}
      {!tool.params.length && (
        <p className="text-sm text-muted-foreground">
          {lang === "bg"
            ? "Готово за изпълнение — не са нужни настройки."
            : "Ready to run — no settings needed."}
        </p>
      )}
    </div>
  );
};
