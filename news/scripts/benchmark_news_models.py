#!/usr/bin/env python3
"""Benchmark local or hosted models on frozen, already-analysed news articles.

This NEVER calls --save-analysis: hypotheses and raw replies live under the
chosen output directory, away from news/data/analysis. The existing analyses
are copied as an agreement reference. They are not human gold, so the report
uses `reference_agreement`, never `accuracy`.

Run:
  set -a; source .env.local; set +a
  python3 news/scripts/benchmark_news_models.py \
    --config news/evals/openrouter_pilot.json
"""

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import ssl
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import analyze_articles as aa  # noqa: E402
import analyze_local  # noqa: E402
import llm_client  # noqa: E402

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions"


def safe_name(model: str) -> str:
    return model.replace("/", "__").replace(":", "_")


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def percentile(values: list[float], q: float):
    if not values:
        return None
    xs = sorted(values)
    return round(xs[round((len(xs) - 1) * q)], 2)


def analysis_path(article_path: str) -> Path:
    rel = Path(article_path)
    return ROOT / "news/data/analysis/articles" / rel.parent.name / rel.name


def score(ref_dir: Path, hyp_dir: Path, *, score_mentions: bool = False) -> dict:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "news/scripts/score_analyses.py"),
         "--ref", str(ref_dir), "--hyp", str(hyp_dir), "--json"],
        capture_output=True, text=True, env={**os.environ,
                                             "DATA_BG_ROOT": str(ROOT)})
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": "scorer_non_json", "exit": proc.returncode,
                "stdout": proc.stdout[:500], "stderr": proc.stderr[:500]}
    if proc.returncode:
        result["exit"] = proc.returncode
    # The 365 GLM-era references predate the optional resolved `mentions`
    # block. Hypotheses receive today's deterministic gazetteer mentions from
    # --redo, so scoring them against an absent reference block reports fake
    # false positives and precision 0. The adjudicated gold set DOES carry
    # verified mentions, so a config that opts into it must keep that score.
    if not score_mentions and (result.get("fields") or {}).get("mentions") is not None:
        result["fields"]["mentions"] = {
            "not_scored": True,
            "why": "existing reference analyses predate resolved mentions; "
                   "hypothesis mentions are attached deterministically",
        }
    return result


