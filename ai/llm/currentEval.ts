import { reviewCase } from "./currentEval.review";
import { parseModelRoute } from "../orchestrator/routeScope";
// Pure scoring for the production JSON router. Transport errors are never abstentions.
import { TOOLS } from "../tools/registry";
import {
  buildContext,
  CLOUD_BUDGET,
  renderRoutingContext,
  type TurnMemory,
} from "../orchestrator/memory";
import type { Lang } from "../tools/types";
// The ONE list of eval groups. `EvalCase["group"]`, the billed harness's
// `EVAL_CASE_GROUPS` selector and the non-AI floor denominator all derive from it,
// so adding a group cannot leave one of them behind.
export const EVAL_GROUPS = [
  "registry",
  "challenge",
  "holdout",
  "unsupported",
  "realistic",
  "clarification",
  "conversation",
  "starter",
] as const;
export type EvalGroup = (typeof EVAL_GROUPS)[number];
// The bank added in Rev 4 C7. It is recall-tainted (204 of the 284 raw
// starterPrompts.json entries are verbatim registry examples), so it is excluded
// from retriever-recall measurement and from the pre-registered floor
// denominator, and included for TOOL and ARGUMENT accuracy.
export const STARTER_GROUP: EvalGroup = "starter";
export const LEGACY_GROUPS = EVAL_GROUPS.filter(
  (g) => g !== STARTER_GROUP,
) as readonly Exclude<EvalGroup, "starter">[];

// One acceptable value for an argument. A scalar, or — for a `stringList` /
// `numberList` parameter — the whole list as ONE value. The distinction is
// load-bearing: `stringList` args carry a list as their VALUE, while `args` maps
// each key to the list of ACCEPTABLE values, so a list value must be wrapped
// rather than spread, or a multi-element list can never match itself.
export type ExpectedValue = string | number | (string | number)[];
export type ExpectedArgs = Record<string, ExpectedValue[]>;

export type EvalCase = {
  id: string;
  group: EvalGroup;
  tool: string | null;
  en: string;
  bg: string;
  review?: string;
  // Where the case came from when that is not a hand-authored group (e.g. the
  // chat starter bank). Deliberately NOT `review`: `review` means "a human revised
  // this expectation" and the eval screen renders it as such.
  source?: string;
  history?: Record<Lang, TurnMemory[]>;
  args?: ExpectedArgs;
  // Gold arguments that differ BY LANGUAGE, so a bilingual expectation is never
  // weakened into "either spelling is acceptable". Set only where the bank's two
  // languages disagree; otherwise `args` carries the single shared expectation.
  argsByLang?: Partial<Record<Lang, ExpectedArgs>>;
};
// The argument expectation for one language. The overlay is AUTHORITATIVE when
// present: a case that carries both fields means the languages disagree, so a
// language the overlay omits is unscored rather than silently graded against the
// other language's gold.
export const expectedArgs = (
  c: EvalCase,
  lang: Lang,
): ExpectedArgs | undefined => (c.argsByLang ? c.argsByLang[lang] : c.args);
export const registryEvalCases = (): EvalCase[] =>
  TOOLS.flatMap((t) =>
    t.examples.map((e, i) => ({
      id: `${t.name}:${i + 1}`,
      group: "registry" as const,
      tool: t.name,
      ...e,
    })),
  ).map(reviewCase);
const norm = (x: unknown) =>
  String(x).normalize("NFC").trim().toLocaleLowerCase();
// One acceptable value vs what the route produced. A list expectation is the
// whole list as one value (a `stringList` param), so it is compared element-wise
// rather than through `String(array)`, which would stringify it to "a,b" and
// never equal any element.
const sameValue = (actual: unknown, expected: ExpectedValue): boolean =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every(
        (v, i) => norm((actual as unknown[])[i] as never) === norm(v),
      )
    : norm(actual) === norm(expected);
