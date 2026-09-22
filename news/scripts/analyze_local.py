#!/usr/bin/env python3
"""Run the analysis loop against a LOCAL model: --next → prompt → llm → save.

This is the decision procedure that used to live in `analyze-news-article/
SKILL.md` — 262 lines of prose an agent reads. A Mac mini running a 12B at
03:00 has no agent, so the branching became code and only the rubric stayed
as prompt text (`news/prompts/analyze_system.md`).

⚠️ IT DOES NOT MERGE STORIES. Same-event clustering needs the candidate set
and a judgment about whether two events are really one event — the part least
suited to a small unattended model, and a wrong merge cannot be undone
automatically. A publishable article that has no story instead receives its
own singleton story. That operation loses no information, makes the accepted
analysis visible, and leaves a later human-or-better-model pass free to move
it into a real comparison cluster. Redos preserve existing membership.

Run:  python3 news/scripts/analyze_local.py --limit 20 --model gemma-4-12b
      python3 news/scripts/analyze_local.py --dry-run --limit 1
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
import hashlib
import json
import math
import re
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import llm_client  # noqa: E402
import perf_log  # noqa: E402
try:  # optional: the Jev shadow simply does not run when it is absent
    import jev_client
except ImportError:  # pragma: no cover
    jev_client = None
from build_prompts import MAX_BODY_CHARS  # noqa: E402

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])
SCRIPTS = Path(__file__).resolve().parent
PROMPTS = ROOT / "news" / "prompts"
ANALYZE = SCRIPTS / "analyze_articles.py"

# ⚠️ The FIRST record of a run is checked against the validator before the
# rest are attempted. A server that silently ignored the `grammar` field
# produces free-form JSON that fails every time — and discovering that after
# 200 requests has burned the whole nightly window on a misconfiguration.
FIRST_RECORD_IS_A_CANARY = True
# Consecutive unparseable canary answers before the endpoint is declared
# unusable. At the worst measured provider rate (8 of 17 unparseable), five in
# a row is ~2%; at the pipeline's normal rate it is well under 0.1%.
CANARY_MAX_PARSE_FAILURES = 5
ANALYSIS_PROVENANCE_VERSION = 1
MAX_USAGE_TOKENS = 1_000_000_000
MAX_USAGE_COST_USD = 1_000_000
TRIAGE_SYSTEM = (
    "Класифицирай само очевидно извън тематичния обхват. При всяко съмнение, "
    "политика, институция, обществен разход или публична личност избери "
    "needs_paid_analysis. evidence трябва да е точен откъс от статията.")
TRIAGE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "decision": {"enum": ["obvious_not_site_relevant",
                               "needs_paid_analysis"]},
        "subcategory": {"enum": ["weather", "sports"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "evidence": {"type": "string", "minLength": 1},
    },
    "required": ["decision", "subcategory", "confidence", "evidence"],
}
SAFE_TRIAGE_TITLE_TERMS = {
    "weather": frozenset({"времето", "прогноза", "температури", "валежи",
                          "градуси", "буря", "сняг"}),
    "sports": frozenset({"мач", "футбол", "тенис", "спорт", "отбор",
                         "шампион", "гол", "турнир"}),
}


def sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def prompt_asset_provenance(assets: dict) -> dict:
    """Hashes of the exact prompt contracts sent to the model."""
    schema = json.dumps(assets["json_schema"], ensure_ascii=False,
                        sort_keys=True, separators=(",", ":"))
    return {
        "system_prompt_sha256": sha256_text(assets["system"]),
        "json_schema_sha256": sha256_text(schema),
        "grammar_sha256": sha256_text(assets["grammar"]),
        "taxonomy_prompt_sha256": sha256_text(assets["taxonomy"]),
    }


def bounded_usage(raw: dict) -> dict:
    """Keep only finite, non-negative, plausible billing counters."""
    out = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = raw.get(key)
        if (isinstance(value, int) and not isinstance(value, bool)
                and 0 <= value <= MAX_USAGE_TOKENS):
            out[key] = value
    prompt_details = raw.get("prompt_tokens_details")
    prompt_details = prompt_details if isinstance(prompt_details, dict) else {}
    completion_details = raw.get("completion_tokens_details")
    completion_details = (completion_details
                          if isinstance(completion_details, dict) else {})
    token_details = {
        "cached_prompt_tokens": prompt_details.get("cached_tokens"),
        "reasoning_tokens": completion_details.get("reasoning_tokens"),
    }
    for key, value in token_details.items():
        if (isinstance(value, int) and not isinstance(value, bool)
                and 0 <= value <= MAX_USAGE_TOKENS):
            out[key] = value
    cost = raw.get("cost")
    if (isinstance(cost, (int, float)) and not isinstance(cost, bool)
            and math.isfinite(cost) and 0 <= cost <= MAX_USAGE_COST_USD):
        out["cost"] = cost
    return out


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = round((len(ordered) - 1) * quantile)
    return ordered[index]


def summarize_run_billing() -> dict:
    """The complete decoded-response bill, including unusable generations."""
    events = llm_client.usage_events()
    usages = [bounded_usage(event.get("usage") or {}) for event in events]
    providers = {}
    finishes = {}
    elapsed = []
    for event in events:
        provider = event.get("provider") or "unknown"
        providers[provider] = providers.get(provider, 0) + 1
        finish = event.get("finish_reason") or "unknown"
        finishes[finish] = finishes.get(finish, 0) + 1
        duration = event.get("transport_elapsed_s")
        if (isinstance(duration, (int, float))
                and not isinstance(duration, bool) and math.isfinite(duration)
                and duration >= 0):
            elapsed.append(float(duration))
    totals = {
        key: sum(usage.get(key, 0) for usage in usages)
        for key in ("prompt_tokens", "completion_tokens", "total_tokens",
                    "cached_prompt_tokens", "reasoning_tokens")
    }
    costs = [usage["cost"] for usage in usages if "cost" in usage]
    return {
        "responses": len(events),
        "responses_with_usage": sum(bool(usage) for usage in usages),
        "responses_with_cost": len(costs),
        **totals,
        "cost_usd": round(sum(costs), 12),
        "providers": providers,
        "finish_reasons": finishes,
        "transport_latency_s": {
            "median": _percentile(elapsed, 0.5),
            "p90": _percentile(elapsed, 0.9),
        },
    }


def with_run_billing(payload: dict) -> dict:
    return {**payload, "billing": summarize_run_billing()}


def generation_summary(record: dict) -> dict:
    provenance = record.get("analysis_provenance") or {}
    return {
        "response_id": provenance.get("response_id"),
        "provider": provenance.get("provider"),
        "model_served": provenance.get("model_served"),
        "usage": provenance.get("usage") or {},
        "transport_elapsed_s": provenance.get("transport_elapsed_s"),
        "transport_attempts": provenance.get("transport_attempts"),
    }


def carry_schema_attempts(record: dict, previous: list[dict]) -> None:
    """Attach charged validator-retry attempts to the accepted generation."""
    if not isinstance(record.get("analysis_provenance"), dict):
        return
    attempts = [generation_summary(item) for item in previous] + [
        generation_summary(record)]
    cumulative = {}
    for attempt in attempts:
        for key, value in attempt["usage"].items():
            cumulative[key] = cumulative.get(key, 0) + value
    provenance = record["analysis_provenance"]
    provenance["schema_generation_attempt"] = len(attempts)
    provenance["schema_attempts"] = attempts
    provenance["cumulative_usage"] = cumulative


def run_analyze(*args, stdin: str | None = None) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(ANALYZE), *args],
        capture_output=True, text=True, input=stdin,
        env={**os.environ, "DATA_BG_ROOT": str(ROOT)})
    try:
        return proc.returncode, json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return proc.returncode, {"error": "non_json_output",
                                 "stdout": proc.stdout[:400],
                                 "stderr": proc.stderr[:400]}


def save(batch: list, stats: dict) -> bool:
    """Save a batch and record what happened. True when every record landed.

    ⚠️⚠️ THE EXIT CODE IS READ, not just the keys. `cmd_save`'s error shapes
    (`taxonomy_load_failed`, `invalid_json`) carry neither `saved` nor
    `failed`, so a run that read only `out["saved"]` reported
    `saved: 1, rejected: []` at exit 0 while three analyses vanished — the
    exact „quiet night" this whole runner is built to make impossible.
    """
    code, out = run_analyze("--save-batch", "-",
                            stdin=json.dumps(batch, ensure_ascii=False))
    saved = out.get("saved") or []
    failed = out.get("failed") or []
    stats["saved"] += len(saved)
    stats["rejected"].extend(failed)
    # What the save DECIDED, not just what it stored. Without this the run
    # report cannot say whether the analyzer joined anything, and "no
    # comparison stories today" is indistinguishable from "the rule is off".
    # setdefault, not [..]: `save` is called with ad-hoc stats dicts (the
    # tests build their own), and a new key must not become a precondition.
    stats.setdefault("auto_merged", []).extend(out.get("auto_merged") or [])
    # The T2.1 review channel's output, and its failures — a run that
    # produced proposals nobody can see is a run that measured nothing.
    stats.setdefault("join_proposals", []).extend(out.get("join_proposals") or [])
    stats.setdefault("join_proposal_errors", []).extend(out.get("join_proposal_errors") or [])
    if out.get("mentions_unverified"):
        stats["mentions_unverified"] = out["mentions_unverified"]
    # A non-zero exit with no `failed` list means the save never ran — a
    # different fact from „the validator refused these records", and one that
    # loses the whole batch rather than naming which records were bad.
    if code != 0 and not failed:
        stats["save_failed"].append({
            "exit": code, "records": len(batch),
            "detail": json.dumps(out, ensure_ascii=False)[:300]})
        return False
    return not failed


def new_save_stats() -> dict:
    """A private save result, merged only after retry policy is decided."""
    return {"saved": 0, "rejected": [], "save_failed": [], "auto_merged": []}


def merge_save_stats(target: dict, source: dict) -> None:
    target["saved"] += source["saved"]
    target["rejected"].extend(source["rejected"])
    target["save_failed"].extend(source["save_failed"])
    # Follows the same retry policy as the rest: an attempt whose stats are
    # discarded must not leave its joins in the report.
    target.setdefault("auto_merged", []).extend(source.get("auto_merged") or [])
    target.setdefault("join_proposals", []).extend(source.get("join_proposals") or [])
    target.setdefault("join_proposal_errors", []).extend(source.get("join_proposal_errors") or [])
    if source.get("mentions_unverified"):
        target["mentions_unverified"] = source["mentions_unverified"]


def analyze_one(item: dict, assets: dict, model: str, max_tokens: int,
                taxonomy_version: int, temperature: float = 0.2) -> dict:
    """Build one record without writing shared state; safe in a worker."""
    try:
        article = json.loads((ROOT / item["path"]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"kind": "parse_failed", "path": item["path"],
                "detail": str(exc)[:200]}
    prompt = build_user_prompt(article, item.get("mentions") or [],
                               assets["taxonomy"])
    try:
        answer = llm_client.complete(
            assets["system"], prompt, model=model,
            grammar=assets["grammar"], json_schema=assets["json_schema"],
            max_tokens=max_tokens, temperature=temperature)
    except llm_client.LlmError as exc:
        return {"kind": "llm_failed", "path": item["path"],
                "error_kind": exc.kind, "detail": exc.detail[:200]}
    try:
        asset_provenance = (assets.get("provenance")
                            or prompt_asset_provenance(assets))
        request_provenance = {
            **asset_provenance,
            "user_prompt_sha256": sha256_text(prompt),
            "body_truncated": len(article.get("content") or "") > MAX_BODY_CHARS,
            "max_body_chars": MAX_BODY_CHARS,
        }
        record = record_from(item, article, answer, model, taxonomy_version,
                             item.get("mentions") or [], request_provenance)
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        # A wrong-SHAPE answer arrives here as the TypeError from
        # check_answer_shape; anything else unexpected is caught by the
        # stage's worker guard as one failed article.
        # `model_output`: the answer's JSON was unusable, so asking again can
        # succeed — the in-run parse retry and the canary bound key on it. A
        # KeyError/TypeError may come from the item or article instead, which
        # a retry cannot fix, so only a syntax error earns the flag.
        failure = {"kind": "parse_failed", "path": item["path"],
                   "detail": str(exc)[:200],
                   "provider": answer.get("provider")}
        if isinstance(exc, json.JSONDecodeError):
            failure["model_output"] = True
        return failure
    return {"kind": "record", "item": item, "record": record}


def triage_one(item: dict, assets: dict, model: str, timeout: int,
               taxonomy_version: int) -> dict:
    """Try the narrow free route; every non-proof returns `fallback`."""
    if "mentions" not in item or not isinstance(item.get("mentions"), list):
        return {"kind": "fallback", "reason": "mentions_unavailable"}
    try:
        article = json.loads((ROOT / item["path"]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"kind": "fallback", "reason": "article_unreadable",
                "detail": str(exc)[:200]}
    # Known named actors make this consequential by construction. A free
    # model never gets authority to suppress their article.
    if any(m.get("kind") in {"person", "party", "institution", "company"}
           for m in item["mentions"] if isinstance(m, dict)):
        return {"kind": "fallback", "reason": "named_entity_veto"}
    prompt = "\n".join([
        f"ЗАГЛАВИЕ: {article.get('title') or '—'}",
        f"ТЕКСТ:\n{(article.get('content') or '')[:2000]}",
    ])
    request_provenance = {
        "system_prompt_sha256": sha256_text(TRIAGE_SYSTEM),
        "json_schema_sha256": sha256_text(json.dumps(
            TRIAGE_SCHEMA, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"))),
        "user_prompt_sha256": sha256_text(prompt),
        "analysis_route": "free_triage",
    }
    try:
        answer = llm_client.complete(
            TRIAGE_SYSTEM, prompt, model=model, json_schema=TRIAGE_SCHEMA,
            max_tokens=160, temperature=0, timeout=timeout, max_attempts=1)
    except Exception as exc:  # noqa: BLE001 — optional route must fail closed
        return {"kind": "fallback", "reason": "triage_unavailable",
                "detail": str(exc)[:200],
                "request_provenance": request_provenance}
    answer_summary = {
        **generation_summary_from_answer(answer),
        "prompt": request_provenance,
    }
    try:
        decision = parse_answer(answer["text"])
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        return {"kind": "fallback", "reason": "triage_invalid_response",
                "detail": str(exc)[:200], "answer": answer_summary}
    if not isinstance(decision, dict):
        return {"kind": "fallback", "reason": "triage_invalid_response",
                "detail": f"JSON root is {type(decision).__name__}, not object",
                "answer": answer_summary}
    subcategory = decision.get("subcategory")
    evidence = str(decision.get("evidence") or "")
    title_tokens = set(re.findall(r"[\w]+", str(
        article.get("title") or "").casefold(), re.UNICODE))
    article_folded = " ".join(str(article.get("content") or "").casefold().split())
    evidence_folded = " ".join(evidence.casefold().split())
    approved = (
        decision.get("decision") == "obvious_not_site_relevant"
        and subcategory in SAFE_TRIAGE_TITLE_TERMS
        and isinstance(decision.get("confidence"), (int, float))
        and not isinstance(decision.get("confidence"), bool)
        and decision["confidence"] >= 0.98
        and len(evidence.split()) >= 4
        and evidence_folded in article_folded
        and bool(title_tokens & SAFE_TRIAGE_TITLE_TERMS[subcategory])
    )
    if not approved:
        return {"kind": "fallback", "reason": "triage_not_proven",
                "answer": answer_summary}

    output = {
        "quality": {"verdict": "ok", "notes": "free triage: exact evidence"},
        "summary_bg": str(article.get("title") or evidence),
        "summary_en": str(article.get("title") or evidence),
        "leaning": {"label": "not_applicable", "confidence": 1.0,
                    "evidence": evidence},
        "russia_stance": {"label": "not_applicable", "confidence": 1.0,
                          "evidence": evidence},
        "ai_generated": {"verdict": "unclear", "confidence": 0.0,
                         "signals": []},
        "entities": {key: [] for key in
                     ("people", "parties", "institutions", "companies", "places")},
        "party_tones": [],
        "topics": [{"category": "not-site-relevant",
                    "subcategory": subcategory, "primary": True}],
        "site_relevant": False,
    }
    triage_answer = {**answer, "text": json.dumps(output, ensure_ascii=False)}
    record = record_from(item, article, triage_answer, model,
                         taxonomy_version, [], request_provenance)
    record["analysis_provenance"]["claim_sources"] = {
        "confidence": "deterministic_triage_defaults",
        "evidence": "free_triage_model_exact_excerpt",
        "ai_generated": "not_performed_out_of_scope",
        "party_tone_grounding": "not_applicable",
    }
    record["triage"] = decision
    return {"kind": "record", "item": item, "record": record,
            "route": "free_triage"}


def generation_summary_from_answer(answer: dict) -> dict:
    return {
        "response_id": answer.get("response_id"),
        "provider": answer.get("provider"),
        "model_served": answer.get("model"),
        "usage": bounded_usage(answer.get("usage") or {}),
        "transport_elapsed_s": answer.get("transport_elapsed_s"),
        "transport_attempts": answer.get("attempts"),
        "request": answer.get("request") or {},
    }


def jev_triage_shadow(item: dict, assets: dict) -> dict | None:
    """Ask Jev the SAME narrow question, log the answer, decide nothing.

    Plan §3.7. Shadow only, and `NEWS_JEV_GATE` has exactly one other
    accepted value today — `off`. There is no `enforce`, deliberately:

    ⚠️ JEV CANNOT PRODUCE THE PROOF THIS GATE IS BUILT ON. `triage_one`
    approves a suppression only when the model returns an EVIDENCE STRING
    that appears verbatim in the article (`evidence_folded in
    article_folded`, ≥4 words) — a free model's claim is not trusted, its
    quote is checked. Jev's three answer types return a choice, a score or a
    probability and NO free text at all, so a Jev backend cannot satisfy
    that obligation; it can only be believed. Swapping it in as an enforcing
    backend would therefore not be a like-for-like substitution, it would be
    the quiet removal of the check that makes the gate safe.

    What CAN be compared honestly is the decision itself, against GLM's, on
    live traffic — which is what this records.

    ⚠️ The named-entity veto runs FIRST here too, and not merely for
    symmetry with the paid path: an article naming a person, party,
    institution or company is consequential by construction, and the shadow
    log must not accumulate "Jev would have suppressed this" rows about
    articles no backend may ever suppress. Otherwise the Phase 5 go/no-go
    would be computed over a population the gate cannot act on.

    Returns the shadow record, or None when Jev was not consulted.
    """
    if os.environ.get("NEWS_JEV_GATE", "shadow") != "shadow":
        return None
    if jev_client is None:
        return None
    if "mentions" not in item or not isinstance(item.get("mentions"), list):
        return None
    if any(m.get("kind") in {"person", "party", "institution", "company"}
           for m in item["mentions"] if isinstance(m, dict)):
        return {"consulted": False, "reason": "named_entity_veto"}
    try:
        article = json.loads((ROOT / item["path"]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    state = "\n".join([
        f"ЗАГЛАВИЕ: {article.get('title') or '—'}",
        f"ТЕКСТ:\n{(article.get('content') or '')[:2000]}",
    ])
    # The same two things the paid gate decides, in Jev's vocabulary. The
    # subcategory options are the SAFE_TRIAGE_TITLE_TERMS keys, so a shadow
    # answer is directly comparable with what the paid path may approve.
    out = jev_client.ask(state, {
        "obvious_not_site_relevant": {
            "type": "noul",
            "instructions": "Очевидно ли е, че този текст НЕ се отнася до "
                            "българския обществен живот - тоест е чист спорт "
                            "или прогноза за времето, без институции, "
                            "политика или обществени средства?",
        },
        "subcategory": {
            "type": "choice",
            "instructions": "Ако текстът не е обществено значим, към коя "
                            "категория спада?",
            "criteria": {"weather": "прогноза за времето",
                         "sports": "спорт, мач, отбор или турнир",
                         "other": "нещо друго, или текстът Е обществено значим"},
        },
    })
    shadow = {"consulted": True, "gate": "shadow", "model": jev_client.MODEL}
    if not out:
        shadow.update({"skip": out.skip, "report_worthy": out.report_worthy})
        return shadow
    noul = (out.answers.get("obvious_not_site_relevant") or {}).get("noul")
    sub = (out.answers.get("subcategory") or {}).get("choice")
    shadow.update({
        "ms": out.ms,
        "cost": (out.usage or {}).get("cost"),
        "not_site_relevant": noul,
        "subcategory": sub,
        "subcategory_confidence": jev_client.confidence_of(
            out.answers.get("subcategory") or {}),
        # What it WOULD have done, had it been allowed to decide — recorded
        # as a counterfactual and never acted on. The 0.98 floor is the paid
        # path's own; `other` can never suppress.
        "would_suppress": bool(
            noul is not None and noul >= 0.98
            and sub in SAFE_TRIAGE_TITLE_TERMS),
    })
    return shadow


def analyze_routed(item: dict, assets: dict, paid_model: str, max_tokens: int,
                   taxonomy_version: int, triage_model: str | None,
                   triage_timeout: int, temperature: float = 0.2) -> dict:
    # ⚠️ BEFORE the paid route and outside the `triage_model` guard: the
    # shadow must observe every article the gate could ever see, including
    # runs with no triage model configured, or the Phase 5 go/no-go is
    # computed over whichever subset happened to be routed.
    shadow = None
    try:
        shadow = jev_triage_shadow(item, assets)
    except Exception:  # noqa: BLE001 — a shadow must never fail a run
        shadow = {"consulted": False, "reason": "shadow_error"}

    def with_shadow(result):
        if shadow and result.get("kind") == "record":
            result["record"].setdefault("analysis_provenance", {})[
                "jev_shadow"] = shadow
        return result

    if not triage_model:
        return with_shadow(analyze_one(item, assets, paid_model, max_tokens,
                                       taxonomy_version, temperature))
    triage = triage_one(item, assets, triage_model, triage_timeout,
                        taxonomy_version)
    if triage["kind"] == "record":
        return with_shadow(triage)
    paid = analyze_one(item, assets, paid_model, max_tokens, taxonomy_version,
                       temperature)
    if paid.get("kind") != "record":
        # Kept on the failure so an in-run parse retry that succeeds can still
        # say it was a paid fallback from triage.
        paid["route"] = "paid_fallback"
        paid["triage_fallback"] = {"model_requested": triage_model,
                                   "reason": triage.get("reason")}
    if paid.get("kind") == "record":
        paid["record"]["analysis_provenance"]["triage_fallback"] = {
            "model_requested": triage_model,
            "reason": triage.get("reason"),
            **({"generation": triage["answer"]} if triage.get("answer") else {}),
            **({"prompt": triage["request_provenance"]}
               if triage.get("request_provenance") else {}),
        }
        paid["route"] = "paid_fallback"
    return with_shadow(paid)


def record_worker_failure(stats: dict, result: dict) -> bool:
    """Record a worker error. True means the endpoint is unusable."""
    if result["kind"] == "parse_failed":
        stats["parse_failed"].append({"path": result["path"],
                                      "detail": result["detail"]})
        return False
    stats["llm_failed"].append({"path": result["path"],
                                "kind": result["error_kind"],
                                "detail": result["detail"]})
    return result["error_kind"] in ("unreachable", "remote_refused")


def save_attempt(record: dict) -> tuple[bool, dict]:
    """Try one record without exposing a retryable rejection as final."""
    attempt_stats = new_save_stats()
    return save([record], attempt_stats), attempt_stats


def load_prompt_assets() -> dict:
    missing = [p.name for p in (PROMPTS / "analyze_system.md",
                                PROMPTS / "analyze_schema.gbnf",
                                PROMPTS / "analyze_schema.json",
                                PROMPTS / "taxonomy_compact.json")
               if not p.exists()]
    if missing:
        raise SystemExit(json.dumps({
            "error": "missing_prompts", "missing": missing,
            "hint": "run python3 news/scripts/build_prompts.py"}))
    assets = {
        "system": (PROMPTS / "analyze_system.md").read_text(encoding="utf-8"),
        "grammar": (PROMPTS / "analyze_schema.gbnf").read_text(encoding="utf-8"),
        # ⚠️ The SAME contract for a provider with no GBNF — see
        # build_prompts.build_json_schema. Both are sent: llama.cpp reads the
        # grammar and ignores response_format, OpenRouter the reverse, and
        # neither errors on the field it does not know. Sending one or the
        # other by guessing the provider is a guess that fails silently.
        "json_schema": json.loads(
            (PROMPTS / "analyze_schema.json").read_text(encoding="utf-8")),
        "taxonomy": (PROMPTS / "taxonomy_compact.json").read_text(
            encoding="utf-8"),
    }
    assets["provenance"] = prompt_asset_provenance(assets)
    return assets


def build_user_prompt(rec: dict, mentions: list, taxonomy: str) -> str:
    """The article, its resolved mentions, and the taxonomy.

    ⚠️ THE BODY IS TRUNCATED FROM THE HEAD, never a middle window. Measured
    over the corpus: p50 1,754 chars, p90 6,213 — so a 6,000-char cap touches
    ~10.5% of articles and only their tails. A Bulgarian news article states
    its framing in the lede, which is exactly what the rubric asks the model
    to judge, so the head is the part that must survive.
    """
    body = (rec.get("content") or "")[:MAX_BODY_CHARS]
    truncated = len(rec.get("content") or "") > MAX_BODY_CHARS
    parts = [
        f"ТАКСОНОМИЯ (само id-та и етикети):\n{taxonomy}\n",
        f"ИЗДАНИЕ: {rec.get('domain')}",
        f"ЗАГЛАВИЕ: {rec.get('title') or '—'}",
        f"АВТОР: {rec.get('author') or '—'}",
        f"ПУБЛИКУВАНА: {rec.get('published') or '—'}",
    ]
    if mentions:
        # ⚠️ Handed over, NOT asked for. The dictionary pass already resolved
        # these off the gazetteer and analyze_articles.py refuses any record
        # that changes an id or a basis — so telling the model who is in the
        # article costs nothing and stops it inventing anybody.
        named = ", ".join(sorted({m["surface"] for m in mentions}))
        parts.append(f"РАЗПОЗНАТИ СПОМЕНАВАНИЯ (не ги променяй): {named}")
    parts.append(f"\nТЕКСТ:\n{body}")
    if truncated:
        # ⚠️ Told, not hidden. A model that cannot see the end of an article
        # should not be asked to judge its conclusion as if it had.
        parts.append("\n[Текстът е съкратен — това е началото на статията.]")
    return "\n".join(parts)


# ⚠️ A MODEL THAT WAS NOT CONSTRAINED FENCES ITS JSON, and `json.loads` then
# fails at „line 1 column 1" — an error that describes the fence, not the
# answer, and sends whoever reads it looking for malformed JSON that is
# perfectly well formed three characters later. Measured against
# `ai/gemma4:12b`: every unconstrained reply opened with ```json.
#
# ⚠️ THIS IS NOT A SUBSTITUTE FOR THE GRAMMAR AND MUST NOT BE READ AS ONE.
# A fenced reply means the constraint was dropped, and an unconstrained model
# also invents its own SCHEMA — the same run produced `status`,
# `political_bias` and a `leaning.russia` that exist nowhere in the rubric.
# Stripping the fence turns an unreadable parse error into an honest
# validation failure; it does not make the record usable.
FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n(.*?)\n?\s*```\s*$", re.S)


# A Bulgarian quotation opened with „ and closed with an ASCII " — the ASCII
# quote ends the JSON string early. Every syntax failure NextBit produced on
# the 2026-09-02 losses had this shape (news/evals/analyze-yield-2026-09-19.md).
# The repair writes the correct Bulgarian closing quote “ in place of THAT ONE
# quote: it adds no word and removes none.
#
# ⚠️ LOCAL, not global. Each step fixes only the quote the parser tripped
# over (the last `"` before the error position), and only when a „ opens a
# quotation within the same line and 200 characters with no quote character
# between — so an escaped \" elsewhere, or a valid „…“ quotation, is never
# touched, and two JSON values cannot be merged: the candidate quote must
# CLOSE a „ that opened inside the same string.
BG_QUOTE_WINDOW = 200
BG_QUOTE_MAX_FIXES = 10


def _repair_quote_at(body: str, pos: int):
    before = body[:pos]
    quote = before.rfind('"')
    if quote <= 0 or body[quote - 1] == "\\":
        return None
    lead = before[max(0, quote - BG_QUOTE_WINDOW):quote]
    opener = lead.rfind("„")
    if opener < 0:
        return None
    inside = lead[opener + 1:]
    if not inside or "\n" in inside or any(c in inside for c in '"“”„'):
        return None
    return body[:quote] + "“" + body[quote + 1:]


def parse_answer_detail(text: str, repair: bool = True) -> tuple:
    """(parsed JSON, repair name or None).

    ⚠️ The repair runs ONLY after the answer failed to parse as-is, and is
    kept only if the repaired text parses — a valid answer is never touched.
    If it cannot finish, the ORIGINAL error is raised, so a report names the
    model's mistake rather than the repair's. The record still has to pass
    the full validator and the verbatim-evidence check downstream, so a
    repair can make a record REACH those gates, never pass them."""
    m = FENCE_RE.match(text or "")
    body = m.group(1) if m else text
    try:
        return json.loads(body), None
    except json.JSONDecodeError as original:
        if not repair:
            raise
        current, exc = body, original
        for _ in range(BG_QUOTE_MAX_FIXES):
            fixed = _repair_quote_at(current, exc.pos)
            if fixed is None:
                break
            current = fixed
            try:
                return json.loads(current), "bg_quote_closed_ascii"
            except json.JSONDecodeError as again:
                exc = again
        raise original from None


def parse_answer(text: str) -> dict:
    """The model's JSON, with a code fence removed if it added one."""
    return parse_answer_detail(text)[0]


