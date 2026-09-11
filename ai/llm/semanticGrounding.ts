import { digitRuns, numbersGrounded } from "./grounding";

// Conservative checks for the concrete semantic failures found by the pilot.
// This is not a general entailment checker: attribution, negation and every
// possible arithmetic paraphrase still need evaluation. Rejection uses templates.
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  million: 1000000,
  billion: 1000000000,
  нула: 0,
  един: 1,
  една: 1,
  едно: 1,
  два: 2,
  две: 2,
  три: 3,
  четири: 4,
  пет: 5,
  шест: 6,
  седем: 7,
  осем: 8,
  девет: 9,
  десет: 10,
  единадесет: 11,
  дванадесет: 12,
  тринадесет: 13,
  четиринадесет: 14,
  петнадесет: 15,
  шестнадесет: 16,
  седемнадесет: 17,
  осемнадесет: 18,
  деветнадесет: 19,
  двадесет: 20,
  тридесет: 30,
  четиридесет: 40,
  петдесет: 50,
  шестдесет: 60,
  седемдесет: 70,
  осемдесет: 80,
  деветдесет: 90,
  сто: 100,
  двеста: 200,
  триста: 300,
  четиристотин: 400,
  петстотин: 500,
  шестстотин: 600,
  седемстотин: 700,
  осемстотин: 800,
  деветстотин: 900,
  хиляда: 1000,
  хиляди: 1000,
  милион: 1000000,
  милиона: 1000000,
  милиард: 1000000000,
  милиарда: 1000000000,
};
const MOTIVATION =
  /interest|motivat|apathy|trust|confidence|интерес|мотивац|апати|довери/iu;
const CAUSE = /because|due to|caused|driven by|поради|дължи|причин/iu;
// Permit a literal explanation of missing data, not a causal inference about it.
const MISSING_EXPLANATION =
  /because (?:the )?([\p{L} ]+? (?:is|are) (?:not available|unavailable|missing))(?=[.,;!?]|$)/giu;
const RISK = /risk|screening|signal|риск|сигнал/iu;
const RISK_LEVEL =
  /minimal|negligible|severe|low (?:level|risk|count)|high (?:level|risk)|(?:small|few) (?:number|signal)|минимал|незначител|(?:нисък|ниско|висок|малък|малко)\s+(?:риск|ниво|брой|сигнал)/iu;
export function semanticGrounded(
  prose: string,
  facts: unknown,
  extra = "",
): boolean {
  if (!numbersGrounded(prose, facts, extra)) return false;
  const source = JSON.stringify(facts) ?? "";
  const tokens = new Set(digitRuns(source));
  const sourceWords = new Set(source.toLowerCase().match(/[\p{L}]+/gu) ?? []);
  const words = prose.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const isNumber = (word: string) =>
    Object.prototype.hasOwnProperty.call(NUMBER_WORDS, word);
  // Component membership is insufficient: 20 and 3 do not supply twenty-three.
  const numerals = Object.keys(NUMBER_WORDS).join("|");
  const compounds = new RegExp(
    `(?<![\\p{L}])(?:${numerals})(?:[ -]+(?:(?:and|и) )?(?:${numerals}))+(?![\\p{L}])`,
    "giu",
  );
  for (const phrase of prose.match(compounds) ?? [])
    if (!source.toLowerCase().includes(phrase.toLowerCase())) return false;
  for (const word of words) {
    const value = NUMBER_WORDS[word];
    // Exact source words are quotations. Compound verbal numerals without exact
    // support deliberately fall back; prompts ask models to write digits.
    if (isNumber(word) && !sourceWords.has(word) && !tokens.has(String(value)))
      return false;
  }
  if (MOTIVATION.test(prose) && !MOTIVATION.test(source)) return false;
  const causalProse = prose.replace(
    MISSING_EXPLANATION,
    (phrase, fact: string) =>
      source.toLowerCase().includes(fact.toLowerCase()) ? "" : phrase,
  );
  if (CAUSE.test(causalProse) && !CAUSE.test(source)) return false;
  if (RISK.test(source) && RISK_LEVEL.test(prose) && !RISK_LEVEL.test(source))
    return false;
  return true;
}
