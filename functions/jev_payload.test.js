const test = require("node:test");
const assert = require("node:assert/strict");
const {
  JEV_MODEL,
  LIMITS,
  JevError,
  jevPayload,
  jevCharged,
} = require("./jev_payload");

const choice = (criteria) => ({
  state: "Какви са резултатите от изборите?",
  questions: {
    tool: { type: "choice", instructions: "Which tool?", criteria },
  },
});

const rejects = (body, code) =>
  assert.throws(
    () => jevPayload(body),
    (e) => e instanceof JevError && e.status === 400 && e.code === code,
    code,
  );

test("pins a VERSIONED model server-side and ignores any client-supplied one", () => {
  const out = jevPayload({ ...choice({ a: null, b: "B" }), model: "evil-model" });
  assert.equal(out.model, JEV_MODEL);
  // An alias would move under tuned confidence thresholds — the point of pinning.
  assert.doesNotMatch(JEV_MODEL, /latest|preview/);
});

test("passes through a well-formed choice question", () => {
  const out = jevPayload(choice({ turnout: "Voter turnout", results: null }));
  assert.deepEqual(out.questions.tool.criteria, {
    turnout: "Voter turnout",
    results: null,
  });
  assert.equal(out.questions.tool.type, "choice");
});

test("accepts all three primitives, and noul criteria stays optional", () => {
  const out = jevPayload({
    state: "x",
    questions: {
      a: { type: "choice", instructions: "i", criteria: { x: null, y: null } },
      b: { type: "score", instructions: "i", criteria: ["low", "high"] },
      c: { type: "noul", instructions: "i" },
      d: {
        type: "noul",
        instructions: "i",
        criteria: { true: "yes", false: "no" },
      },
    },
  });
  assert.equal(out.questions.c.criteria, undefined);
  assert.deepEqual(out.questions.d.criteria, { true: "yes", false: "no" });
  assert.deepEqual(out.questions.b.criteria, ["low", "high"]);
});

test("accepts structured (object/array) instructions and option descriptions", () => {
  const out = jevPayload({
    state: { question: "x" },
    questions: {
      tool: {
        type: "choice",
        instructions: { question: "Which tool?", focus: "the primary ask" },
        criteria: { a: { what: "A", examples: ["one"] }, b: null },
      },
    },
  });
  assert.equal(out.questions.tool.instructions.focus, "the primary ask");
  assert.deepEqual(out.questions.tool.criteria.a.examples, ["one"]);
});

test("rejects a malformed or missing state", () => {
  rejects({ questions: choice({ a: null }).questions }, "invalid_state");
  rejects({ state: null, questions: choice({ a: null }).questions }, "invalid_state");
  rejects(
    { state: "x".repeat(LIMITS.stateChars + 1), questions: choice({ a: null }).questions },
    "invalid_state",
  );
});

test("rejects an unknown question type", () => {
  rejects(
    { state: "x", questions: { q: { type: "essay", instructions: "i" } } },
    "invalid_question_type",
  );
});

test("requires instructions on every question", () => {
  rejects({ state: "x", questions: { q: { type: "noul" } } }, "invalid_instructions");
  rejects(
    {
      state: "x",
      questions: {
        q: { type: "noul", instructions: "i".repeat(LIMITS.instructionsChars + 1) },
      },
    },
    "invalid_instructions",
  );
});

// The caps are what keep a public, PAID endpoint from being handed an unbounded
// payload — input tokens are what Jev bills for.
test("caps the number of questions and the size of a choice's option set", () => {
  const many = {};
  for (let i = 0; i <= LIMITS.questions; i++)
    many[`q${i}`] = { type: "noul", instructions: "i" };
  rejects({ state: "x", questions: many }, "invalid_questions");

  const options = {};
  for (let i = 0; i <= LIMITS.options; i++) options[`o${i}`] = null;
  rejects(choice(options), "invalid_criteria");
});