# The object-valued fields record_from reads with .get(). A provider that does
# not enforce the schema can return a string in their place — measured
# 2026-09-19 23:00: `"quality": "ok"`, which raised AttributeError past every
# handler and killed the analyze stage.
OBJECT_FIELDS = ("quality", "leaning", "russia_stance", "ai_generated",
                 "entities")


def check_answer_shape(parsed) -> None:
    """Refuse a well-formed answer of the wrong shape as a TypeError — a
    parse failure for this article, never an exception for the stage."""
    if not isinstance(parsed, dict):
        raise TypeError(f"answer is a {type(parsed).__name__}, not an object")
    for field in OBJECT_FIELDS:
        value = parsed.get(field)
        if value is not None and not isinstance(value, dict):
            raise TypeError(f"answer field {field!r} is a "
                            f"{type(value).__name__}, not an object")


def record_from(item: dict, article: dict, answer: dict, model: str,
                taxonomy_version: int, mentions: list,
                request_provenance: dict | None = None) -> dict:
    """Assemble the analysis record the validator expects.

    ⚠️ `url` comes from the CORPUS RECORD, not from the queue item — the
    queue does not carry one (it reports path, domain, title, rank and the
    ordering basis), so reading `item["url"]` raised KeyError on the first
    non-dry run and only there. `analyze_articles.py` cross-checks url and
    domain against the corpus anyway, so taking them from the same file it
    will check against is the only version that can be right.
    """
    parsed, json_repair = parse_answer_detail(answer["text"])
    check_answer_shape(parsed)
    served_model = answer.get("model") or model
    usage = bounded_usage(answer.get("usage") or {})
    provenance = {
        **(request_provenance or {}),
        "version": ANALYSIS_PROVENANCE_VERSION,
        "model_requested": model,
        "model_served": served_model,
        "response_id": answer.get("response_id"),
        "provider": answer.get("provider"),
        "request": answer.get("request") or {},
        "usage": usage,
        "attempt_elapsed_s": answer.get("attempt_elapsed_s"),
        "transport_elapsed_s": answer.get("transport_elapsed_s"),
        "transport_attempts": answer.get("attempts"),
        # Present only when the answer needed repair_bg_quotes to parse.
        **({"json_repair": json_repair} if json_repair else {}),
        "claim_sources": {
            "confidence": "model_output",
            "evidence": "model_output",
            "party_tone_grounding": "deterministic_gate_v1",
        },
    }
    rec = {
        # Model output first: pipeline-owned identity and provenance below
        # overwrite any names an unconstrained response tried to mint.
        **parsed,
        "article_path": item["path"],
        "url": article.get("url"),
        "domain": item["domain"],
        "analyzed_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        # ⚠️ The SERVER's model id, not the flag we passed. A run pointed at a
        # server holding a different model would otherwise record a name
        # nobody served, and the whole point of Tier 4 is comparing models.
        "model": served_model,
        "taxonomy_version": taxonomy_version,
        "analysis_provenance": provenance,
        # A wrong MERGE is destructive; a singleton is not. New publishable
        # articles receive a one-member story so the story-led home page can
        # show them immediately. A redo preserves existing membership, while
        # bad-quality/out-of-scope records remain detached as required.
        "story": (
            {"action": "same_story", "story_id": item["story_id"]}
            if item.get("story_id") else
            {
                "action": "new_story",
                "canonical_title_bg": (
                    str(article.get("title") or parsed.get("summary_bg") or "").strip()),
                "canonical_title_en": str(
                    parsed.get("summary_en") or article.get("title") or "").strip(),
                "summary_bg": str(parsed.get("summary_bg") or "").strip(),
                "summary_en": str(parsed.get("summary_en") or "").strip(),
                "related_story_ids": [],
            }
            if ((parsed.get("quality") or {}).get("verdict") == "ok"
                and parsed.get("site_relevant") is True)
            else {"action": "none"}
        ),
    }
    if mentions:
        rec["mentions"] = mentions
    carry_schema_attempts(rec, [])
    return rec