def summarize_usage(rows: list[dict]) -> dict:
    """Token and billed-cost totals from completed OpenRouter responses.

    Failed requests often carry no usage object, so coverage is explicit. A
    monthly projection based on three successful rows without saying so is a
    price estimate with a hidden denominator.
    """
    usages = [r.get("usage") for r in rows if isinstance(r.get("usage"), dict)]
    totals = {
        "prompt_tokens": sum(int(u.get("prompt_tokens") or 0) for u in usages),
        "completion_tokens": sum(int(u.get("completion_tokens") or 0) for u in usages),
        "total_tokens": sum(int(u.get("total_tokens") or 0) for u in usages),
        "cost_usd": round(sum(float(u.get("cost") or 0) for u in usages), 8),
    }
    n = len(usages)
    per_article = {
        key: round(value / n, 6) if n else None
        for key, value in totals.items()
    }
    cost = per_article["cost_usd"]
    projections = {}
    if cost is not None:
        for daily in (150, 250, 1000, 1500):
            projections[str(daily)] = {
                "daily_usd": round(cost * daily, 4),
                "monthly_30d_usd": round(cost * daily * 30, 2),
            }
    return {
        "responses_with_usage": n,
        "attempted_rows": len(rows),
        "totals": totals,
        "per_response": per_article,
        "projections": projections,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="news/evals/openrouter_pilot.json")
    ap.add_argument("--out", default=None)
    ap.add_argument("--resume", action="store_true",
                    help="reuse raw replies already present under --out and "
                         "continue an interrupted model run")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--models", nargs="+",
                    help="override the model list in the config")
    args = ap.parse_args()

    config_path = ROOT / args.config
    config = json.loads(config_path.read_text(encoding="utf-8"))
    models = args.models or config["models"]
    configured_reference = config.get("reference_dir")
    reference_kind = config.get(
        "reference_kind",
        "human_adjudicated_gold" if configured_reference
        else "existing model-produced analyses")
    score_mentions = bool(config.get("score_mentions", False))
    endpoint_host = (urlparse(args.url).hostname or "").lower()
    is_local = endpoint_host in llm_client.LOCAL_HOSTS
    if not is_local and not os.environ.get("OPENROUTER_API_KEY") \
            and not os.environ.get("NEWS_LLM_API_KEY"):
        print(json.dumps({"error": "missing_api_key",
                          "hint": "source .env.local first"}))
        return 2

    # Running this dedicated hosted-model benchmark is the explicit act that
    # authorizes its configured remote endpoint. The general client still
    # refuses remote URLs everywhere else unless the caller opts in.
    if not is_local:
        os.environ["NEWS_LLM_ALLOW_REMOTE"] = "1"
    # The python.org macOS build can have no installed OpenSSL CA file even
    # though curl and the OS trust store work. Prefer the explicit user
    # setting; otherwise use macOS's system bundle when Python reports none.
    # Never disable verification: an eval sends full article text and a key.
    if not os.environ.get("SSL_CERT_FILE") \
            and ssl.get_default_verify_paths().cafile is None \
            and Path("/etc/ssl/cert.pem").exists():
        os.environ["SSL_CERT_FILE"] = "/etc/ssl/cert.pem"
    assets = analyze_local.load_prompt_assets()
    tax, cats = aa.load_taxonomy()
    index = aa.load_index()
    taxonomy_version = tax["version"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(args.out) if args.out else ROOT / "news/data/evals" / stamp
    if not out.is_absolute():
        out = ROOT / out
    ref_dir = out / "reference"

    items = []
    for article_path in config["articles"]:
        article = json.loads((ROOT / article_path).read_text(encoding="utf-8"))
        code, queue = analyze_local.run_analyze("--redo", article_path)
        if code or len(queue.get("queue") or []) != 1:
            print(json.dumps({"error": "redo_failed", "article": article_path,
                              "detail": queue}, ensure_ascii=False))
            return 2
        item = queue["queue"][0]
        ref = ((ROOT / configured_reference / item["domain"]
                / Path(article_path).name)
               if configured_reference else analysis_path(article_path))
        if not ref.exists():
            print(json.dumps({"error": "missing_reference",
                              "article": article_path}))
            return 2
        write_json(ref_dir / item["domain"] / Path(article_path).name,
                   json.loads(ref.read_text(encoding="utf-8")))
        items.append((item, article))

    model_reports = []
    for model in models:
        model_dir = out / "models" / safe_name(model)
        hyp_dir = model_dir / "analyses"
        rows = []
        for item, article in items:
            # The frozen samples are necessarily REDO items, so their queue
            # records can carry a story_id from the reference analysis.
            # Keeping that old clustering decision makes a model response
            # that newly classifies the article as filler/too_short fail the
            # cross-field validator as `same_story`, even though a newly
            # acquired article (the production case being benchmarked) has no
            # prior story to preserve. Story clustering is deterministic and
            # deliberately outside this model eval, so remove that state.
            eval_item = {**item, "story_id": None}
            prompt = analyze_local.build_user_prompt(
                article, item.get("mentions") or [], assets["taxonomy"])
            started = time.monotonic()
            raw_path = (model_dir / "raw" / item["domain"]
                        / Path(item["path"]).name)
            hyp_path = hyp_dir / item["domain"] / Path(item["path"]).name
            try:
                if args.resume and raw_path.exists():
                    answer = json.loads(raw_path.read_text(encoding="utf-8"))
                    record = analyze_local.record_from(
                        eval_item, article, answer, model, taxonomy_version,
                        item.get("mentions") or [])
                    errors = aa.validate_analysis(record, tax, cats, index)
                    # A resumed rescore may make a once-valid record invalid
                    # after a validator or harness correction. Never let that
                    # stale hypothesis survive and inflate agreement.
                    hyp_path.unlink(missing_ok=True)
                    if not errors:
                        write_json(hyp_path, record)
                    rows.append({
                        "article_path": item["path"],
                        "status": "valid" if not errors else "rejected",
                        "elapsed_s": answer.get("elapsed_s"),
                        "final_attempt_elapsed_s": answer.get("elapsed_s"),
                        "attempts": answer.get("attempts"),
                        "usage": answer.get("usage"),
                        "served_model": answer.get("model"),
                        "errors": errors,
                        "resumed_from_raw": True,
                    })
                    continue
                # OpenRouter does not expose llama.cpp GBNF. Strict JSON
                # Schema is the equivalent contract for endpoints that list
                # structured_outputs/response_format support.
                answer = llm_client.complete(
                    assets["system"], prompt, model=model,
                    grammar=assets["grammar"] if is_local else None,
                    json_schema=assets["json_schema"],
                    max_tokens=args.max_tokens, timeout=args.timeout,
                    url=args.url)
                wall_elapsed = round(time.monotonic() - started, 2)
                write_json(raw_path, answer)
                record = analyze_local.record_from(
                    eval_item, article, answer, model, taxonomy_version,
                    item.get("mentions") or [])
                errors = aa.validate_analysis(record, tax, cats, index)
                hyp_path.unlink(missing_ok=True)
                if not errors:
                    write_json(hyp_path, record)
                rows.append({"article_path": item["path"],
                             "status": "valid" if not errors else "rejected",
                             # Full user-visible wall time, including retries
                             # and backoff. The final attempt alone is useful
                             # diagnostically but is not the speed a nightly
                             # job experiences.
                             "elapsed_s": wall_elapsed,
                             "final_attempt_elapsed_s": answer.get("elapsed_s"),
                             "attempts": answer.get("attempts"),
                             "usage": answer.get("usage"),
                             "served_model": answer.get("model"),
                             "errors": errors})
            except (llm_client.LlmError, json.JSONDecodeError, KeyError,
                    TypeError) as exc:
                rows.append({"article_path": item["path"], "status": "failed",
                             "elapsed_s": round(time.monotonic() - started, 2),
                             "error": f"{type(exc).__name__}: {str(exc)[:500]}"})
                # A transport-wide failure is not nine independent article
                # failures. Stop this model immediately; otherwise retries
                # turn a bad CA/server into a fake latency benchmark.
                if isinstance(exc, llm_client.LlmError) and exc.kind in {
                        "unreachable", "remote_refused"}:
                    break
        latencies = [r["elapsed_s"] for r in rows
                     if isinstance(r.get("elapsed_s"), (int, float))]
        valid = sum(r["status"] == "valid" for r in rows)
        report = {
            "requested_model": model,
            "articles_requested": len(items),
            "articles_attempted": len(rows),
            "valid_records": valid,
            "valid_rate": round(valid / len(rows), 3) if rows else None,
            "usage": summarize_usage(rows),
            "latency_s": {
                "mean": round(statistics.mean(latencies), 2) if latencies else None,
                "median": round(statistics.median(latencies), 2) if latencies else None,
                "p90": percentile(latencies, .9),
                "total": round(sum(latencies), 2),
            },
            "reference_agreement": score(
                ref_dir, hyp_dir, score_mentions=score_mentions) if valid else None,
            "rows": rows,
        }
        write_json(model_dir / "report.json", report)
        model_reports.append(report)

    summary = {
        "mode": "news_model_benchmark",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": str(config_path.relative_to(ROOT)),
        "output": str(out),
        "reference_kind": reference_kind,
        "accuracy_warning": (
            "Scores are against the repository's completed adjudicated gold "
            "set." if reference_kind == "human_adjudicated_gold" else
            "These are agreement scores against existing GLM-era analyses, "
            "not accuracy against human gold."),
        "price": ("local inference; no API charge; host power and hardware "
                  "time not measured" if is_local else
                  "Actual billed cost from each response usage object; model "
                  "catalog prices and provider availability can change."),
        "settings": {
            "endpoint": args.url,
            "temperature": 0.2,
            "max_output_tokens": args.max_tokens,
            "article_body_chars": 6000,
            "output_constraint": ("GBNF plus strict JSON Schema" if is_local
                                  else "strict JSON Schema"),
            "provider_require_parameters": not is_local,
            "reasoning": ("chat template thinking disabled" if is_local else
                          f"effort {os.environ.get('NEWS_LLM_REASONING_EFFORT') or 'none'}, excluded"),
            "requests": "sequential; up to 3 attempts on 429/5xx/timeout with 2s then 4s backoff",
        },
        "models": model_reports,
    }
    write_json(out / "summary.json", summary)
    print(json.dumps({
        "mode": summary["mode"], "output": summary["output"],
        "reference_kind": summary["reference_kind"],
        "accuracy_warning": summary["accuracy_warning"],
        "models": [{
            "requested_model": m["requested_model"],
            "valid_records": m["valid_records"],
            "articles_attempted": m["articles_attempted"],
            "valid_rate": m["valid_rate"],
            "latency_s": m["latency_s"],
            "report": str(out / "models" / safe_name(m["requested_model"])
                          / "report.json"),
        } for m in model_reports],
    }, ensure_ascii=False))
    return 0 if any(m["valid_records"] for m in model_reports) else 1


if __name__ == "__main__":
    sys.exit(main())
