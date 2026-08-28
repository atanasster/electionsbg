#!/usr/bin/env python3
"""A minimal OpenAI-compatible client for a LOCAL model server.

Talks to llama.cpp's server, LM Studio, Ollama's OpenAI shim — anything that
answers `POST /v1/chat/completions`. Standard library only: this package runs
on a Mac mini with no venv, and every dependency is one more thing that can be
missing at 03:00 when nobody is watching.

⚠️ LOCALHOST BY DEFAULT, and the check is not cosmetic. This client posts the
FULL TEXT of Bulgarian news articles plus a rubric; pointed at a remote host
by a stray environment variable it would ship the corpus off the machine.
`NEWS_LLM_URL` may name a remote host, but only with NEWS_LLM_ALLOW_REMOTE=1
set alongside it, so that cannot happen by accident.
"""

import http.client
import json
import os
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

DEFAULT_URL = "http://127.0.0.1:8080/v1/chat/completions"

# ⚠️ A 12B on a Mac mini is SLOW — a long article can take minutes — so the
# timeout is per-REQUEST and generous. Too short and the nightly run
# reports failures that are really impatience; too long and one hung request
# eats the window. 300 s is roughly 5x the observed worst case on a 16 GB box.
DEFAULT_TIMEOUT = 300

# ⚠️ Retries are for TRANSPORT, never for a bad answer. A model that produced
# an invalid record will produce it again; re-asking burns the budget and the
# validator's rejection is the useful signal. Only a connection reset, a 5xx
# or a timeout is retried.
RETRY_STATUS = frozenset({500, 502, 503, 504, 429})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 2.0

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "0.0.0.0"})


class LlmError(RuntimeError):
    """A request could not be completed. Carries a machine-readable `kind`."""

    def __init__(self, kind: str, detail: str):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


def check_local(url: str) -> str:
    """Refuse a non-localhost target unless it was asked for deliberately."""
    host = (urlparse(url).hostname or "").lower()
    if host not in LOCAL_HOSTS and os.environ.get("NEWS_LLM_ALLOW_REMOTE") != "1":
        # ⚠️ REFUSED, not warned. The payload is the full text of every
        # article we hold plus our rubric; a typo in NEWS_LLM_URL should not
        # be able to send it to somebody else's server.
        raise LlmError(
            "remote_refused",
            f"{url} is not localhost. This client posts full article text; "
            "set NEWS_LLM_ALLOW_REMOTE=1 if you really mean to send it off "
            "this machine.")
    return url


def endpoint() -> str:
    return check_local(os.environ.get("NEWS_LLM_URL") or DEFAULT_URL)


def request_headers(target: str) -> dict:
    """Authentication and attribution for an OpenAI-compatible endpoint.

    Local servers need neither. Hosted endpoints use NEWS_LLM_API_KEY; the
    OpenRouter-specific key is accepted only for openrouter.ai so setting it
    cannot accidentally authenticate a different remote host.
    """
    headers = {"Content-Type": "application/json"}
    host = (urlparse(target).hostname or "").lower()
    key = os.environ.get("NEWS_LLM_API_KEY")
    if not key and host == "openrouter.ai":
        key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if host == "openrouter.ai":
        headers["HTTP-Referer"] = os.environ.get(
            "NEWS_LLM_SITE_URL", "https://electionsbg.com")
        headers["X-Title"] = os.environ.get(
            "NEWS_LLM_APP_NAME", "Naiasno news analysis eval")
    return headers


