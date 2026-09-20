#!/usr/bin/env python3
"""Ask Jev (TypeSafe System One) a batch of typed questions about one state.

Phase 3.2 of `docs/plans/news-jev-realtime-cloud-worker-v1.md`. Two existing
implementations are ported rather than reinvented, because both encode
decisions that cost something to learn:

  * `functions/jev_payload.js` — payload validation and the `LIMITS` budget.
    Its caps are PER-FIELD and MULTIPLY, which is why `total_chars` exists.
  * `ai/llm/jevClient.ts` — the never-throw contract, the circuit breaker and
    the timeout. Jev is an accelerator inside a lane and must never be able
    to take the lane down.

THE CONTRACT THIS MODULE OWES ITS CALLERS: `ask()` NEVER RAISES and never
hangs. Every failure — a timeout, a 5xx, a malformed answer, our own invalid
payload, an open breaker — comes back as a falsy `JevOutcome` carrying the
reason. The news pipeline's fallback is GLM, which is slower and more
expensive but always available.

⚠️ EXCEPT ONE THING, AND IT IS THE POINT OF `JevOutcome.report_worthy`. The plan
says to treat a schema change as "Jev unavailable" and fall through quietly.
But a **400 on a payload of ours is a bug**, not an outage, and falling
through silently would hide it for ever while paying GLM for every article.
Measured in Phase 3.1 (`news/evals/jev-contract-2026-09-20.md`), the endpoint
distinguishes the cases and so does this client:

    invalid_request   our payload was refused — a BUG, report it
    too_large         the article does not fit — neither bug nor outage
    unavailable       404/410/unrecognised shape — the alpha endpoint moved
    http_error / timeout / network / malformed / breaker_open

Everything Phase 3.1 measured that changes the code is marked ⚠️ below.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

# --- configuration (never constants: the plan requires a TypeSafe-direct
# --- fallback, `api.typesafe.ai/v1/systemone`, to be a config change) -------
ENDPOINT = os.environ.get(
    "NEWS_JEV_URL", "https://openrouter.ai/api/alpha/decisions")
# ⚠️ THE PINNED ID, NOT THE ALIAS. An alias moves when TypeSafe ships a
# release, and confidence thresholds tuned against one version need not hold
# on the next. Phase 3.1 verified the dated id is accepted and that the
# response echoes the resolved `model`, so a caller can check what answered.
MODEL = os.environ.get("NEWS_JEV_MODEL", "typesafe/jev-1.13-20260917")

# ⚠️ 2.5 s in the chat, where a human is waiting. This is a batch pipeline
# whose alternative is a ~5 s GLM call, and Phase 3.1 measured 339–1,614 ms
# with the slow end on a session's first call — so a 2.5 s budget would
# abandon exactly those and fall through to the slower path.
TIMEOUT_S = float(os.environ.get("NEWS_JEV_TIMEOUT_S", "8"))

# Circuit breaker: after this many consecutive failures, stop calling for the
# cooldown, so an outage costs ONE timeout rather than one per article.
BREAKER_THRESHOLD = int(os.environ.get("NEWS_JEV_BREAKER_THRESHOLD", "3"))
BREAKER_COOLDOWN_S = float(os.environ.get("NEWS_JEV_BREAKER_COOLDOWN_S", "60"))

# Ported verbatim from functions/jev_payload.js. ⚠️ PER-FIELD AND THEY
# MULTIPLY: 8 questions x 300 options x 600 chars is ~1.44M characters, all
# of which pass the individual checks — `total_chars` is the aggregate bound.
LIMITS = {
    "questions": 8,
    "options": 300,
    "instructions_chars": 4000,
    "option_chars": 600,
    "option_key_chars": 200,
    "state_chars": 24000,
    "score_levels": 24,
    "total_chars": 100000,
}
TYPES = ("choice", "score", "noul")

# ⚠️ Phase 3.1: Bulgarian costs ~0.92 tokens per character of JSON payload,
# so the 32,000-token context is ~32–39k characters and the 24,000-char state
# cap above sits inside it with headroom. That is a coincidence of two
# independently chosen numbers, NOT a derivation — do not "tighten" one to
# match the other.
PRICE_PER_M_INPUT = 0.042


class JevPayloadError(ValueError):
    """Our payload is invalid. Raised by `build_payload`, never by `ask`."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class JevOutcome:
    """What one call produced — the answers, or why there are none.

    ⚠️ THE REASON TRAVELS WITH THE CALL, NOT IN MODULE STATE. `jevClient.ts`
    keeps `lastJevSkip()` global and says in its own docstring that the
    pairing is "only valid while calls do not overlap" — true in the chat,
    where there is one routing call per turn. This client is called from
    `analyze_local.py`'s ThreadPoolExecutor, so that precondition does not
    come with the port: measured under a 12-worker pool, 402 of ~411 failing
    calls read back ANOTHER thread's reason and 363 read `None`, which means
    `report_worthy_skip()` could not see an `invalid_request` in production —
    inverting the entire justification for having it.

    Falsy when there is no answer, so `if not out:` reads naturally.
    """

    __slots__ = ("answers", "usage", "model", "ms", "skip")

    def __init__(self, answers=None, usage=None, model=None, ms=0, skip=None):
        self.answers = answers
        self.usage = usage or {}
        self.model = model
        self.ms = ms
        self.skip = skip

    def __bool__(self):
        return self.answers is not None

    @property
    def report_worthy(self):
        """True when this skip was OUR bug and must not pass quietly.

        Compared on the reason's HEAD, before any `:detail` suffix: the
        pre-flight skip carries the validator's code
        (`invalid_request:invalid_state`) so a log line says which field, and
        an exact-set test silently missed every one of them — the one class
        this exists to catch was the one it could not see.
        """
        return (self.skip or "").split(":", 1)[0] in REPORT_WORTHY

    def __repr__(self):
        if self:
            return f"<JevOutcome {len(self.answers)} answers in {self.ms}ms>"
        return f"<JevOutcome skip={self.skip!r}>"


