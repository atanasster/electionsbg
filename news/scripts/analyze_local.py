#!/usr/bin/env python3
"""Run the analysis loop against a LOCAL model: --next → prompt → llm → save.

This is the decision procedure that used to live in `analyze-news-article/
SKILL.md` — 262 lines of prose an agent reads. A Mac mini running a 12B at
03:00 has no agent, so the branching became code and only the rubric stayed
as prompt text (`news/prompts/analyze_system.md`).

⚠️ IT DOES NOT DECIDE STORY MEMBERSHIP. Clustering needs the candidate set,
the canonical titles and a judgment about whether two events are the same
event — the part of the skill least suited to a 12B and the one whose
mistakes cannot be undone automatically ("merges of distinct events cannot be
undone"). Every record this writes carries `story.action = "none"`, which the
validator already requires for non-ok records and permits for the rest. The
articles are judged; the clustering stays a separate, human-or-better-model
pass. Stated here rather than discovered from an empty /story page.

Run:  python3 news/scripts/analyze_local.py --limit 20 --model gemma-4-12b
      python3 news/scripts/analyze_local.py --dry-run --limit 1
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
import re
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import llm_client  # noqa: E402
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
    return {"saved": 0, "rejected": [], "save_failed": []}


def merge_save_stats(target: dict, source: dict) -> None:
    target["saved"] += source["saved"]
    target["rejected"].extend(source["rejected"])
    target["save_failed"].extend(source["save_failed"])
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
        return {"kind": "parse_failed", "path": item["path"],
                "detail": str(exc)[:200]}
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


def analyze_routed(item: dict, assets: dict, paid_model: str, max_tokens: int,
                   taxonomy_version: int, triage_model: str | None,
                   triage_timeout: int, temperature: float = 0.2) -> dict:
    if not triage_model:
        return analyze_one(item, assets, paid_model, max_tokens,
                           taxonomy_version, temperature)
    triage = triage_one(item, assets, triage_model, triage_timeout,
                        taxonomy_version)
    if triage["kind"] == "record":
        return triage
    paid = analyze_one(item, assets, paid_model, max_tokens, taxonomy_version,
                       temperature)
    if paid.get("kind") == "record":
        paid["record"]["analysis_provenance"]["triage_fallback"] = {
            "model_requested": triage_model,
            "reason": triage.get("reason"),
            **({"generation": triage["answer"]} if triage.get("answer") else {}),
            **({"prompt": triage["request_provenance"]}
               if triage.get("request_provenance") else {}),
        }
        paid["route"] = "paid_fallback"
    return paid


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


def parse_answer(text: str) -> dict:
    """The model's JSON, with a code fence removed if it added one."""
    m = FENCE_RE.match(text or "")
    return json.loads(m.group(1) if m else text)


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
    parsed = parse_answer(answer["text"])
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
        # ⚠️ ALWAYS "none" — see the module docstring. Clustering is not this
        # script's job and a wrong merge cannot be undone automatically.
        # ⚠️ „none" DETACHES, and on a REDO that deletes the story. The
        # queue carries the article's existing story_id (see cmd_redo); a
        # record that had one keeps it, and only a genuinely unclustered
        # article gets „none". Clustering is still not this script's job —
        # it never CREATES or MOVES a story, it only declines to destroy one.
        "story": ({"action": "same_story", "story_id": item["story_id"]}
                  if item.get("story_id") else {"action": "none"}),
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
GRAMMAR_PROBE_TOKENS = 8


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
    if not args.dry_run:
        ok, detail = grammar_is_enforced(assets["grammar"], args.model,
                                         json_schema=assets["json_schema"])
        constraint_proven = ok and detail == "enforced"
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
             "triage_accepted": 0, "paid_fallback": 0}
    started = time.monotonic()
    remaining = []
    canary_done = not FIRST_RECORD_IS_A_CANARY

    # Prove one complete model→validator round trip before opening the worker
    # pool. Otherwise four workers can spend the whole queue on a provider
    # that accepted `response_format` but returned an unusable shape.
    for position, item in enumerate(items):
        if canary_done:
            remaining = items[position:]
            break
        result = analyze_one(item, assets, args.model, args.max_tokens,
                             taxonomy_version, args.temperature)
        if result["kind"] != "record":
            if record_worker_failure(stats, result):
                remaining = []
                break
            continue
        stats["answered"] += 1
        ok, attempt_stats = save_attempt(result["record"])
        last_attempt_stats = attempt_stats
        for _ in range(args.schema_retries):
            if ok:
                break
            if attempt_stats["save_failed"]:
                break
            stats["schema_retry_attempted"] += 1
            retry = analyze_one(item, assets, args.model, args.max_tokens,
                                taxonomy_version, args.temperature)
            if retry["kind"] != "record":
                record_worker_failure(stats, retry)
                break
            stats["answered"] += 1
            carry_schema_attempts(retry["record"], [result["record"]])
            ok, last_attempt_stats = save_attempt(retry["record"])
        merge_save_stats(stats, last_attempt_stats)
        if ok:
            if stats["schema_retry_attempted"]:
                stats["schema_retry_succeeded"] += 1
            canary_done = True
            remaining = items[position + 1:]
            break

        # ⚠️ THE DIAGNOSIS DEPENDS ON THE PREFLIGHT. One bounded retry has
        # already ruled out a one-off malformed answer before the run stops.
        stats["aborted"] = (
            ("the first record was rejected after its bounded schema retry, "
             "and the constraint IS enforced — read `rejected` for the rule "
             "the schema cannot express") if constraint_proven else
            ("the first record was rejected after its bounded schema retry "
             "— the model server may be ignoring the schema constraint"))
        remaining = []
        break

    retry_queue = []
    if canary_done and remaining:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            pending = {
                pool.submit(analyze_routed, item, assets, args.model,
                            args.max_tokens, taxonomy_version,
                            args.triage_model, args.triage_timeout,
                            args.temperature): item
                for item in remaining
            }
            for future in as_completed(pending):
                result = future.result()
                if result["kind"] != "record":
                    record_worker_failure(stats, result)
                    continue
                stats["answered"] += 1
                if result.get("route") == "free_triage":
                    stats["triage_accepted"] += 1
                elif result.get("route") == "paid_fallback":
                    stats["paid_fallback"] += 1
                ok, attempt_stats = save_attempt(result["record"])
                if ok or attempt_stats["save_failed"] or not args.schema_retries:
                    merge_save_stats(stats, attempt_stats)
                else:
                    stats["schema_retry_attempted"] += 1
                    retry_queue.append((result["item"], attempt_stats,
                                        result["record"]))

    # A second bounded wave preserves the four-request ceiling: retrying in
    # the main thread while the first pool was active would create a fifth
    # simultaneous request.
    if retry_queue:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            pending = {
                pool.submit(analyze_one, item, assets, args.model,
                            args.max_tokens, taxonomy_version,
                            args.temperature): (
                                item, first_stats, first_record)
                for item, first_stats, first_record in retry_queue
            }
            for future in as_completed(pending):
                item, first_stats, first_record = pending[future]
                result = future.result()
                if result["kind"] != "record":
                    merge_save_stats(stats, first_stats)
                    record_worker_failure(stats, result)
                    continue
                stats["answered"] += 1
                carry_schema_attempts(result["record"], [first_record])
                ok, attempt_stats = save_attempt(result["record"])
                merge_save_stats(stats, attempt_stats)
                if ok:
                    stats["schema_retry_succeeded"] += 1

    stats["elapsed_s"] = round(time.monotonic() - started, 1)
    # ⚠️ A save that FAILED to run at all — a bad taxonomy, unreadable JSON —
    # is not the same as one that rejected records, and neither is success.
    # Reading only `out["saved"]` reported `saved: 1, rejected: []` at exit 0
    # while three analyses vanished, because cmd_save's error shapes carry
    # neither key.
    # Counts beside their denominator, never a bare rate.
    stats["rejected_count"] = len(stats["rejected"])
    stats["billing"] = summarize_run_billing()
    print(json.dumps(stats, ensure_ascii=False))
    # ⚠️ Non-zero when NOTHING was saved but something was queued, AND when a
    # save call itself failed. A cron job that always exits 0 reports a broken
    # model server as a quiet night.
    if stats["save_failed"]:
        return 2
    return 0 if stats["saved"] or not items else 1


if __name__ == "__main__":
    sys.exit(main())