def complete(system: str, user: str, *, model: str,
             grammar: str | None = None,
             json_schema: dict | None = None,
             max_tokens: int = 2048,
             temperature: float = 0.2,
             timeout: int = DEFAULT_TIMEOUT,
             url: str | None = None) -> dict:
    """One completion. Returns {"text", "model", "usage", "elapsed_s"}.

    ⚠️ `grammar` is passed through as llama.cpp's `grammar` field. A server
    that ignores it will happily return free-form JSON — which is why
    analyze_local.py checks that the FIRST record of a run validated, rather
    than assuming the constraint was applied.

    ⚠️ THINKING IS TURNED OFF, and on a REASONING MODEL that is the
    difference between working and silently returning nothing. Gemma 4 emits
    its chain of thought first; llama.cpp routes it to `reasoning_content`
    and leaves `content` EMPTY until the thinking ends. Measured against
    `ai/gemma4:12b` through Docker Model Runner: the full rubric prompt spent
    its whole 2048-token budget reasoning, returned `content: ""` after 508
    seconds, and surfaced as „Expecting value: line 1 column 1" — a JSON
    parse error that says nothing about what happened.

    `chat_template_kwargs.enable_thinking` is the knob that works; measured,
    `reasoning_effort: "none"` and `chat_template_kwargs.thinking` are both
    ignored. Set NEWS_LLM_THINKING=1 for a model that needs it. A server
    that does not understand the field ignores it, so this is safe to send
    to llama.cpp, LM Studio and Ollama alike.
    """
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        # ⚠️ Low, not zero. Greedy decoding on a constrained grammar can lock
        # into a repetition the grammar permits; a little temperature is the
        # cheapest way out and costs nothing on a judgment task where the
        # grammar already bounds the shape.
        "temperature": temperature,
        "stream": False,
    }
    if os.environ.get("NEWS_LLM_THINKING") != "1":
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    if grammar:
        payload["grammar"] = grammar
    if json_schema:
        # ⚠️ THE OTHER WAY TO SAY THE SAME THING, for a provider with no
        # GBNF. llama.cpp takes `grammar`; OpenRouter and the OpenAI-shaped
        # APIs take `response_format` — so a run against a hosted model has
        # no constraint at all unless this is sent, and an unconstrained
        # model invents its own schema rather than failing (measured:
        # `status`, `political_bias`, `party_sentiment` where the rubric asks
        # for `quality`, `leaning`, `party_tones`).
        #
        # ⚠️ `strict: true` is what makes it a CONSTRAINT rather than a hint.
        # Without it a provider treats the schema as advisory and the reply
        # is unconstrained again — indistinguishable, in the payload, from a
        # provider that never supported it.
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "analysis", "strict": True,
                            "schema": json_schema},
        }
    # ⚠️ THE GUARD APPLIES TO `url=` TOO. `url or endpoint()` let a caller
    # pass a remote address directly and bypass the localhost check entirely
    # — the whole protection on a client that posts the full text of every
    # article we hold.
    target = check_local(url) if url else endpoint()
    target_host = (urlparse(target).hostname or "").lower()
    if target_host == "openrouter.ai":
        # OpenRouter otherwise may choose a provider endpoint that silently
        # ignores response_format even when the model page lists it. Their
        # documented routing guard makes support a requirement, not a hint.
        if json_schema:
            payload["provider"] = {"require_parameters": True}
        # The local-server chat-template flag above is not an OpenRouter API
        # control. Without its unified reasoning setting, small reasoning
        # models can spend all 2048 output tokens thinking and return no
        # content. `none` is preferred; providers that cannot disable it map
        # to their smallest supported budget. Reasoning is never requested
        # back because it is not an analysis artifact.
        if os.environ.get("NEWS_LLM_THINKING") != "1":
            payload["reasoning"] = {"effort": "none", "exclude": True}
    # Encode only after endpoint-specific controls are added. Encoding above
    # this block makes the payload mutations look right in a code review but
    # sends neither of them — caught by test_openrouter_requires_schema_*.
    body = json.dumps(payload).encode("utf-8")

    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started = time.monotonic()
        req = urllib.request.Request(
            target, data=body, headers=request_headers(target), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                doc = json.loads(resp.read().decode("utf-8"))
            choices = doc.get("choices") or []
            if not choices:
                raise LlmError("empty_response", json.dumps(doc)[:300])
            msg = choices[0].get("message") or {}
            # ⚠️ NAMED, never returned as an empty string. A reasoning model
            # whose thinking was not disabled fills `reasoning_content` and
            # leaves `content` empty — which every caller then reports as a
            # JSON parse failure at column 1, sending whoever reads it to
            # look for a malformed answer that was never produced.
            usage = doc.get("usage") or {}
            completion_detail = usage.get("completion_tokens_details") or {}
            reasoning_tokens = completion_detail.get("reasoning_tokens") or 0
            if not (msg.get("content") or "").strip() and (
                    (msg.get("reasoning_content") or "").strip()
                    or (msg.get("reasoning") or "").strip()
                    or reasoning_tokens):
                raise LlmError(
                    "reasoning_only",
                    f"the model returned only chain-of-thought "
                    f"({reasoning_tokens} reasoning tokens) and no answer — "
                    f"finish_reason={choices[0].get('finish_reason')!r}. "
                    "Raise --max-tokens, or unset NEWS_LLM_THINKING=1.")
            return {
                "text": msg.get("content") or "",
                "model": doc.get("model") or model,
                "usage": usage,
                "elapsed_s": round(time.monotonic() - started, 2),
                "attempts": attempt,
            }
        except urllib.error.HTTPError as exc:
            last = LlmError(f"http_{exc.code}", exc.read()[:300].decode(
                "utf-8", "replace"))
            if exc.code not in RETRY_STATUS:
                raise last from exc
        except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
            reason = getattr(exc, "reason", exc)
            last = LlmError("unreachable", f"{target}: {reason}")
        except (http.client.IncompleteRead,
                http.client.RemoteDisconnected,
                ConnectionError) as exc:
            # ⚠️ A MID-RESPONSE DISCONNECT, and the LIKELIEST failure on a
            # 16 GB Mac mini: the server is OOM-killed part-way through
            # generating. None of these is an OSError or a URLError, so
            # without this arm the exception escapes as a non-LlmError, the
            # caller's `except llm_client.LlmError` misses it, and the whole
            # batch is discarded with a traceback instead of a report line.
            last = LlmError("disconnected", f"{target}: {type(exc).__name__}")
        except json.JSONDecodeError as exc:
            # ⚠️ NOT retried. A server returning non-JSON is misconfigured,
            # and asking it again three times just delays the report.
            raise LlmError("bad_json", str(exc)[:300]) from exc
        if attempt < MAX_ATTEMPTS:
            time.sleep(BACKOFF_SECONDS * attempt)
    raise last or LlmError("unreachable", target)


def probe(url: str | None = None, timeout: int = 10) -> dict:
    """Is a model server there, and which model does it hold?

    ⚠️ Used by run_nightly.sh BEFORE it spends an hour harvesting. A run that
    collects 400 articles and then discovers there is no model to judge them
    with has wasted the window and the bandwidth.
    """
    # ⚠️ INSIDE the try. `probe` is documented to REPORT rather than raise —
    # run_nightly.sh calls it before an hour of harvesting and must get an
    # answer, not an exception — so the localhost refusal has to arrive as a
    # result like any other failure.
    try:
        target = check_local(url) if url else endpoint()
        models_url = target.split("/v1/")[0] + "/v1/models"
        with urllib.request.urlopen(models_url, timeout=timeout) as resp:
            doc = json.loads(resp.read().decode("utf-8"))
        return {"ok": True, "url": target,
                "models": [m.get("id") for m in (doc.get("data") or [])]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "url": url or DEFAULT_URL,
                "error": str(exc)[:200]}


if __name__ == "__main__":
    import sys
    print(json.dumps(probe(), ensure_ascii=False))
    sys.exit(0 if probe()["ok"] else 1)