def _dumps(value, code):
    """json.dumps, but a value we cannot serialize is OUR error, not a crash.

    ⚠️ `jev_payload.js` wraps its `JSON.stringify` in a try/catch for the
    circular-reference case, and the port dropped it — which is a far wider
    hole in Python than in JS, because `json.dumps` also refuses `datetime`,
    `set`, `bytes`, `Decimal` and a tuple key, all of which a caller
    assembling a state from parsed records produces without trying. Each one
    raised straight out of `ask()`, breaking the never-raise contract on the
    ordinary path rather than an exotic one.
    """
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError, RecursionError):
        raise JevPayloadError(code) from None


def _entry(value, cap, code):
    """An EntryType: a string, object, array or None anywhere instructions or
    criteria values are taken. The SERIALIZED size is what is bounded — a
    nested object is an unbounded payload otherwise."""
    if value is None:
        return None
    text = value if isinstance(value, str) else _dumps(value, code)
    if len(text) > cap:
        raise JevPayloadError(code)
    return value


def _choice_criteria(criteria):
    if not isinstance(criteria, dict) or not criteria:
        raise JevPayloadError("invalid_criteria")
    if len(criteria) > LIMITS["options"]:
        raise JevPayloadError("invalid_criteria")
    out = {}
    for key, value in criteria.items():
        if not isinstance(key, str) or not key or \
                len(key) > LIMITS["option_key_chars"]:
            raise JevPayloadError("invalid_criteria")
        out[key] = _entry(value, LIMITS["option_chars"], "invalid_criteria")
    return out


def _score_criteria(criteria):
    # Every level needs a description: Score's criteria IS the rubric, so an
    # all-null array is a paid call that cannot produce a meaningful placement.
    if not isinstance(criteria, list) or not (
            2 <= len(criteria) <= LIMITS["score_levels"]):
        raise JevPayloadError("invalid_criteria")
    out = []
    for level in criteria:
        built = _entry(level, LIMITS["option_chars"], "invalid_criteria")
        if built is None or built == "":
            raise JevPayloadError("invalid_criteria")
        out.append(built)
    return out