export function scoreProduction(
  c: EvalCase,
  lang: Lang,
  raw: string,
  error?: string,
  // The candidate set the PROMPT was narrowed to. Production passes the same set to
  // `parseModelRoute`, so an eval that omits it would accept a tool production rejects
  // and would measure a path nobody runs. Omitted = the full catalogue (unchanged).
  allowed?: ReadonlySet<string>,
) {
  let obj: Record<string, unknown> | undefined;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) obj = v;
  } catch {
    /* invalid */
  }
  const parsed = parseModelRoute(raw, evalUserContent(c, lang), allowed);
  const selected = typeof obj?.tool === "string" ? obj.tool : null;
  const abstained = !!obj && obj.tool === null;
  const toolOk = !error && (c.tool === null ? abstained : selected === c.tool);
  const expected = expectedArgs(c, lang);
  const argScored = expected !== undefined;
  // `null` — never `true` — when the case carries no expectation, so a consumer
  // that averages `argsOk` over rows without also filtering `argScored` cannot
  // report an unannotated case as an argument pass. `toolgrad/evaluation.ts`
  // already uses this convention.
  const argsOk: boolean | null = !argScored
    ? null
    : !error &&
      parsed?.tool === c.tool &&
      !!parsed &&
      Object.entries(expected).every(([k, values]) =>
        values.some((v) => sameValue(parsed.args[k], v)),
      );
  const callOk =
    !error &&
    (c.tool === null
      ? abstained
      : parsed?.tool === c.tool && !!parsed && argsOk !== false);
  return {
    id: c.id,
    group: c.group,
    lang,
    expectedTool: c.tool,
    selected,
    parsed,
    jsonValid: !!obj && !error,
    toolOk,
    argScored,
    argsOk,
    callOk,
    // The usable call did not come from the model's own tool name: `parseModelRoute`
    // re-derived the declared tool from the QUESTION alone (procurement / funding /
    // roll-call intents). Such a case passes regardless of what the model emits, so
    // a run must be able to report it separately from real model accuracy.
    deterministicallyDerived:
      !!parsed && parsed.tool === c.tool && selected !== c.tool,
    raw,
    ...(error ? { error } : {}),
  };
}
export type EvalScore = ReturnType<typeof scoreProduction>;
export function summarize(scores: EvalScore[]) {
  const ratio = (xs: EvalScore[], key: "toolOk" | "callOk" | "jsonValid") =>
    xs.length ? xs.filter((s) => s[key]).length / xs.length : null;
  return Object.fromEntries(
    (["en", "bg"] as const).map((lang) => {
      const rows = scores.filter((s) => s.lang === lang);
      const annotated = rows.filter((s) => s.argScored);
      return [
        lang,
        {
          n: rows.length,
          toolAcc: ratio(rows, "toolOk"),
          callAcc: ratio(rows, "callOk"),
          argN: annotated.length,
          // `argsOk` is null on an unannotated row, so the filter is what makes
          // the ratio meaningful rather than the truthiness of the value.
          argAcc: annotated.length
            ? annotated.filter((s) => s.argsOk === true).length /
              annotated.length
            : null,
          jsonValidRate: ratio(rows, "jsonValid"),
          irrelevanceAcc: ratio(
            rows.filter((s) => s.expectedTool === null),
            "callOk",
          ),
          // Reported so a group whose cases are mostly self-scored cannot be read
          // as model accuracy.
          deterministicallyDerived: rows.filter(
            (s) => s.deterministicallyDerived,
          ).length,
          errors: rows.filter((s) => s.error).length,
        },
      ];
    }),
  );
}

// Use the same bounded context representation as the cloud provider.
export function evalUserContent(c: EvalCase, lang: Lang): string {
  const context = renderRoutingContext(
    buildContext(c.history?.[lang] ?? [], CLOUD_BUDGET),
    lang,
  );
  return context
    ? `${context}\n\n${lang === "bg" ? "Текущ въпрос" : "Current question"}: ${c[lang]}`
    : c[lang];
}
