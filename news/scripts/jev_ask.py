#!/usr/bin/env python3
"""T4.4 Phase 2 — ASK Jev the sentiment questions and build the record.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` §5. Two calls per article:

    A  the article axes   leaning_applies (noul) + leaning (score)
                          russia_applies  (noul) + russia_stance (score)
    B  the subjects       primary_subject (choice) + one score per subject

⚠️ TWO CALLS, NOT ONE, AND NOT ONE PER QUESTION. The client bills the state
ONCE per request — measured, three separate calls cost 2,558 input tokens
against 1,116 batched — so a call per question is the expensive shape. But a
single call cannot carry both sets: the ceiling is 8 questions, the axes need
4, and the subject side needs one per subject plus the primary choice, which
would leave room for three subjects on an article that routinely has six.
Splitting on that seam also keeps one call's failure from taking the other's
answers with it.

⚠️ A `report_worthy` SKIP IS OUR BUG AND MUST NOT PASS QUIETLY. `jev_client`
distinguishes "our payload was refused" (`invalid_request`) from "the endpoint
moved" and from an outage, precisely so a caller can tell them apart — and its
header says a 400 on a payload of ours would otherwise "hide it for ever while
paying GLM for every article". Here it fails the run.

⚠️ NOTHING PARTIAL IS STORED AS A SCORE. A call that fails, times out or
returns an answer the contract refuses produces a recorded REASON, never a
neutral. That is `jev_scales`' rule carried up a level, and it is written
against a shipped example that defaults a missing answer to `score 2.0,
confidence 0.75` through the same field shape a real answer uses.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

import jev_axes as ax  # noqa: E402
import jev_client as jc  # noqa: E402
import jev_scales as js  # noqa: E402
import jev_sentiment as sm  # noqa: E402

# ⚠️ `shadow` IS THE DEFAULT, deliberately. Plan Phase 5 flips this per axis and
# only for axes Phase 0 cleared; until then the pass writes its sidecars and no
# page reads them. `off` skips the network entirely.
MODES = ("off", "shadow", "live")
MODE_ENV = "NEWS_JEV_SENTIMENT"

# Measured 6.9x wall-clock against serial, accuracy unchanged within noise,
# zero 429s. The first call of a session is slow (1,614 ms, then ~400 ms).
DEFAULT_CONCURRENCY = 8

PRIMARY_NONE = "none"


def mode() -> str:
    """The scoring mode, or `"invalid"` for a value that is not one.

    ⚠️ A TYPO IS REFUSED, NOT READ AS THE DEFAULT. `shadow` is the PAID mode,
    so falling back to it turned `NEWS_JEV_SENTIMENT=of` into a pass that
    spends money — the opposite of what the operator typed. `jev_publication`
    already refuses an unknown axis name for the same reason; the two knobs
    sit side by side in `config.env` and must behave alike. Unset or empty is
    still the default.
    """
    value = (os.environ.get(MODE_ENV) or "shadow").strip().lower()
    return value if value in MODES else "invalid"


def empty_stats() -> dict:
    """The counters every payload carries — ONE shape, so a counter added to
    the run reaches the skipped branches too."""
    return {"assessed": 0, "cached": 0, "failed": 0, "crashed": 0,
            "our_bugs": [], "crashes": [], "cost": 0.0}


def alert_for(stats: dict):
    """The one alert a run's stats earn, or None.

    ⚠️ `all_failed` IS THE ALERT A MISCONFIGURED HOST RAISES. With no
    `OPENROUTER_API_KEY` every call returns `no_key` and every article is a
    `failed` record — which `current_for` rightly refuses as current — so the
    same newest articles are re-asked every hour, forever, and the stage exits
    0 each time. Only `our_bug` raised an alert before; this was a permanent
    no-op nobody would be told about.
    """
    if stats.get("our_bugs"):
        return "our_bug"
    attempted = stats.get("assessed", 0) + stats.get("crashed", 0)
    if attempted and stats.get("failed", 0) + stats.get("crashed", 0) >= attempted:
        return "all_failed"
    return None


# ─── the questions ───────────────────────────────────────────────────────────

def axis_questions() -> dict:
    """Call A — both article axes, each with its applicability gate."""
    questions = {}
    for axis in ax.ARTICLE_AXES:
        questions[axis["applies_id"]] = {
            "type": "noul",
            "instructions": axis["applies_instructions"],
        }
        questions[axis["id"]] = {
            "type": "score",
            "instructions": axis["instructions"],
            "criteria": list(axis["scale"].anchors),
        }
    return questions


def _instructions(text: str) -> str:
    """One question's instructions, inside the client's cap. See `_option`."""
    cap = jc.LIMITS["instructions_chars"]
    return text if len(text) <= cap else text[:cap - 1] + "…"


def _option(text: str) -> str:
    """One choice option, inside the client's per-option cap."""
    cap = jc.LIMITS["option_chars"]
    return text if len(text) <= cap else text[:cap - 1] + "…"