def _noul_criteria(criteria):
    # Optional; when present it is {true, false} descriptions. A
    # present-but-empty one is rejected rather than forwarded — it buys the
    # question nothing and still costs a call.
    if criteria is None:
        return None
    if not isinstance(criteria, dict):
        raise JevPayloadError("invalid_criteria")
    out = {}
    for side in ("true", "false"):
        if side in criteria:
            built = _entry(criteria[side], LIMITS["option_chars"],
                           "invalid_criteria")
            if built is not None and built != "":
                out[side] = built
    if not out:
        raise JevPayloadError("invalid_criteria")
    return out


def build_payload(state, questions, model=None):
    """Validate {state, questions} and return the upstream body, model pinned.

    Raises JevPayloadError on anything malformed or oversized — deliberately
    BEFORE the network, so an invalid payload costs nothing and is reported
    as our bug rather than as an outage.
    """
    if state is None:
        raise JevPayloadError("invalid_state")
    # An ARRAY state is valid and intentionally allowed — the API takes a
    # string, JSON object, or array of text values.
    text = state if isinstance(state, str) else _dumps(state, "invalid_state")
    if len(text) > LIMITS["state_chars"]:
        raise JevPayloadError("invalid_state")

    if not isinstance(questions, dict) or not questions:
        raise JevPayloadError("invalid_questions")
    if len(questions) > LIMITS["questions"]:
        raise JevPayloadError("invalid_questions")

    out = {}
    for qid, q in questions.items():
        # ⚠️ Object.keys() is always a string in JS; a Python dict key is not.
        # A tuple or int key serializes... or raises, depending on the type,
        # and either way the answers come back under a key the caller cannot
        # match to its question.
        if not isinstance(qid, str) or not qid:
            raise JevPayloadError("invalid_questions")
        if not isinstance(q, dict):
            raise JevPayloadError("invalid_questions")
        if q.get("type") not in TYPES:
            raise JevPayloadError("invalid_question_type")
        built = {"type": q["type"],
                 "instructions": _entry(q.get("instructions"),
                                        LIMITS["instructions_chars"],
                                        "invalid_instructions")}
        # "" is rejected alongside None: a question with no instructions is a
        # billed call that asks nothing.
        if built["instructions"] is None or built["instructions"] == "":
            raise JevPayloadError("invalid_instructions")
        if q["type"] == "choice":
            built["criteria"] = _choice_criteria(q.get("criteria"))
        elif q["type"] == "score":
            built["criteria"] = _score_criteria(q.get("criteria"))
        else:
            c = _noul_criteria(q.get("criteria"))
            if c:
                built["criteria"] = c
        out[qid] = built

    payload = {"model": model or MODEL, "state": state, "questions": out}
    # Aggregate bound, checked on the BUILT payload so it bounds exactly what
    # we are about to pay to send.
    if len(_dumps(payload, "input_too_large")) > LIMITS["total_chars"]:
        raise JevPayloadError("input_too_large")
    return payload


# ---- answers ---------------------------------------------------------------

# ⚠️ THE THREE PRIMITIVES RETURN THREE DIFFERENT SHAPES (Phase 3.1):
#   choice → {type, choice, probabilities{}, confidence}
#   score  → {type, score, legend{}, probabilities{}, confidence}
#   noul   → {type, noul: 0.99}        ← no confidence, no probabilities
# A uniform `answer["confidence"]` read gets nothing on every noul — and
# noul's value IS its probability, so treating a missing confidence as "low"
# discards the answer exactly when it is most certain.
def confidence_of(answer):
    """The answer's confidence in [0, 1], per type. None if unreadable.

    For `noul` the confidence is the DISTANCE FROM 0.5, doubled: 0.99 and
    0.01 are both near-certain answers (yes and no), while 0.5 is no answer
    at all. Reading `noul` itself as a confidence would rate a confident "no"
    as the least reliable reading on the scale.
    """
    if not isinstance(answer, dict):
        return None
    if answer.get("type") == "noul":
        return _clamped(answer.get("noul"), lambda v: abs(v - 0.5) * 2)
    return _clamped(answer.get("confidence"), lambda v: v)


