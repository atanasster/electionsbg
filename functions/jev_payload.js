// Request validation + cost accounting for the Jev (TypeSafe System One) proxy
// action on the `llm` function.
//
// WHY A PROXY AT ALL: the chat is a static SPA, so it cannot hold
// TYPESAFE_API_KEY in the browser — same reason the Gemini path is proxied.
// The Jev action therefore rides the SAME security boundary (origin allowlist,
// body-size cap, session + question claim/settle) rather than standing up a
// second public paid endpoint with its own guards. See functions/llm_http.js.
//
// THE CLIENT NEVER CHOOSES THE MODEL. `model` is pinned server-side to a
// VERSIONED id, not the `jev-latest` alias: an alias moves when TypeSafe ships
// a release, and confidence thresholds tuned against one version do not
// necessarily hold on the next (docs.typesafe.ai/models says as much). Bumping
// it is a deliberate edit here, with a re-run of the regression suite.
const JEV_MODEL = "jev-1.13.0";
const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

// Input caps. The registry is ~236 tools, so a tool-selection Choice carries
// ~237 options; the ceiling leaves room without admitting an unbounded map.
//
// ⚠️ These are PER-FIELD, and they MULTIPLY: 8 questions x 300 options x 600
// chars is ~1.44M characters, all of which pass the individual checks. The
// aggregate bound is `totalChars` below — added because the only other thing
// standing between this module and an unbounded paid payload was the caller's
// 110KB body cap in llm_http.js, which lives in a different file with nothing
// linking the two. A second caller must still supply its own body cap.
const LIMITS = Object.freeze({
  questions: 8,
  options: 300,
  instructionsChars: 4000,
  optionChars: 600,
  optionKeyChars: 200,
  stateChars: 24000,
  scoreLevels: 24,
  totalChars: 100000,
});

const TYPES = new Set(["choice", "score", "noul"]);

// Byte-identical to llm_security's LlmError, and deliberately NOT imported from
// it: this module must stay dependency-free of the security module. The outer
// catch in llm_http.js handles both classes as one union — see the comment
// there. Do not "DRY" these together without reading it.
class JevError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => {
  throw new JevError(status, code);
};

// An EntryType: the API accepts a string, object, array or null anywhere
// instructions/criteria values are taken. We accept the same shapes but bound
// their SERIALIZED size, because a nested object is an unbounded payload
// otherwise.
const entry = (value, cap, code) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value.length > cap) fail(400, code);
    return value;
  }
  if (typeof value === "object") {
    let json;
    try {
      json = JSON.stringify(value);
    } catch {
      fail(400, code);
    }
    if (!json || json.length > cap) fail(400, code);
    return value;
  }
  fail(400, code);
};

const choiceCriteria = (criteria) => {
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria))
    fail(400, "invalid_criteria");
  const keys = Object.keys(criteria);
  if (!keys.length || keys.length > LIMITS.options) fail(400, "invalid_criteria");
  const out = {};
  for (const key of keys) {
    if (!key || key.length > LIMITS.optionKeyChars) fail(400, "invalid_criteria");
    out[key] = entry(criteria[key], LIMITS.optionChars, "invalid_criteria");
  }
  return out;
};

// Every level needs a description: Score's criteria IS the rubric, so an
// all-null array is a paid call that cannot produce a meaningful placement.
const scoreCriteria = (criteria) => {
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > LIMITS.scoreLevels)
    fail(400, "invalid_criteria");
  return criteria.map((level) => {
    const built = entry(level, LIMITS.optionChars, "invalid_criteria");
    if (built === null || built === "") fail(400, "invalid_criteria");
    return built;
  });
};

// Noul criteria is optional; when present it is {true, false} descriptions.
// A present-but-empty one is rejected rather than forwarded — it buys the
// question nothing and still costs a call.
const noulCriteria = (criteria) => {
  if (criteria === undefined || criteria === null) return undefined;
  if (typeof criteria !== "object" || Array.isArray(criteria))
    fail(400, "invalid_criteria");
  const out = {};
  for (const side of ["true", "false"])
    if (criteria[side] !== undefined) {
      const built = entry(criteria[side], LIMITS.optionChars, "invalid_criteria");
      if (built !== null && built !== "") out[side] = built;
    }
  if (!Object.keys(out).length) fail(400, "invalid_criteria");
  return out;
};

/** Validate the client's {state, questions} and return the upstream body with
 *  the model pinned. Throws JevError on anything malformed or oversized. */