def subject_questions(subjects: list, scale=None) -> dict:
    """Call B — which subject the article is about, and a tone for each.

    ⚠️ THE QUESTION ID CARRIES THE INDEX, and the index is the one in `state`.
    Keying on the NAME would put a party's own spelling into a payload key and
    into an answer key, where a quote or a dot is a different kind of problem;
    keying on position keeps the two sides joined by the same integer the
    state publishes as `i`.
    """
    scale = scale or ax.SUBJECT_TONE
    sm.check_subject_budget(subjects)
    # ⚠️ TRUNCATED, NOT REFUSED. An entity name longer than the client's
    # per-option cap is a DATA condition — the longest in the corpus is 65
    # characters, but nothing bounds it — and letting `build_payload` refuse it
    # would report a corpus oddity as `invalid_request`, which this pipeline
    # treats as our bug and exits non-zero on.
    questions = {
        "primary_subject": {
            "type": "choice",
            "instructions": ax.PRIMARY_SUBJECT_INSTRUCTIONS,
            "criteria": {
                **{str(i): _option(f"{s['name']} ({s['kind']})")
                   for i, s in enumerate(subjects)},
                PRIMARY_NONE: "материалът не е за никого от изброените",
            },
        }
    }
    for i, subject in enumerate(subjects):
        questions[f"tone_{i}"] = {
            "type": "score",
            "instructions": _instructions(
                f"{ax.SUBJECT_TONE_INSTRUCTIONS}\n"
                f"Субектът е `subjects[{i}]`: {subject['name']}."),
            "criteria": list(scale.anchors),
        }
    return questions


# ─── reading the answers ─────────────────────────────────────────────────────

def read_axes(answers: dict) -> tuple:
    """`(axes, problems)` — one decoded block per article axis."""
    axes, problems = {}, []
    for axis in ax.ARTICLE_AXES:
        block = {"applies": None, "score": None}
        applies = (answers or {}).get(axis["applies_id"])
        if applies is not None:
            try:
                block["applies"] = js.read_noul(applies)
            except js.JevScaleError as exc:
                problems.append(f"{axis['applies_id']}: {exc}")
        score = (answers or {}).get(axis["id"])
        if score is None:
            # ⚠️ REPORTED EVEN WHEN THE GATE ANSWERED. An absent score beside a
            # valid applicability is a half-answered axis, and skipping it in
            # silence stores a block whose `score` is None for a reason nobody
            # recorded — indistinguishable from one the contract refused.
            problems.append(f"{axis['id']}: no score")
        else:
            try:
                block["score"] = js.decode_score(score, axis["scale"],
                                                 axes_version=ax.AXES_VERSION)
            except js.JevScaleError as exc:
                problems.append(f"{axis['id']}: {exc}")
        if block["applies"] is None:
            problems.append(f"{axis['applies_id']}: no answer")
        if block["applies"] is None and block["score"] is None:
            continue
        axes[axis["id"]] = block
    return axes, problems


def read_primary(answers: dict, subjects: list):
    """Which subject index the article is about, or None.

    ⚠️ AN UNREADABLE CHOICE IS None, NOT ZERO. Defaulting to the first subject
    would make the most-mentioned one `primary` on every article whose choice
    failed — a judgement nobody made, applied systematically.
    """
    answer = (answers or {}).get("primary_subject")
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        return None
    choice = answer.get("choice")
    if choice == PRIMARY_NONE or not isinstance(choice, str):
        return None
    try:
        index = int(choice)
    except ValueError:
        return None
    return index if 0 <= index < len(subjects) else None


