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
  try {
    const obj = JSON.parse(raw);
    if (
      obj?.tool === "rankPlaces" &&
      ["regionalInvestment", "basketAffordability"].includes(
        obj.args?.indicator,
      ) &&
      Object.keys(obj.args).every((k) => ["indicator", "order"].includes(k))
    )
      return { tool: obj.args.indicator, args: {} };
  } catch {
    /* parser handles malformed JSON */
  }
  const parsed = parseToolCall(raw);
  if (
    parsed?.tool === "rankPlaces" &&
    ((/basket|кошниц/i.test(current) && /gdp|бвп/i.test(current)) ||
      /eu (?:funds|money)|европейски (?:средства|пари)|европар/i.test(current))
  )
    return null; // A valid metric code still cannot answer a different question.
  return validateRouteScope(parsed, question);
}