# ⚠️ A SERVER CAN ACCEPT `grammar` AND SILENTLY DROP IT, and every downstream
# symptom then blames something else. Measured against Docker Model Runner
# serving `ai/gemma4:12b`: one-rule grammars are enforced, the rubric's
# 6.4 KB grammar is dropped on every request (6 of 6), and the model then
# invents its OWN schema — `status`, `political_bias`, `party_sentiment`
# where the rubric asks for `quality`, `leaning`, `party_tones`. With
# `response_format: json_object` the reply is clean, parseable JSON of
# entirely the wrong shape, which is the worst of the three states: it looks
# like a model that cannot follow instructions.
#
# The existing canary catches this AFTER the first record — minutes of
# inference — and can only say „probably". This proves it in about a second,
# before the window is spent, by asking for the shortest possible answer and
# checking the ONE thing the grammar guarantees: the root opens with „{".
# ⚠️ BIG ENOUGH FOR A REASONING MODEL TO FINISH THINKING, and 8 was not.
# The run's model reasons (`NEWS_LLM_REASONING_EFFORT=low`), so at 8 tokens
# the whole budget goes to chain-of-thought and the answer never reaches the
# JSON. Providers then differ only in WHERE they report that reasoning, and
# that alone decided whether an hourly run lived: Parasail returns it in its
# own field, so `content` is empty and llm_client raises `reasoning_only`,
# which this function excuses as a skipped probe; Together returns it in
# `content`, so the probe read prose and ABORTED THE WHOLE RUN. Measured
# 2026-09-22, same grammar and schema, each provider pinned:
#
#     tokens   Parasail              Together
#     8        reasoning_only        'Interpreting the single "x"'   ✗
#     64       {"quality":           {"quality":                     ✓
#     256      {"quality":           {"quality":                     ✓
#
# The constraint was enforced on both the whole time — Together holds 185
# validator-passing records in the corpus, at a LOWER schema-retry rate than
# Parasail. 4 of 96 runs were lost to this. 128 is twice the measured floor;
# one probe per run, so the cost is a rounding error.
GRAMMAR_PROBE_TOKENS = 128