def read_subjects(answers: dict, subjects: list, *, scale=None) -> tuple:
    """`(rows, problems)` — one row per subject, with its role and its tone."""
    scale = scale or ax.SUBJECT_TONE
    primary = read_primary(answers, subjects)
    rows, problems = [], []
    for i, subject in enumerate(subjects):
        role = sm.derive_role(subject, is_primary=(primary == i))
        row = {
            "name": subject["name"],
            "kind": subject["kind"],
            "mentions": subject["mentions"],
            "in_title": subject["in_title"],
            "subject_role": role,
            "assessment_status": "not_assessed",
            "tone": None,
        }
        if role == "incidental":
            # Refusal 2: named in passing, shown without a forced sentiment.
            rows.append(row)
            continue
        answer = (answers or {}).get(f"tone_{i}")
        if answer is None:
            problems.append(f"tone_{i}: no answer")
            rows.append(row)
            continue
        try:
            row["tone"] = js.decode_score(answer, scale, axes_version=ax.AXES_VERSION)
            row["assessment_status"] = "assessed"
        except js.JevScaleError as exc:
            problems.append(f"tone_{i}: {exc}")
        rows.append(row)
    return rows, problems


# ─── one article ─────────────────────────────────────────────────────────────

def call_outcome(outcome) -> dict:
    """A call's result as a stored fact, whether or not it answered."""
    if outcome:
        return {"status": "ok", "reason": None, "ms": outcome.ms,
                "model": outcome.model,
                "cost": (outcome.usage or {}).get("cost"),
                "input_tokens": (outcome.usage or {}).get("input_tokens")}
    return {"status": "failed", "reason": outcome.skip, "ms": outcome.ms,
            "model": None, "cost": None, "input_tokens": None,
            "report_worthy": outcome.report_worthy}


def assess_article(article: dict, analysis: dict, *, ask=None, model=None,
                   dry_run: bool = False, scale=None) -> dict:
    """One article's sentiment record.

    ⚠️ NEVER RAISES ON A *CALL* FAILURE — a failed, timed-out or unreadable
    answer becomes a recorded reason, never a neutral. It CAN raise on a state
    it cannot build (`JevSentimentError`, e.g. subjects that leave no room for
    a body); `run`'s per-article guard is what turns that into one failed
    article rather than a lost batch. A reader scanning the first line used to
    take away "safe in a pool", which is the half that is not true.

    `ask` is injected so every test here runs without a network.
    """
    # ⚠️ THE GATE IS HERE, NOT ONLY IN `main`. A library caller — a test
    # harness, the eval runner, a future pipeline step — would otherwise ask
    # regardless of the mode, which is the one thing `off` exists to prevent.
    if ask is None and mode() == "off":
        dry_run = True
    ask = ask or jc.ask
    subjects, total = sm.subjects_for(analysis, article)
    dropped = max(0, total - len(subjects))
    if not subjects:
        # The axes alone are still worth asking, but an article naming nobody
        # is 28.5% of the corpus and carries no subject question at all.
        state, truncated = sm.state_for(article, [])
    else:
        state, truncated = sm.state_for(article, subjects)

    record = {
        **sm.empty_record(article, status="ok", subjects_total=total,
                          subjects_dropped=dropped),
        "sentiment_key": sm.sentiment_key(article, subjects),
        "state_chars": len(json.dumps(state, ensure_ascii=False)),
        "truncated": truncated,
        "text_scope": sm.text_scope_for(article, truncated=truncated),
    }
    if dry_run:
        return {**record, "status": "would_generate"}

    problems, calls = [], {}

    outcome_a = ask(state, axis_questions(), model=model)
    calls["axes"] = call_outcome(outcome_a)
    if outcome_a:
        axes, axis_problems = read_axes(outcome_a.answers)
        record["axes"] = axes
        problems += axis_problems
    else:
        problems.append(f"axes: {outcome_a.skip}")

    if subjects:
        outcome_b = ask(state, subject_questions(subjects, scale=scale), model=model)
        calls["subjects"] = call_outcome(outcome_b)
        if outcome_b:
            rows, subject_problems = read_subjects(outcome_b.answers, subjects,
                                                   scale=scale)
            record["subjects"] = rows
            problems += subject_problems
        else:
            problems.append(f"subjects: {outcome_b.skip}")

    record["calls"] = calls
    record["problems"] = problems
    # ⚠️ EVERY call's resolved model, not the first. The id is PINNED but the
    # endpoint echoes what answered, and two calls disagreeing is exactly the
    # fact a benchmark needs to see rather than one that gets overwritten.
    models = sorted({c["model"] for c in calls.values() if c.get("model")})
    record["model"] = models[0] if len(models) == 1 else (models or None)
    answered = bool(record["axes"]) or bool(record["subjects"])
    if not answered:
        record["status"] = "failed"
        record["reason"] = "; ".join(problems)[:300] or "no answers"
    elif not subjects:
        # ⚠️ A PROPERTY OF THE CORPUS, NOT OF THE CALL: the axes answered and
        # there was nobody to score. 28.5% of articles name no subject at all,
        # so a facet built on this status must find them.
        record["status"] = "no_subjects"
    return record