test("rejects an empty question map and an empty option set", () => {
  rejects({ state: "x", questions: {} }, "invalid_questions");
  rejects(choice({}), "invalid_criteria");
});

test("rejects a score with fewer than two levels", () => {
  rejects(
    { state: "x", questions: { s: { type: "score", instructions: "i", criteria: ["only"] } } },
    "invalid_criteria",
  );
});

test("rejects an oversized option description or option key", () => {
  rejects(choice({ a: "d".repeat(LIMITS.optionChars + 1) }), "invalid_criteria");
  rejects(choice({ ["k".repeat(LIMITS.optionKeyChars + 1)]: null }), "invalid_criteria");
});

// The per-field caps MULTIPLY (8 x 300 x 600 is ~1.44M chars), so without an
// aggregate bound the only real limit was the caller's body cap in a different
// file. This is a paid endpoint and input tokens are what it bills for.
test("rejects a payload that is within every per-field cap but huge in aggregate", () => {
  const options = {};
  for (let i = 0; i < LIMITS.options; i++) options[`o${i}`] = "d".repeat(LIMITS.optionChars);
  rejects(choice(options), "input_too_large");
});

test("rejects empty instructions and undescribed rubric levels", () => {
  // Each is a billed call that cannot produce a useful classification.
  rejects({ state: "x", questions: { q: { type: "noul", instructions: "" } } }, "invalid_instructions");
  rejects(
    { state: "x", questions: { s: { type: "score", instructions: "i", criteria: [null, null] } } },
    "invalid_criteria",
  );
  rejects(
    { state: "x", questions: { n: { type: "noul", instructions: "i", criteria: { true: null } } } },
    "invalid_criteria",
  );
});

// An array state is legitimate — the API takes "a string, JSON object, or array
// of text values" (e.g. a sequence of chat messages).
test("accepts an array state", () => {
  const out = jevPayload({
    state: ["Hi", "What was the turnout?"],
    questions: { q: { type: "noul", instructions: "i" } },
  });
  assert.deepEqual(out.state, ["Hi", "What was the turnout?"]);
});

// Cost accounting. Jev bills $42/Btok input and $0 output, i.e. 0.042 µ$ per
// input token — pricing it with the Gemini formula would over-charge ~60x.
test("prices a Jev call at its own input-token rate, output free", () => {
  // The measured full-registry call: ~11,582 input tokens ≈ $0.000486.
  assert.equal(jevCharged({ input_tokens: 11582, output_tokens: 2603 }), 487);
  // Output tokens are free: changing them alone must not change the charge.
  assert.equal(
    jevCharged({ input_tokens: 11582, output_tokens: 0 }),
    jevCharged({ input_tokens: 11582, output_tokens: 99999 }),
  );
  assert.equal(jevCharged({ input_tokens: 0, output_tokens: 0 }), 0);
});

test("returns null for unusable usage so the caller keeps the full reservation", () => {
  assert.equal(jevCharged(undefined), null);
  assert.equal(jevCharged({}), null);
  assert.equal(jevCharged({ input_tokens: -1, output_tokens: 0 }), null);
  assert.equal(jevCharged({ input_tokens: 1.5, output_tokens: 0 }), null);
});

test("an ABSENT output_tokens cannot veto a good input_tokens", () => {
  // Output is billed at $0 and is not an input to the price. If an upstream
  // shape change could discard the usage over it, EVERY routing call would
  // silently settle at the full reservation (~60x) at a 200 — the one failure
  // in this module that nothing would surface.
  assert.equal(jevCharged({ input_tokens: 10 }), 1);
  assert.equal(jevCharged({ input_tokens: 11582 }), 487);
  // A MALFORMED one is still rejected, so the guard keeps discriminating.
  assert.equal(jevCharged({ input_tokens: 10, output_tokens: -1 }), null);
  assert.equal(jevCharged({ input_tokens: 10, output_tokens: 1.5 }), null);
  assert.equal(jevCharged({ input_tokens: 10, output_tokens: "5" }), null);
});
