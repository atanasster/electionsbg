import { rollcallCorpus } from "./rollcallUnderstanding";
import { understandFunding } from "./fundingUnderstanding";
import { understandProcurement } from "./procurementUnderstanding";
import { applyProductDefaults } from "./productDefaults";
import { route as heuristicRoute, type Route } from "./router";
import { parseToolCall } from "./toolSchema";
// Preserve explicit calendar scope using the existing deterministic election
// resolver, not a guessed date. A series cannot represent an anchored year.
export function validateRouteScope(selected: Route, question: string): Route {
  if (
    !selected ||
    !["turnoutSeries", "machineVoteSeries"].includes(selected.tool)
  )
    return selected;
  const current =
    question.split(/(?:Current question|Текущ въпрос):/i).at(-1) ?? question;
  if (!/\b20\d{2}\b/.test(current)) return selected;
  const resolved = heuristicRoute(current, { lang: "en", election: "" });
  return resolved?.tool === "turnout" &&
    selected.tool === "turnoutSeries" &&
    resolved.args.election
    ? resolved
    : null;
}
// Two reviewed model spellings name an existing specialist explicitly. No fuzzy
// tool matching and no fallback metric. Other undeclared indicators still fail.
export function parseModelRoute(raw: string, question: string): Route {
  const current =
    question
      .split(/(?:Current question|Текущ въпрос):/i)
      .at(-1)
      ?.trim() ?? question;
  const hasHistory = current !== question.trim();
  // A bare personal pronoun supplies no identity. Never execute a model-invented name.
  if (
    !hasHistory &&
    /^(?:and )?what (?:has|did) (?:he|she) declared?\??$|^(?:а )?(?:той|тя) какво е декларирал[аи]?\??$/i.test(
      current,
    )
  )
    return null;
  let obj: { tool?: string; args?: Record<string, unknown> } | undefined;
  try {
    obj = JSON.parse(raw);
    if (
      obj?.tool === "rankPlaces" &&
      typeof obj.args?.indicator === "string" &&
      ["regionalInvestment", "basketAffordability"].includes(
        obj.args.indicator,
      ) &&
      Object.keys(obj.args).every((k) => ["indicator", "order"].includes(k))
    )
      return { tool: obj.args.indicator, args: {} };
  } catch {
    /* parser handles malformed JSON */
  }
  const parsed = parseToolCall(raw);
  if (
    (parsed?.tool === "rankPlaces" || obj?.tool === "rankPlaces") &&
    ((/basket|кошниц/i.test(current) && /gdp|бвп/i.test(current)) ||
      /eu (?:funds|money)|европейски (?:средства|пари)|европар/i.test(current))
  )
    return null; // A valid metric code still cannot answer a different question.
  const legislative = rollcallCorpus(current);
  if (legislative)
    return {
      tool: "rollcallQuestion",
      args: { question: current, corpus: legislative },
    };
  const funding = understandFunding(current);
  if (funding.kind !== "none")
    return funding.kind === "query"
      ? { tool: "fundingQuery", args: funding.query }
      : { tool: "fundingQuestion", args: { question: current } };
  const procurement = understandProcurement(current);
  if (procurement.kind !== "none")
    return procurement.kind === "query"
      ? { tool: "procurementQuery", args: procurement.query }
      : { tool: "procurementQuestion", args: { question: current } };
  if (
    parsed &&
    [
      "rollcallQuery",
      "rollcallQuestion",
      "fundingQuery",
      "fundingQuestion",
    ].includes(parsed.tool)
  )
    return null; // No funding intent was established above.
  return applyProductDefaults(validateRouteScope(parsed, question), question);
}