def our_bug(record: dict) -> bool:
    """Did any call fail because OUR payload was refused?

    ⚠️ THE ONE FAILURE CLASS THAT MUST NOT BE RETRIED OR IGNORED. `jev_client`
    separates it from an outage for exactly this reason; swallowing it pays for
    a fallback on every article while the bug stays invisible.
    """
    return any(call.get("report_worthy") for call in (record.get("calls") or {}).values())


# ─── the run ─────────────────────────────────────────────────────────────────

def run(pairs: list, data_dir, *, ask=None, model=None, dry_run: bool = False,
        concurrency: int = DEFAULT_CONCURRENCY, force: bool = False) -> dict:
    """Assess many articles. `pairs` is `(article, analysis)`.

    ⚠️ ONE BAD ARTICLE MUST NOT TAKE THE RUN DOWN. Every call already in
    flight has been PAID FOR, and an exception escaping the pool discards the
    whole batch's statistics along with them — measured at 9 articles, 18
    billed calls, nothing recorded. `analyze_local.worker_result` carries a
    dated incident comment for this exact shape. The guard is per article and
    the crash is reported, never swallowed silently.
    """
    stats = empty_stats()

    def one(pair):
        article, analysis = pair
        try:
            # ⚠️ A SECOND `current_for`, after `load_pairs` already filtered —
            # deliberately. It is the race guard for two passes overlapping
            # (an hourly stage and a manual run), and it costs a file read.
            # Neither check may be "optimised" away on the other's account.
            if not force:
                current = sm.current_for(article, analysis, data_dir)
                if current:
                    return ("cached", current, None)
            record = assess_article(article, analysis, ask=ask, model=model,
                                    dry_run=dry_run)
            if not dry_run:
                sm.store(record, data_dir)
            return ("assessed", record, None)
        except Exception as exc:  # noqa: BLE001 — see the docstring
            return ("crashed", {"url": (article or {}).get("url")},
                    f"{type(exc).__name__}: {str(exc)[:200]}")

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        for kind, record, error in pool.map(one, pairs):
            if kind == "cached":
                stats["cached"] += 1
                continue
            if kind == "crashed":
                stats["crashed"] += 1
                stats["crashes"].append({"url": record.get("url"), "error": error})
                continue
            stats["assessed"] += 1
            if record.get("status") == "failed":
                stats["failed"] += 1
            if our_bug(record):
                stats["our_bugs"].append(record.get("url"))
            for call in (record.get("calls") or {}).values():
                if isinstance(call.get("cost"), (int, float)):
                    stats["cost"] += call["cost"]
    return stats


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--model", default=None)
    parser.add_argument("--data-dir", default=str(ROOT / "news/data"))
    parser.add_argument("--dry-run", action="store_true",
                        help="build every state and store nothing")
    parser.add_argument("--force", action="store_true",
                        help="re-ask even when a current record exists")
    parser.add_argument(
        "--stage", action="store_true",
        help="run as a nightly pipeline stage: print exactly one compact JSON "
             "line and ALWAYS exit 0 — a payload bug, an all-failed run, an "
             "invalid mode or a crash is named in the line's `alert` instead, "
             "because a non-zero stage withholds the whole public release")
    args = parser.parse_args(argv)
    try:
        return _main(args)
    except Exception as exc:  # noqa: BLE001 — see below
        # ⚠️ ONLY `run()`'s per-article work was guarded, so an exception in
        # selection — a list-shaped article file, a malformed analysis in
        # `current_for`, a full disk — escaped as exit 1 and withheld every
        # story, summary and image on the strength of one sidecar input. Under
        # `--stage` it is named, not raised. A manual run still raises.
        if not args.stage:
            raise
        print(json.dumps({**empty_stats(), "mode": mode(),
                          "dry_run": args.dry_run, "alert": "crash",
                          "error": f"{type(exc).__name__}: {str(exc)[:200]}"},
                         ensure_ascii=False))
        return 0


