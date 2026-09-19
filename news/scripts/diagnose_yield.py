#!/usr/bin/env python3
"""Per-provider structured-output yield for the analyze model (plan Phase 1.2).

The 2026-09-02 run lost 26 of 100 queued articles to invalid JSON although
every request carried `response_format: json_schema, strict` and
`provider.require_parameters`; 99 of its 109 responses came from ONE provider.
This re-sends named articles — by default the `parse_failed` set of a run
report — to each provider in turn, with `allow_fallbacks: false` so the answer
is attributable, and records per provider: yield, the failure CLASS (see
CLASSES), and latency and cost.

Queue items are rebuilt with the pipeline's own `--redo` path, so each prompt
is byte-for-byte the one the analyze stage would send, mentions included; an
answer counts as `ok` only if the pipeline's own `record_from` accepts it —
the same test behind the run report's `parse_failed`.

Raw answer text is kept (it is the only evidence of WHY a parse failed) under
news/data/_perf/diagnose/, which the private-archive upload excludes. Nothing
is saved to the analysis store.

Run:
  python3 news/scripts/diagnose_yield.py --report news/data/_nightly/<run>.json \\
      --providers NextBit,Together,Parasail [--limit 10]

⚠️ OpenRouter only (NEWS_LLM_URL must point there — a local server would
ignore the pin and report one model under N names), and it spends money:
one paid call per (article, provider), ~$0.001 each — so 26 articles cost
~$0.03 per provider. The planned call count is printed before anything runs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze_local  # noqa: E402
import llm_client  # noqa: E402

NEWS = Path(__file__).resolve().parent.parent

CLASSES = {
    "ok": "parsed AND accepted by the pipeline's record_from",
    "shape_error": "valid JSON the pipeline still rejects (KeyError/TypeError)",
    "truncated": "cut at max_tokens (finish_reason=length)",
    "trailing_data": "a complete object followed by more text",
    "bg_quote_closed_ascii": "a Bulgarian quotation opened with „ and closed "
                             "with an ASCII \" — which ends the JSON string",
    "unescaped_quote": "some other bare quote closed a string early; parsing "
                       "resumed mid-word",
    "empty": "no answer text",
    "other_json_error": "any other JSON syntax error",
    "unpinned": "answered by a provider other than the one pinned",
    "llm_error": "transport/HTTP failure (e.g. 429, timeout)",
    "harness_error": "this tool failed on the row (e.g. a write error)",
}
NOT_ANSWERED = {"llm_error", "harness_error"}


def classify(text: str, finish_reason: Optional[str]) -> str:
    """Why an answer did or did not parse. `ok` here means SYNTAX only;
    main() upgrades it through record_from."""
    try:
        # repair=False: this measures what the PROVIDER sent, not what the
        # pipeline's repair can rescue.
        analyze_local.parse_answer_detail(text, repair=False)
        return "ok"
    except json.JSONDecodeError as exc:
        if finish_reason == "length":
            return "truncated"
        if exc.msg.startswith("Extra data"):
            return "trailing_data"
        if not (text or "").strip():
            return "empty"
        # The shape of every NextBit failure on 2026-09-19: „Frognews" —
        # opened with the Bulgarian low quote, closed with an ASCII one.
        before = text[:exc.pos]
        quote = before.rfind('"')
        if quote > 0:
            lead = before[max(0, quote - 200):quote]
            if lead.rfind("„") > max(lead.rfind('"'), lead.rfind("“")):
                return "bg_quote_closed_ascii"
        # A bare `"` inside a string value closes it early, so the parser
        # resumes MID-WORD and trips on a LETTER. A merely missing comma
        # (`{"a": 1 "b": 2}`) trips on the next key's opening quote instead.
        at = text[exc.pos:exc.pos + 1]
        if exc.msg.startswith(("Expecting ',' delimiter",
                               "Expecting ':' delimiter")) and at.isalpha():
            return "unescaped_quote"
        return "other_json_error"


def percentile(values: list, q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return round(ordered[index], 2)


def summarise(rows: list) -> dict:
    by_provider: dict = {}
    for row in rows:
        by_provider.setdefault(row["provider_requested"], []).append(row)
    out = {}
    for provider, items in sorted(by_provider.items()):
        answered = [r for r in items if r["class"] not in NOT_ANSWERED]
        ok = [r for r in answered if r["class"] == "ok"]
        latency = [r["latency_s"] for r in answered
                   if r.get("latency_s") is not None]
        classes: dict = {}
        for r in items:
            classes[r["class"]] = classes.get(r["class"], 0) + 1
        out[provider] = {
            "sent": len(items), "answered": len(answered), "accepted": len(ok),
            "accept_rate": round(len(ok) / len(answered), 3) if answered else None,
            "classes": classes,
            "latency_p50_s": percentile(latency, 0.5),
            "latency_p90_s": percentile(latency, 0.9),
            "cost_usd": round(sum(r.get("cost") or 0 for r in items), 6),
            "served_by": sorted({r.get("provider_served") or "?"
                                 for r in answered}),
        }
    return out


def paths_from_report(report_path: Path) -> list:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    stage = next((s for s in report.get("stages") or []
                  if s.get("stage") == "analyze"), None)
    if stage is None:
        raise ValueError(f"{report_path} has no analyze stage")
    return [p["path"] for p in (stage.get("result") or {})
            .get("parse_failed") or []]


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--report", type=Path,
                     help="a _nightly run report; its parse_failed set is used")
    src.add_argument("--paths", nargs="+", help="article paths (repo-relative)")
    ap.add_argument("--providers", required=True,
                    help="comma-separated OpenRouter provider names")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--model", default=None)
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--timeout", type=int, default=120,
                    help="seconds per request (one attempt, no retry)")
    ap.add_argument("--out-dir", type=Path,
                    default=NEWS / "data" / "_perf" / "diagnose")
    args = ap.parse_args(argv)

    host = (urlparse(os.environ.get("NEWS_LLM_URL") or "").hostname or "")
    if host.lower() != "openrouter.ai":
        print(json.dumps({"error": "not_openrouter",
                          "detail": "NEWS_LLM_URL must point at openrouter.ai; "
                                    "a pin is meaningless elsewhere"}))
        return 2
    try:
        paths = paths_from_report(args.report) if args.report else list(args.paths)
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": "bad_report", "detail": str(exc)[:200]}))
        return 2
    if args.limit:
        paths = paths[:args.limit]
    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    if not paths or not providers:
        print(json.dumps({"error": "nothing_to_diagnose"}))
        return 2

    code, queue = analyze_local.run_analyze("--redo", *paths)
    items = queue.get("queue") or []
    missing = queue.get("missing") or []
    if not items:
        # A redo naming a vanished path fails the WHOLE call; only an empty
        # queue is fatal here — the rest is still worth measuring.
        print(json.dumps({"error": "queue_failed", "exit": code, **queue}))
        return 2
    assets = analyze_local.load_prompt_assets()
    taxonomy_version = json.loads(assets["taxonomy"]).get("version")
    model = (args.model or os.environ.get("NEWS_LLM_MODEL") or "local-model")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    raw_dir = args.out_dir / stamp
    raw_dir.mkdir(parents=True, exist_ok=True)

    def one(index: int, item: dict, article: dict, prompt: str,
            provider: str) -> dict:
        row = {"path": item["path"], "provider_requested": provider}
        started = time.monotonic()
        try:
            try:
                answer = llm_client.complete(
                    assets["system"], prompt, model=model,
                    grammar=assets["grammar"],
                    json_schema=assets["json_schema"],
                    max_tokens=args.max_tokens, max_attempts=1,
                    timeout=args.timeout,
                    provider={"order": [provider], "allow_fallbacks": False})
            except llm_client.LlmError as exc:
                row.update({"class": "llm_error", "error": exc.kind,
                            "detail": exc.detail[:200],
                            "error_elapsed_s":
                                round(time.monotonic() - started, 2)})
                return row
            usage = answer.get("usage") or {}
            finish = answer.get("finish_reason")
            served = answer.get("provider")
            klass = classify(answer["text"], finish)
            if klass == "ok":
                try:
                    analyze_local.record_from(
                        item, article, answer, model, taxonomy_version,
                        item.get("mentions") or [])
                except (json.JSONDecodeError, KeyError, TypeError):
                    klass = "shape_error"
            if served and served != provider:
                klass = "unpinned"
            name = (f"{index:03d}.{Path(item['path']).parent.name}."
                    f"{Path(item['path']).stem[:50]}."
                    f"{provider.replace('/', '_')}.txt")
            (raw_dir / name).write_text(answer["text"], encoding="utf-8")
            row.update({"class": klass, "finish_reason": finish,
                        "provider_served": served,
                        "latency_s": answer.get("transport_elapsed_s"),
                        "completion_tokens": usage.get("completion_tokens"),
                        "cost": usage.get("cost"), "raw_file": name})
            return row
        except Exception as exc:  # noqa: BLE001 — never lose the paid rows
            row.update({"class": "harness_error",
                        "detail": f"{type(exc).__name__}: {exc}"[:200]})
            return row

    tasks = []
    for index, item in enumerate(items):
        article = json.loads((analyze_local.ROOT / item["path"])
                             .read_text(encoding="utf-8"))
        prompt = analyze_local.build_user_prompt(
            article, item.get("mentions") or [], assets["taxonomy"])
        tasks.extend((index, item, article, prompt, provider)
                     for provider in providers)
    print(json.dumps({"planned_calls": len(tasks), "providers": providers,
                      "articles": len(items), "missing": missing}),
          file=sys.stderr)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(lambda task: one(*task), tasks))

    result = {"mode": "diagnose_yield", "model": model, "articles": len(items),
              "missing": missing, "providers": providers,
              "raw_dir": str(raw_dir), "classes": CLASSES,
              "summary": summarise(rows), "rows": rows}
    (raw_dir / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items()
                      if k not in ("rows", "classes")},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
