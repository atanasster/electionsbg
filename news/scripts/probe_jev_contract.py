#!/usr/bin/env python3
"""Phase 3.1 — what the Jev decisions endpoint ACTUALLY does.

    python3 news/scripts/probe_jev_contract.py            # one call per primitive
    python3 news/scripts/probe_jev_contract.py --limits   # also probe the error shapes
    python3 news/scripts/probe_jev_contract.py --dry-run  # print payloads, call nothing

⚠️ EVERY DOCUMENTED FACT ABOUT THIS ENDPOINT IS SECOND-HAND. The plan's
interface notes come from a THIRD-PARTY examples repo, and the model does not
appear in OpenRouter's public `/api/v1/models` catalogue — so nothing here may
be assumed, including the URL, the request shape, the response shape, the
model id, and how usage is billed. This script exists to replace each of those
with a captured response before `jev_client.py` is written against them.

It therefore prints what it FOUND, not what it expected, and records a
disagreement rather than normalising it away: the answer this phase most needs
is "the plan is wrong about X", and a probe that quietly coerces the response
into the documented shape cannot produce it.

Captured responses land in `news/data/_perf/jev/<UTC stamp>/` (gitignored and
archive-excluded, like every other probe output here); the ones worth pinning
are copied into `scripts/tests/fixtures/` by hand, because a fixture nobody
read is worse than none.

Cost: three calls on a 1.5 kB state at $0.042/M input — well under a cent.
Never run from the pipeline; this is an operator tool.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
REPO_ROOT = Path(os.environ.get("DATA_BG_ROOT") or SCRIPT_DIR.parents[1])

# Config, not constants: the plan requires a TypeSafe-direct fallback
# (api.typesafe.ai/v1/systemone) to be a config change rather than an edit,
# and this probe is the first thing that would have to move.
ENDPOINT = os.environ.get(
    "NEWS_JEV_URL", "https://openrouter.ai/api/alpha/decisions")
MODEL = os.environ.get("NEWS_JEV_MODEL", "typesafe/jev-1.13")
PINNED = os.environ.get("NEWS_JEV_MODEL_PINNED", "typesafe/jev-1.13-20260917")
TIMEOUT_S = float(os.environ.get("NEWS_JEV_TIMEOUT_S", "30"))
PRICE_PER_M_INPUT = 0.042  # advertised; the probe checks usage.cost against it

# A real Bulgarian civic article, trimmed — the state this pipeline would
# actually send. Using lorem ipsum would measure the endpoint on input it will
# never see, and Cyrillic is ~2x the tokens per character of English, which is
# the whole question for a 32k context and a per-input price.
STATE = (
    "Общинският съвет в Пловдив прие на второ четене бюджета на общината за "
    "2026 година с 38 гласа „за“, 6 „против“ и 4 „въздържал се“. Капиталовата "
    "програма е в размер на 142 милиона евро, като най-голямият дял — 41 "
    "милиона — е предвиден за ремонт на улична мрежа и междублокови "
    "пространства. Кметът заяви, че средствата за образование се увеличават с "
    "12 на сто спрямо миналата година. Опозицията възрази, че разчетите за "
    "приходи от продажба на общинска собственост са нереалистични и че "
    "заложените 18 милиона евро няма да бъдат събрани. Председателят на "
    "бюджетната комисия отговори, че прогнозата стъпва на вече сключени "
    "предварителни договори."
)


def load_env():
    """news/.env.api, the same file the rest of the pipeline reads — through
    the ONE loader in llm_client.

    ⚠️ Only the KEY NAMES are ever printed by this script, never a value.
    """
    import llm_client
    llm_client.load_env_files(names=(".env.api",), root=REPO_ROOT)


def question(kind):
    """One question per System One primitive, in the shape `jev_payload.js`
    builds — that module is the contract this pipeline already ships, so a
    divergence between it and the live endpoint is itself a finding."""
    if kind == "choice":
        return {"type": "choice",
                "instructions": "Коя е основната тема на текста?",
                "criteria": {"budget": "общински или държавен бюджет",
                             "election": "избори и предизборна кампания",
                             "crime": "престъпление или разследване",
                             "sport": "спорт"}}
    if kind == "score":
        return {"type": "score",
                "instructions": "Колко подробно е отразен спорът по темата?",
                "criteria": ["изобщо не е отразен",
                             "само се споменава",
                             "представена е една страна",
                             "представени са двете страни",
                             "двете страни са цитирани дословно"]}
    return {"type": "noul",
            "instructions": "Съдържа ли текстът конкретна парична сума?",
            "criteria": {"true": "да, посочена е сума",
                         "false": "не се посочва сума"}}


def call(payload, key):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        # ⚠️ Guarded INSIDE the handler: a mid-body read failure here raises
        # out of `call()` past the generic clause below, and since captures
        # are written per probe it would still lose this one — which is the
        # error response the --limits run exists to capture.
        status = e.code
        try:
            raw = e.read().decode("utf-8", errors="replace")
        except Exception as read_err:  # noqa: BLE001
            raw = ""
            print(f"  (could not read the error body: {read_err})")
    except Exception as e:  # noqa: BLE001 — the probe reports, never raises
        return {"error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - started) * 1000)}
    out = {"status": status, "ms": round((time.monotonic() - started) * 1000),
           "bytes": len(raw)}
    try:
        out["body"] = json.loads(raw)
    except json.JSONDecodeError:
        # ⚠️ Kept as TEXT rather than dropped: an alpha endpoint answering
        # HTML (a gateway page, a login redirect) is exactly the failure this
        # phase must design for, and it is invisible if only JSON is recorded.
        out["body_text"] = raw[:2000]
    return out


def report(name, result, expected_model=None):
    print(f"\n=== {name} ===")
    if "error" in result:
        print(f"  transport: {result['error']} after {result['ms']} ms")
        return
    print(f"  HTTP {result['status']} in {result['ms']} ms, "
          f"{result['bytes']} bytes")
    body = result.get("body")
    if body is None:
        print(f"  NOT JSON: {result.get('body_text', '')[:200]!r}")
        return
    if not isinstance(body, dict):
        print(f"  JSON but not an object: {type(body).__name__}")
        return
    print(f"  top-level keys: {sorted(body)}")
    if "error" in body:
        # ⚠️ PRINT IT. Without this the whole payoff of --limits was invisible
        # on stdout — the run reported three 400s and not one of the bodies
        # that say which class of failure each is, which is the only thing
        # the client in 3.2 needs from them.
        print(f"  error body: {json.dumps(body['error'], ensure_ascii=False)[:600]}")
    answers = body.get("answers")
    if isinstance(answers, dict):
        for qid, ans in answers.items():
            print(f"    answer[{qid}] = {json.dumps(ans, ensure_ascii=False)[:300]}")
    usage = body.get("usage")
    if isinstance(usage, dict):
        print(f"  usage: {json.dumps(usage)}")
        tokens = usage.get("input_tokens")
        cost = usage.get("cost")
        if isinstance(tokens, (int, float)) and isinstance(cost, (int, float)):
            implied = tokens * PRICE_PER_M_INPUT / 1e6
            # Reported vs derived, both printed. If they disagree, the price
            # or the token accounting is not what the listing says — and that
            # is a number this phase's budget rests on.
            print(f"  cost reported {cost:.8f} vs {implied:.8f} implied by "
                  f"{tokens} input tokens at ${PRICE_PER_M_INPUT}/M "
                  f"({'agrees' if abs(cost - implied) < max(1e-9, implied * 0.05) else '⚠️ DISAGREES'})")
    returned = body.get("model")
    if returned is not None:
        note = ""
        if expected_model and returned != expected_model:
            note = f"  ⚠️ asked for {expected_model}"
        print(f"  model returned: {returned}{note}")
    else:
        print("  ⚠️ no `model` in the response — the alias cannot be checked, "
              "so a pinned id is the only safe way to call this")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limits", action="store_true",
                    help="also probe the over-limit error shapes")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the payloads and make no calls")
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args(argv)

    load_env()
    key = os.environ.get("OPENROUTER_API_KEY")
    print(f"endpoint: {ENDPOINT}")
    print(f"model:    {args.model}  (pinned alias to compare: {PINNED})")
    print(f"key:      {'OPENROUTER_API_KEY present' if key else 'MISSING'}")
    print(f"state:    {len(STATE)} chars of Bulgarian")

    probes = [(kind, {"model": args.model, "state": STATE,
                      "questions": {f"q_{kind}": question(kind)}})
              for kind in ("choice", "score", "noul")]
    # All three in ONE request — the listing says questions batch only when
    # they share a state, and ours do, so this is the shape the pipeline would
    # actually use and the one whose cost matters.
    probes.append(("batched_all_three",
                   {"model": args.model, "state": STATE,
                    "questions": {f"q_{k}": question(k)
                                  for k in ("choice", "score", "noul")}}))
    # ⚠️ ACTUALLY SEND THE PINNED ID. An earlier cut printed `PINNED` beside
    # the alias and never called it, and the report then recorded "pinnable
    # ✅" on the strength of a string that had been in the config all along.
    # Whether the dated id is accepted is the entire question — the plan's
    # threshold argument depends on being able to hold a version still.
    probes.append(("pinned_model",
                   {"model": PINNED, "state": STATE,
                    "questions": {"q_choice": question("choice")}}))
    if args.limits:
        # Deliberately malformed / oversized, to capture the ERROR shape: a
        # client that cannot tell "you sent too much" from "Jev is down" will
        # fall through to GLM on a bug and never report it.
        probes.append(("error_unknown_type",
                       {"model": args.model, "state": STATE,
                        "questions": {"q": {"type": "nonsense",
                                            "instructions": "x"}}}))
        probes.append(("error_no_questions",
                       {"model": args.model, "state": STATE, "questions": {}}))
        probes.append(("error_state_too_large",
                       {"model": args.model, "state": STATE * 400,
                        "questions": {"q": question("noul")}}))

    if args.dry_run:
        for name, payload in probes:
            print(f"\n=== {name} (dry run) ===")
            print(json.dumps(payload, ensure_ascii=False, indent=1)[:1200])
        return 0
    if not key:
        print("\nOPENROUTER_API_KEY is not set — nothing was called.",
              file=sys.stderr)
        return 2

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = REPO_ROOT / "news" / "data" / "_perf" / "jev" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    captured = {}
    target = out_dir / "contract.json"
    for name, payload in probes:
        result = call(payload, key)
        report(name, result, expected_model=payload.get("model", args.model))
        captured[name] = {"request": payload, "response": result}
        # ⚠️ Written after EVERY probe, not once at the end: these calls are
        # paid, and a crash on probe 5 used to discard the four already
        # bought. It also means the file on disk is always what has actually
        # been measured so far, which is what the report must be written from.
        target.write_text(json.dumps(captured, ensure_ascii=False, indent=1),
                          encoding="utf-8")
    print(f"\ncaptured -> {out_dir / 'contract.json'}")
    ok = sum(1 for v in captured.values()
             if v["response"].get("status") == 200)
    print(f"{ok} of {len(captured)} probes returned HTTP 200")
    return 0


if __name__ == "__main__":
    sys.exit(main())