def _main(args) -> int:

    def emit(payload: dict) -> None:
        # ⚠️ ONE LINE, LAST. `run_nightly.sh`'s `stage()` parses only the
        # final line of combined output as the stage result; an indented dump
        # ends in a bare `}`, which it records as unparsed and fails the stage.
        if args.stage:
            print(json.dumps(payload, ensure_ascii=False))
        else:
            print(json.dumps(payload, ensure_ascii=False, indent=2))

    # ⚠️ EVERY BRANCH CARRIES THE SAME KEYS, so a reader of the stage result
    # never has to know which branch ran to find a count. `dry_run` is named
    # because a dry run counts its would-be records as `assessed`, and „assessed
    # 3" must not read as three paid answers.
    base = {**empty_stats(), "mode": mode(), "dry_run": args.dry_run}
    if base["mode"] == "invalid":
        emit({**base, "skipped": "invalid_mode", "alert": "invalid_mode",
              "value": os.environ.get(MODE_ENV)})
        return 0 if args.stage else 2
    if base["mode"] == "off":
        emit({**base, "skipped": "off"})
        return 0

    pairs = load_pairs(Path(args.data_dir), args.limit, force=args.force)
    if not pairs:
        emit({**base, "skipped": "nothing_to_assess"})
        return 0
    stats = {**base, **run(pairs, Path(args.data_dir), model=args.model,
                           dry_run=args.dry_run, concurrency=args.concurrency,
                           force=args.force)}
    stats["cost"] = round(stats["cost"], 6)
    alert = alert_for(stats)
    if alert:
        # Named in the payload so the run report carries it whether or not the
        # exit code does.
        stats["alert"] = alert
    emit(stats)
    # ⚠️ NON-ZERO ON OUR BUG, never on an outage: the first is a payload we
    # built wrong and must be fixed, the second is weather.
    #
    # ⚠️⚠️ EXCEPT AS A PIPELINE STAGE. Any non-zero stage sets
    # `pipeline_failed`, and `upload_to_gcs.py` then withholds the WHOLE
    # public news release. This pass is ADDITIVE — the store keeps every
    # record it already holds and a missing score is a narrower page, never a
    # wrong one — so letting it block publication would hold every story,
    # summary and image hostage to one sentiment payload. The bug is not
    # swallowed: it rides in the stage result as `alert: our_bug` with the
    # URLs, and the report lifts it to its top level. A manual run keeps the
    # loud exit.
    if args.stage:
        return 0
    return 1 if stats["our_bugs"] else 0


def load_pairs(data_dir: Path, limit: int, *, force: bool = False) -> list:
    """`(article, analysis)` for the NEWEST analysed articles still to do.

    ⚠️ ORDERED BY THE DATE IN THE FILENAME, NOT BY PATH. The glob is
    `analysis/articles/<domain>/<YYYYMMDD>-slug.json`, so a plain reverse sort
    orders by DOMAIN first: measured on 9,018 files across 53 domains, the
    first 25 were all `vesti.bg` and three weeks old, while the newest day in
    the corpus was never reached at any sane limit.

    ⚠️ AND THE LIMIT COUNTS WORK, NOT FILES. Applied before the cache check, a
    second run finds the same 25 already stored, reports `cached: 25,
    assessed: 0`, and can never advance — the pass becomes a no-op from run 2.
    """
    files = sorted(Path(data_dir).glob("analysis/articles/*/*.json"),
                   key=lambda p: (p.name, p.parent.name), reverse=True)
    pairs = []
    for path in files:
        try:
            analysis = json.loads(path.read_text(encoding="utf-8"))
            article = json.loads((ROOT / analysis["article_path"]).read_text(
                encoding="utf-8"))
        except (OSError, ValueError, KeyError, TypeError):
            # TypeError too: a malformed analysis whose `article_path` is not a
            # string crashes `Path.__truediv__`, and one bad file must not take
            # the CLI down before it has assessed anything.
            continue
        # ⚠️ VALID JSON IS NOT AN OBJECT. A list-shaped article raised
        # AttributeError on `.get` — outside every guard — and as a pipeline
        # stage that exit withheld the whole public release.
        if not isinstance(article, dict) or not isinstance(analysis, dict):
            continue
        if not article.get("content"):
            continue
        try:
            if not force and sm.current_for(article, analysis, data_dir):
                continue
        except Exception:  # noqa: BLE001 — the same rule as `run()`'s guard
            continue
        pairs.append((article, analysis))
        if len(pairs) >= limit:
            break
    return pairs


if __name__ == "__main__":
    raise SystemExit(main())