def grammar_is_enforced(grammar: str, model: str, url: str | None = None,
                        json_schema: dict | None = None):
    """(ok, detail). `ok` is False only on PROOF that the constraint was dropped.

    ⚠️ It must send EXACTLY what the run sends — both the grammar and the
    schema. A probe that omits one tests a request nobody makes, and would
    pass against a provider that honours only the field it left out.
    """
    try:
        answer = llm_client.complete("", "x", model=model, grammar=grammar,
                                     json_schema=json_schema,
                                     max_tokens=GRAMMAR_PROBE_TOKENS,
                                     url=url)
    except llm_client.LlmError as exc:
        # ⚠️ NOT a verdict. An unreachable server is a different failure and
        # the run's own error handling should report it, not this.
        return True, f"probe skipped: {exc}"
    text = (answer.get("text") or "").strip()
    if not text:
        return True, "probe returned nothing — inconclusive, not a verdict"
    if text.startswith("{"):
        return True, "enforced"
    # ⚠️ A TRUNCATED ANSWER IS NOT PROOF, and this function promises proof.
    # `finish_reason == "length"` means the reply was cut at max_tokens, so
    # "it had not reached the JSON yet" and "it was never going to" are the
    # same observation — and the first is what a reasoning preamble looks
    # like. Aborting here turns a budget that is merely too small into an
    # hourly outage, which is exactly what happened above. The first-record
    # canary still catches a genuinely dropped constraint a minute later.
    if (answer.get("finish_reason") or "") == "length":
        return True, (
            f"probe inconclusive: cut at {GRAMMAR_PROBE_TOKENS} tokens before "
            f"any '{{' — {text[:40]!r}. Raise GRAMMAR_PROBE_TOKENS if this "
            "persists; the first-record canary is the backstop.")
    return False, (
        f"the server accepted the schema constraint and ignored it — a probe "
        f"that "
        f"can only produce '{{' returned {text[:40]!r}. Every record this run "
        "produces would be refused by the validator. Try a smaller grammar, "
        "or a server whose llama.cpp build handles one this size.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--domain", default="all")
    ap.add_argument("--redo", nargs="+", metavar="URL|PATH",
                    help="re-analyse these already-analysed articles instead "
                         "of drawing from the unanalysed queue — the review "
                         "queue's targets. --limit and --domain do not apply.")
    ap.add_argument("--model", default=os.environ.get("NEWS_LLM_MODEL",
                                                      "local-model"))
    ap.add_argument("--dry-run", action="store_true",
                    help="build the prompts and print one, calling no model")
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--temperature", type=float,
                    default=float(os.environ.get("NEWS_LLM_TEMPERATURE", "0.2")))
    ap.add_argument("--workers", type=int,
                    default=int(os.environ.get("NEWS_LLM_WORKERS", "4")),
                    help="concurrent completion requests (default 4)")
    ap.add_argument("--schema-retries", type=int,
                    default=int(os.environ.get("NEWS_LLM_SCHEMA_RETRIES", "1")),
                    help="bounded re-asks after validator rejection (default 1)")
    ap.add_argument("--triage-model",
                    default=os.environ.get("NEWS_LLM_TRIAGE_MODEL") or None,
                    help="optional free OpenRouter model for proof-only "
                         "weather/sports triage; all other cases use --model")
    ap.add_argument("--deadline", type=int,
                    default=int(os.environ.get("NEWS_ANALYZE_DEADLINE_S") or 0),
                    help="seconds after which the stage stops waiting; "
                         "unfinished articles stay queued (0 = no deadline)")
    ap.add_argument("--triage-timeout", type=int,
                    default=int(os.environ.get("NEWS_LLM_TRIAGE_TIMEOUT", "12")),
                    help="seconds for one no-retry free triage request")
    args = ap.parse_args()
    if (args.workers < 1 or args.schema_retries not in (0, 1)
            or not 0 <= args.temperature <= 2
            or args.triage_timeout < 1):
        ap.error("--workers must be at least 1, --schema-retries must be 0 or 1, "
                 "--temperature must be between 0 and 2, and "
                 "--triage-timeout must be positive")

    llm_client.reset_usage_events()

    assets = load_prompt_assets()
    taxonomy_version = json.loads(assets["taxonomy"]).get("version")

    constraint_proven = False
    constraint_detail = "not probed"
    if not args.dry_run:
        ok, detail = grammar_is_enforced(assets["grammar"], args.model,
                                         json_schema=assets["json_schema"])
        constraint_proven = ok and detail == "enforced"
        constraint_detail = detail
        if not ok:
            print(json.dumps(with_run_billing({
                "mode": "analyze_local", "model": args.model,
                "aborted": detail}), ensure_ascii=False))
            return 2

    if args.redo:
        code, queue = run_analyze("--redo", *args.redo)
    else:
        code, queue = run_analyze("--next", args.domain,
                                  "--limit", str(args.limit))
    if code != 0:
        # ⚠️ A redo names its own targets, so a partial result is a FAILURE
        # rather than a short queue — `missing` rides through so the caller
        # learns which article it asked for and did not get.
        print(json.dumps(with_run_billing({"error": "queue_failed", **queue})))
        return 2
    items = queue.get("queue") or []
    if not items:
        print(json.dumps(with_run_billing({
            "mode": "analyze_local", "queued": 0,
            "note": "nothing unanalysed"})))
        return 0

    if args.dry_run:
        first = items[0]
        rec = json.loads((ROOT / first["path"]).read_text(encoding="utf-8"))
        print(build_user_prompt(rec, first.get("mentions") or [],
                               assets["taxonomy"]))
        return 0

    stats = {"mode": "analyze_local", "model": args.model,
             "queued": len(items), "answered": 0, "saved": 0,
             "llm_failed": [], "parse_failed": [], "rejected": [],
             "save_failed": [], "elapsed_s": 0.0,
             "workers": args.workers,
             "schema_retry_limit": args.schema_retries,
             "schema_retry_attempted": 0,
             "schema_retry_succeeded": 0,
             "triage_model": args.triage_model,
             "triage_accepted": 0, "paid_fallback": 0,
             "auto_merged": [], "join_proposals": [], "join_proposal_errors": []}
    started = time.monotonic()
    deadline_at = started + args.deadline if args.deadline > 0 else None
    stats.update(parse_retry_attempted=0, parse_retry_succeeded=0,
                 json_repaired=0, deadline_s=args.deadline or None,
                 deadline_abandoned=[])
    remaining = []
    canary_done = not FIRST_RECORD_IS_A_CANARY
    canary_unusable = 0  # rejections, parse failures and worker exceptions

    def bound_reached(count: int) -> bool:
        """True when the canary has spent its budget; stamps the reason."""
        if count < CANARY_MAX_PARSE_FAILURES:
            return False
        stats["aborted"] = (
            f"{count} unusable answers (rejected, unparseable, or a "
            "worker exception) before any record — read `rejected` / "
            "`parse_failed` / `llm_failed`"
            + ("" if constraint_proven else
               f"; the schema-constraint probe was inconclusive "
               f"({constraint_detail})"))
        return True

    perf_log.emit("analyze", step="stage_start", queued=len(items),
                  workers=args.workers, deadline_s=args.deadline or None)

    def guarded(call, item) -> dict:
        """Run one article's work; an exception becomes that article's
        `worker_exception` failure. The traceback goes to stderr, which the
        scheduler logs, so a crash stays traceable from var/cron.log."""
        try:
            return call()
        except Exception as exc:  # noqa: BLE001
            print(f"analyze_local: worker exception on {item['path']}",
                  file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return {"kind": "llm_failed", "path": item["path"],
                    "error_kind": "worker_exception",
                    "detail": f"{type(exc).__name__}: {exc}"[:200]}

    def past_deadline() -> bool:
        return deadline_at is not None and time.monotonic() >= deadline_at

    def wait_left():
        if deadline_at is None:
            return None
        return max(0.0, deadline_at - time.monotonic())

    def note_saved(record: dict) -> None:
        if (record.get("analysis_provenance") or {}).get("json_repair"):
            stats["json_repaired"] += 1

    # Prove one complete model→validator round trip before opening the worker
    # pool. Otherwise four workers can spend the whole queue on a provider
    # that accepted `response_format` but returned an unusable shape.
    #
    # ⚠️ BOUNDED. Only `unreachable`/`remote_refused` used to end this loop:
    # a parse failure `continue`d, so a provider that accepts `strict` and
    # ignores it would serialize the WHOLE queue here, one call at a time
    # (plan §0.10 W1). After CANARY_MAX_PARSE_FAILURES consecutive
    # unparseable answers the endpoint is declared unusable instead.
    for position, item in enumerate(items):
        if canary_done:
            remaining = items[position:]
            break
        if past_deadline():
            stats["deadline_abandoned"] = [i["path"] for i in items[position:]]
            break
        perf_log.emit("analyze", step="canary_call", path=item["path"])
        result = guarded(lambda: analyze_one(
            item, assets, args.model, args.max_tokens, taxonomy_version,
            args.temperature), item)
        perf_log.emit("analyze", step="canary_result", path=item["path"],
                      kind=result["kind"])
        if result["kind"] != "record":
            if record_worker_failure(stats, result):
                remaining = []
                break
            # EVERY non-record counts, with no reset: mixing kinds (an
            # unreadable article between two bad answers) must not refill the
            # budget and let the canary walk the whole queue.
            canary_unusable += 1
            if bound_reached(canary_unusable):
                remaining = []
                break
            continue
        # NOT reset here: a record that is then REJECTED is still an unusable
        # answer, and resetting on "a record was built" would let a queue of
        # rejections walk the whole queue two calls at a time. Only a SAVED
        # record ends the canary.
        stats["answered"] += 1
        # Per ARTICLE, because the loop now continues past a rejection: the
        # global counter would credit the next article's first-attempt save
        # as a retry success.
        retries_before = stats["schema_retry_attempted"]
        ok, attempt_stats = save_attempt(result["record"])
        last_attempt_stats = attempt_stats
        for _ in range(args.schema_retries):
            if ok:
                break
            if attempt_stats["save_failed"]:
                break
            stats["schema_retry_attempted"] += 1
            retry = guarded(lambda: analyze_one(
                item, assets, args.model, args.max_tokens, taxonomy_version,
                args.temperature), item)
            if retry["kind"] != "record":
                record_worker_failure(stats, retry)
                break
            stats["answered"] += 1
            carry_schema_attempts(retry["record"], [result["record"]])
            ok, last_attempt_stats = save_attempt(retry["record"])
        merge_save_stats(stats, last_attempt_stats)
        if ok:
            note_saved(result["record"])
            if stats["schema_retry_attempted"] > retries_before:
                stats["schema_retry_succeeded"] += 1
            canary_done = True
            remaining = items[position + 1:]
            break

        # ⚠️ A SAVE THAT COULD NOT RUN IS NOT A REJECTION. save()'s contract
        # keeps them apart, and retrying the model cannot fix a save step that
        # failed to execute — so stop, and point at the right evidence.
        if last_attempt_stats["save_failed"]:
            stats["aborted"] = ("the first record could not be SAVED — read "
                                "`save_failed`; the model is not the problem")
            remaining = []
            break

        # ⚠️ ONE REJECTION IS NOT EVIDENCE ABOUT THE ENDPOINT. A server that
        # demonstrably ignores the constraint has already ended the run: the
        # probe returns ok=False and main() exits before this loop. What
        # reaches here is a model mistake on a rule the SCHEMA CANNOT EXPRESS
        # (a subcategory under the wrong category), and mid-queue it costs one
        # article. Measured 2026-09-20: the same article sat at the head of
        # the queue and aborted the 00:00 AND 01:00 runs at 0 saved of 100.
        # So it counts toward the same bound — which is what catches a server
        # that really is ignoring the schema, including when the probe was
        # inconclusive.
        #
        # ⚠️ IT USED TO BE INCONCLUSIVE ON EVERY HOSTED RUN, and that was
        # read here as a fact of life rather than as the defect it was: the
        # probe's 8-token budget was spent on reasoning, so this model never
        # reached the JSON and `constraint_proven` was False in production.
        # The budget now clears the preamble (GRAMMAR_PROBE_TOKENS) and the
        # probe reports `enforced` — measured 2026-09-22, 5 of 5 live calls.
        canary_unusable += 1
        if bound_reached(canary_unusable):
            remaining = []
            break

    def worker_result(future, item) -> dict:
        """A worker that RAISED is one failed article, never a dead stage.

        ⚠️ future.result() re-raises in the main thread; before this guard a
        single unexpected exception discarded every in-flight answer and
        failed the whole analyze stage (2026-09-19 23:00: 5 saved of 100)."""
        return guarded(future.result, item)

    def drain(pool, pending, handle, on_abandon=None) -> None:
        """Consume completed futures until done or the stage deadline.

        ⚠️ On the deadline, unstarted work is cancelled and running calls are
        ABANDONED — never awaited, never saved. Their articles stay
        unanalysed, so the next run's queue picks them up: a slow provider
        costs latency, never coverage. Futures that finished while a handler
        was busy ARE handled — as_completed's timeout would otherwise drop
        them from every bucket."""
        handled = set()
        try:
            for future in as_completed(pending, timeout=wait_left()):
                handled.add(future)
                handle(future)
        except FuturesTimeout:
            abandoned = []
            for future, value in pending.items():
                if future in handled:
                    continue
                if future.done() and not future.cancelled():
                    handle(future)
                    continue
                abandoned.append(value)
                if on_abandon is not None:
                    on_abandon(value)
            paths = [(a[0] if isinstance(a, tuple) else a)["path"]
                     for a in abandoned]
            stats["deadline_abandoned"].extend(paths)
            perf_log.emit("analyze", step="deadline", abandoned=len(paths))
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    def supersede(first_stats, first_failure) -> None:
        """A retry that did not produce a record leaves the FIRST attempt's
        outcome standing: its rejection stats, or its parse failure."""
        if first_stats is not None:
            merge_save_stats(stats, first_stats)
        elif first_failure is not None:
            record_worker_failure(stats, first_failure)

    retry_queue = []
    parse_retry_queue = []
    if canary_done and remaining and not past_deadline():
        perf_log.emit("analyze", step="pool_open", items=len(remaining))
        pool = ThreadPoolExecutor(max_workers=args.workers)
        pending = {
            pool.submit(analyze_routed, item, assets, args.model,
                        args.max_tokens, taxonomy_version,
                        args.triage_model, args.triage_timeout,
                        args.temperature): item
            for item in remaining
        }

        def first_wave(future) -> None:
            result = worker_result(future, pending[future])
            perf_log.emit("analyze", step="result", path=pending[future]["path"],
                          kind=result["kind"])
            if result["kind"] != "record":
                # One bounded in-run retry for an unusable ANSWER; before
                # this a parse failure was simply lost for the run.
                if result.get("model_output"):
                    parse_retry_queue.append((pending[future], result))
                    return
                record_worker_failure(stats, result)
                return
            stats["answered"] += 1
            if result.get("route") == "free_triage":
                stats["triage_accepted"] += 1
            elif result.get("route") == "paid_fallback":
                stats["paid_fallback"] += 1
            ok, attempt_stats = save_attempt(result["record"])
            if ok:
                note_saved(result["record"])
            if ok or attempt_stats["save_failed"] or not args.schema_retries:
                merge_save_stats(stats, attempt_stats)
            else:
                stats["schema_retry_attempted"] += 1
                retry_queue.append((result["item"], attempt_stats,
                                    result["record"]))
        drain(pool, pending, first_wave)
    elif remaining:
        stats["deadline_abandoned"].extend(i["path"] for i in remaining)

    # A second bounded wave preserves the four-request ceiling: retrying in
    # the main thread while the first pool was active would create a fifth
    # simultaneous request.
    if (retry_queue or parse_retry_queue) and not past_deadline():
        perf_log.emit("analyze", step="retry_wave", schema=len(retry_queue),
                      parse=len(parse_retry_queue))
        pool = ThreadPoolExecutor(max_workers=args.workers)
        pending = {}
        for item, first_stats, first_record in retry_queue:
            pending[pool.submit(analyze_one, item, assets, args.model,
                                args.max_tokens, taxonomy_version,
                                args.temperature)] = (
                item, first_stats, first_record)
        for item, first_failure in parse_retry_queue:
            pending[pool.submit(analyze_one, item, assets, args.model,
                                args.max_tokens, taxonomy_version,
                                args.temperature)] = (item, None, first_failure)

        def second_wave(future) -> None:
            item, first_stats, first = pending[future]
            result = worker_result(future, item)
            is_parse_retry = first_stats is None
            if is_parse_retry:
                stats["parse_retry_attempted"] += 1
            if result["kind"] != "record":
                if is_parse_retry:
                    # The retry's failure is the one reported; the first
                    # attempt's is superseded by it.
                    record_worker_failure(stats, result)
                else:
                    supersede(first_stats, None)
                    record_worker_failure(stats, result)
                return
            stats["answered"] += 1
            if is_parse_retry:
                if first.get("route") == "paid_fallback":
                    stats["paid_fallback"] += 1
                    result["record"].setdefault(
                        "analysis_provenance", {})["triage_fallback"] = (
                            first.get("triage_fallback"))
            else:
                carry_schema_attempts(result["record"], [first])
            ok, attempt_stats = save_attempt(result["record"])
            merge_save_stats(stats, attempt_stats)
            if ok:
                note_saved(result["record"])
                if is_parse_retry:
                    stats["parse_retry_succeeded"] += 1
                else:
                    stats["schema_retry_succeeded"] += 1

        def abandon(value) -> None:
            _item, first_stats, first = value
            supersede(first_stats, first if first_stats is None else None)
        drain(pool, pending, second_wave, abandon)
    else:
        for _item, first_failure in parse_retry_queue:
            supersede(None, first_failure)
        for _item, first_stats, _ in retry_queue:
            supersede(first_stats, None)

    stats["elapsed_s"] = round(time.monotonic() - started, 1)
    perf_log.emit("analyze", step="stage_done", queued=stats["queued"],
                  answered=stats["answered"], saved=stats["saved"],
                  parse_failed=len(stats["parse_failed"]),
                  llm_failed=len(stats["llm_failed"]),
                  json_repaired=stats["json_repaired"],
                  parse_retry_succeeded=stats["parse_retry_succeeded"],
                  deadline_abandoned=len(stats["deadline_abandoned"]),
                  elapsed_s=stats["elapsed_s"])
    # ⚠️ A save that FAILED to run at all — a bad taxonomy, unreadable JSON —
    # is not the same as one that rejected records, and neither is success.
    # Reading only `out["saved"]` reported `saved: 1, rejected: []` at exit 0
    # while three analyses vanished, because cmd_save's error shapes carry
    # neither key.
    # Counts beside their denominator, never a bare rate.
    # Say whether the constraint was PROVEN enforced this run: on a hosted
    # endpoint the probe is usually inconclusive, and a reader of `rejected`
    # needs to know which it was.
    stats["constraint_probe"] = constraint_detail
    stats["rejected_count"] = len(stats["rejected"])
    stats["billing"] = summarize_run_billing()
    print(json.dumps(stats, ensure_ascii=False))
    # ⚠️ Non-zero when NOTHING was saved but something was queued, AND when a
    # save call itself failed. A cron job that always exits 0 reports a broken
    # model server as a quiet night.
    code = (2 if stats["save_failed"]
            else 0 if stats["saved"] or not items else 1)
    if stats.get("deadline_abandoned") and not os.environ.get(
            "NEWS_ANALYZE_NO_HARD_EXIT"):
        # ⚠️ The deadline must bound the PROCESS, not just the report: the
        # interpreter joins pool threads at exit, so abandoned calls would
        # otherwise hold the stage open for up to one transport budget more.
        # Everything is already saved and printed; nothing is left to flush.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(code)
    return code


if __name__ == "__main__":
    sys.exit(main())
