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
import json
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


def load_prompt_assets() -> dict:
    missing = [p.name for p in (PROMPTS / "analyze_system.md",
                                PROMPTS / "analyze_schema.gbnf",
                                PROMPTS / "taxonomy_compact.json")
               if not p.exists()]
    if missing:
        raise SystemExit(json.dumps({
            "error": "missing_prompts", "missing": missing,
            "hint": "run python3 news/scripts/build_prompts.py"}))
    return {
        "system": (PROMPTS / "analyze_system.md").read_text(encoding="utf-8"),
        "grammar": (PROMPTS / "analyze_schema.gbnf").read_text(encoding="utf-8"),
        "taxonomy": (PROMPTS / "taxonomy_compact.json").read_text(
            encoding="utf-8"),
    }


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


def record_from(item: dict, article: dict, answer: dict, model: str,
                taxonomy_version: int, mentions: list) -> dict:
    """Assemble the analysis record the validator expects.

    ⚠️ `url` comes from the CORPUS RECORD, not from the queue item — the
    queue does not carry one (it reports path, domain, title, rank and the
    ordering basis), so reading `item["url"]` raised KeyError on the first
    non-dry run and only there. `analyze_articles.py` cross-checks url and
    domain against the corpus anyway, so taking them from the same file it
    will check against is the only version that can be right.
    """
    parsed = json.loads(answer["text"])
    rec = {
        "article_path": item["path"],
        "url": article.get("url"),
        "domain": item["domain"],
        "analyzed_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        # ⚠️ The SERVER's model id, not the flag we passed. A run pointed at a
        # server holding a different model would otherwise record a name
        # nobody served, and the whole point of Tier 4 is comparing models.
        "model": answer.get("model") or model,
        "taxonomy_version": taxonomy_version,
        **parsed,
        # ⚠️ ALWAYS "none" — see the module docstring. Clustering is not this
        # script's job and a wrong merge cannot be undone automatically.
        "story": {"action": "none"},
    }
    if mentions:
        rec["mentions"] = mentions
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--domain", default="all")
    ap.add_argument("--model", default=os.environ.get("NEWS_LLM_MODEL",
                                                      "local-model"))
    ap.add_argument("--dry-run", action="store_true",
                    help="build the prompts and print one, calling no model")
    ap.add_argument("--max-tokens", type=int, default=2048)
    args = ap.parse_args()

    assets = load_prompt_assets()
    taxonomy_version = json.loads(assets["taxonomy"]).get("version")

    code, queue = run_analyze("--next", args.domain, "--limit", str(args.limit))
    if code != 0:
        print(json.dumps({"error": "queue_failed", **queue}))
        return 2
    items = queue.get("queue") or []
    if not items:
        print(json.dumps({"mode": "analyze_local", "queued": 0,
                          "note": "nothing unanalysed"}))
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
             "save_failed": [], "elapsed_s": 0.0}
    started = time.monotonic()
    batch = []
    canary_done = False
    for n, item in enumerate(items, 1):
        try:
            rec = json.loads((ROOT / item["path"]).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            stats["parse_failed"].append({"path": item["path"],
                                          "detail": str(exc)[:200]})
            continue
        prompt = build_user_prompt(rec, item.get("mentions") or [],
                                   assets["taxonomy"])
        try:
            answer = llm_client.complete(
                assets["system"], prompt, model=args.model,
                grammar=assets["grammar"], max_tokens=args.max_tokens)
        except llm_client.LlmError as exc:
            stats["llm_failed"].append({"path": item["path"],
                                        "kind": exc.kind,
                                        "detail": exc.detail[:200]})
            # ⚠️ An UNREACHABLE server aborts the run; a per-article failure
            # does not. Continuing through 200 connection refusals produces a
            # report full of identical errors and no analyses.
            if exc.kind in ("unreachable", "remote_refused"):
                break
            continue
        stats["answered"] += 1
        try:
            batch.append(record_from(item, rec, answer, args.model,
                                     taxonomy_version,
                                     item.get("mentions") or []))
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            stats["parse_failed"].append({"path": item["path"],
                                          "detail": str(exc)[:200]})
            continue

        # ⚠️ THE CANARY, and it is keyed on the first record BUILT, not on
        # the queue index. `n == 1` meant an unreadable first article
        # silently disabled it — the run then discovered a grammar-ignoring
        # server only after the whole queue, which is the entire window.
        if FIRST_RECORD_IS_A_CANARY and not canary_done:
            canary_done = True
            if not save(batch, stats):
                stats["aborted"] = (
                    "the first record was rejected by the validator — the "
                    "model server is probably ignoring the GBNF grammar. "
                    "Stopping rather than spending the window producing "
                    "records that will all be refused.")
                batch = []
                break
            batch = []

    if batch:
        save(batch, stats)

    stats["elapsed_s"] = round(time.monotonic() - started, 1)
    # ⚠️ A save that FAILED to run at all — a bad taxonomy, unreadable JSON —
    # is not the same as one that rejected records, and neither is success.
    # Reading only `out["saved"]` reported `saved: 1, rejected: []` at exit 0
    # while three analyses vanished, because cmd_save's error shapes carry
    # neither key.
    # Counts beside their denominator, never a bare rate.
    stats["rejected_count"] = len(stats["rejected"])
    print(json.dumps(stats, ensure_ascii=False))
    # ⚠️ Non-zero when NOTHING was saved but something was queued, AND when a
    # save call itself failed. A cron job that always exits 0 reports a broken
    # model server as a quiet night.
    if stats["save_failed"]:
        return 2
    return 0 if stats["saved"] or not items else 1


if __name__ == "__main__":
    sys.exit(main())