function jevPayload(body) {
  const state = body?.state;
  if (state === undefined || state === null) fail(400, "invalid_state");
  // An ARRAY state is valid and intentionally allowed — the API takes "a
  // string, JSON object, or array of text values" (docs.typesafe.ai/concepts/state),
  // e.g. a sequence of chat messages. Unlike `questions` below, which is a
  // keyed map and where an array really would be malformed.
  const stateOk =
    typeof state === "string"
      ? state.length <= LIMITS.stateChars
      : typeof state === "object" &&
        JSON.stringify(state).length <= LIMITS.stateChars;
  if (!stateOk) fail(400, "invalid_state");

  const questions = body?.questions;
  if (!questions || typeof questions !== "object" || Array.isArray(questions))
    fail(400, "invalid_questions");
  const ids = Object.keys(questions);
  if (!ids.length || ids.length > LIMITS.questions) fail(400, "invalid_questions");

  const out = {};
  for (const id of ids) {
    const q = questions[id];
    if (!q || typeof q !== "object" || Array.isArray(q)) fail(400, "invalid_questions");
    if (!TYPES.has(q.type)) fail(400, "invalid_question_type");
    const built = {
      type: q.type,
      instructions: entry(q.instructions, LIMITS.instructionsChars, "invalid_instructions"),
    };
    // `""` is rejected alongside null: `entry` cannot tell absent from null, and
    // a question with no instructions is a billed call that asks nothing.
    if (built.instructions === null || built.instructions === "")
      fail(400, "invalid_instructions");
    if (q.type === "choice") built.criteria = choiceCriteria(q.criteria);
    else if (q.type === "score") built.criteria = scoreCriteria(q.criteria);
    else {
      const c = noulCriteria(q.criteria);
      if (c) built.criteria = c;
    }
    out[id] = built;
  }
  const upstream = { state, model: JEV_MODEL, questions: out };
  // Aggregate bound — the per-field caps multiply (see LIMITS). Checked on the
  // BUILT payload, so it bounds exactly what we are about to pay to send.
  if (JSON.stringify(upstream).length > LIMITS.totalChars)
    fail(400, "input_too_large");
  return upstream;
}

// Cost in MICRO-DOLLARS, the same unit llm_security's budget uses.
//
// Jev 1.13 is $42 per BILLION input tokens and bills output at $0
// (docs.typesafe.ai/models), i.e. 0.042 µ$ per input token — two orders of
// magnitude under the Gemini path, which is why settling Jev with the Gemini
// formula would over-charge a turn ~60x and burn the session's budget for
// nothing.
//
// Missing or malformed usage returns null so the caller keeps the full
// reservation: an unproven saving is never refunded (same rule as
// llm_security's `charged`).
const JEV_MICRO_DOLLARS_PER_INPUT_TOKEN = 0.042;

/**
 * Price a settled Jev call in MICRO-DOLLARS (llm_security's budget unit).
 *
 * @param usage - The upstream `usage` block. Server-to-server only; never
 *   client-supplied.
 * @returns The integer micro-dollar cost, or `null` when usage is unusable.
 *   ⚠️ `null` means "charge the FULL reservation", not "free" — an unproven
 *   saving is never refunded (the same rule as llm_security's `charged`).
 * @example
 *   jevCharged({ input_tokens: 11582, output_tokens: 2603 }); // 487
 */
function jevCharged(usage) {
  if (!usage || !Number.isInteger(usage.input_tokens) || usage.input_tokens < 0)
    return null;
  // `output_tokens` is billed at $0 and is NOT an input to the price, so it must
  // never veto a perfectly good `input_tokens`. Validating a field we do not use
  // is pure downside: an upstream that drops or renames it would otherwise make
  // EVERY routing call settle at the full reservation (~60x the real cost) at a
  // 200, with correct answers, no log line and no failing test. A malformed one
  // is still rejected — absent is fine, wrong is not.
  if (
    usage.output_tokens !== undefined &&
    (!Number.isInteger(usage.output_tokens) || usage.output_tokens < 0)
  )
    return null;
  return Math.ceil(usage.input_tokens * JEV_MICRO_DOLLARS_PER_INPUT_TOKEN);
}

module.exports = {
  JEV_MODEL,
  JEV_ENDPOINT,
  LIMITS,
  JevError,
  jevPayload,
  jevCharged,
  JEV_MICRO_DOLLARS_PER_INPUT_TOKEN,
};