def _clamped(value, transform):
    """A confidence in [0, 1], or None — and NaN is None, never 1.0.

    ⚠️ `min(1.0, nan)` RETURNS nan's partner, so the first cut read NaN,
    -3.0 and 7.0 as MAXIMUM confidence while the branch beside it failed
    safe. One function, two opposite directions, on the value that decides
    whether an answer is trusted — and `jevClient.ts:250` carries a comment
    expressly forbidding exactly that.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    if value != value:  # NaN
        return None
    result = transform(value)
    return max(0.0, min(1.0, result))


def _looks_like_answers(body):
    answers = body.get("answers") if isinstance(body, dict) else None
    if not isinstance(answers, dict) or not answers:
        return False
    return all(isinstance(a, dict) and a.get("type") in TYPES
               for a in answers.values())


# ---- circuit breaker (module state: one process, one breaker) --------------

_consecutive_failures = 0
_open_until = 0.0
# ⚠️ The breaker IS legitimately shared — "is the endpoint down" is a fact
# about the process, not about one article — so unlike the skip reason it
# stays module state, and takes a lock because the pool mutates it from
# several threads at once.
_breaker_lock = threading.Lock()

# Which skips are OURS to fix rather than the endpoint's to recover from.
# `too_large` is deliberately in neither camp: it is a property of the
# article, and the caller trims or skips.
REPORT_WORTHY = frozenset({"invalid_request", "malformed"})


def breaker_open(now=None):
    return (now if now is not None else time.monotonic()) < _open_until


def reset_breaker():
    """Clears the breaker. (The skip reason lives on each JevOutcome.)"""
    global _consecutive_failures, _open_until
    with _breaker_lock:
        _consecutive_failures = 0
        _open_until = 0.0


def _record_failure(now):
    global _consecutive_failures, _open_until
    with _breaker_lock:
        _consecutive_failures += 1
        if _consecutive_failures >= BREAKER_THRESHOLD:
            _open_until = now + BREAKER_COOLDOWN_S
            # Half-open: the next call after the cooldown is allowed through
            # and a success resets the count. Keeping the counter AT the
            # threshold means a still-broken upstream re-opens on ONE failure
            # rather than three.
            _consecutive_failures = BREAKER_THRESHOLD


def _note_success():
    global _consecutive_failures
    with _breaker_lock:
        _consecutive_failures = 0


def _skip(reason, now=None, count=True):
    if count:
        _record_failure(now if now is not None else time.monotonic())
    return JevOutcome(skip=reason)


# The endpoint's own over-size signal, from a captured 400 (Phase 3.1). It
# arrives nested inside a stringified upstream body, hence a substring test.
_TOO_LARGE_RE = re.compile(r"max_tokens_exceeded")

# A response body this size is not an answer — an answer is ~300–650 bytes
# measured. The cap bounds memory for a peer that never stops sending.
MAX_RESPONSE_BYTES = int(os.environ.get("NEWS_JEV_MAX_RESPONSE_BYTES",
                                        str(1 << 20)))


class _DeadlineExceeded(Exception):
    pass


def _read_within(resp, *, deadline, clock, chunk=65536):
    """Read a body under a TOTAL deadline, not a per-socket-operation one.

    ⚠️ `urllib`'s `timeout=` applies to each socket operation separately, so
    a peer that drips one byte just under the timeout holds the connection
    for ever while every individual read looks healthy. `AbortSignal.timeout()`
    in `jevClient.ts` is a total deadline and this port silently weakened it:
    measured, a drip-feeding peer held a 2.0 s budget for 12.1 s, and nothing
    bounds it in principle. That is the same shape as the 772 s stall the
    plan's §0.11 E1 diagnoses — a stage with no output and no error.

    The bound is the deadline plus at most one chunk's socket wait, which is
    what a single blocking read can cost after the last check.
    """
    out = bytearray()
    while True:
        if clock() > deadline:
            raise _DeadlineExceeded()
        piece = resp.read(chunk)
        if not piece:
            break
        out += piece
        if len(out) > MAX_RESPONSE_BYTES:
            raise _DeadlineExceeded()
    return bytes(out).decode("utf-8", errors="replace")


def ask(state, questions, *, api_key=None, timeout_s=None, model=None,
        urlopen=None, now=None):
    """Ask one batched question set about one state. NEVER raises.

    ⚠️ ONE CALL PER ARTICLE, every question in it. Phase 3.1 measured the
    state billed once per request: three separate calls cost 2,558 input
    tokens against 1,116 batched — a 56% saving and one round trip instead
    of three.

    Returns a JevOutcome — truthy with `.answers`, `.usage`, `.model` and
    `.ms`; falsy with `.skip` saying why and `.report_worthy` saying whether
    it is ours to fix. Both travel WITH the call, so the pool is safe.
    """
    clock = now or time.monotonic
    started = clock()

    key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not key:
        # Not a failure of the endpoint, so it must not move the breaker: a
        # misconfigured process would otherwise open it and then report an
        # outage that never happened.
        return _skip("no_key", count=False)
    if breaker_open(started):
        return _skip("breaker_open", count=False)

    try:
        payload = build_payload(state, questions, model=model)
    except JevPayloadError as e:
        # ⚠️ OUR bug, caught before the network. Does not touch the breaker —
        # one malformed article must not stop Jev being asked about the rest.
        return _skip(f"invalid_request:{e.code}", count=False)

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(ENDPOINT, data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    opener = urlopen or urllib.request.urlopen
    budget = timeout_s or TIMEOUT_S
    try:
        with opener(request, timeout=budget) as resp:
            raw = _read_within(resp, deadline=started + budget, clock=clock)
        parsed = json.loads(raw)
    except urllib.error.HTTPError as e:
        status = getattr(e, "code", 0)
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — a body we cannot read is not fatal
            detail = ""
        if status == 400 and _TOO_LARGE_RE.search(detail):
            # Neither a bug nor an outage: this article does not fit. The
            # caller trims or falls back, and the breaker stays shut — the
            # endpoint is healthy and said so quickly.
            return _skip("too_large", count=False)
        if status == 400:
            # A validation refusal. `build_payload` should have caught it, so
            # reaching here means our idea of the contract has drifted from
            # the endpoint's — report it rather than absorbing it.
            return _skip("invalid_request", count=False)
        if status in (404, 410):
            # The alpha endpoint moved. Quiet fallback, as the plan requires,
            # but it DOES trip the breaker: every subsequent call would 404
            # too, and paying a round trip each is the cost the breaker
            # exists to bound.
            return _skip("unavailable", now=started)
        return _skip("http_error", now=started)
    except _DeadlineExceeded:
        return _skip("timeout", now=started)
    except json.JSONDecodeError:
        return _skip("malformed", now=started)
    except Exception:  # noqa: BLE001 — timeout, DNS, TLS, a reset socket
        return _skip("timeout", now=started)

    if not _looks_like_answers(parsed):
        # A 200 whose shape we do not recognise is the schema change the plan
        # is about. `malformed` is report-worthy: the alternative is paying
        # GLM for every article for ever while the logs stay clean.
        return _skip("malformed", now=started)

    _note_success()
    return JevOutcome(
        answers=parsed["answers"],
        usage=parsed.get("usage") or {},
        # The RESOLVED id, which the endpoint echoes — so a caller can tell
        # which version answered rather than trusting what it asked for.
        model=parsed.get("model"),
        ms=int((clock() - started) * 1000),
    )
