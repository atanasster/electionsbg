#!/usr/bin/env python3
"""Phase 3.3/3.4/3.5 — is Jev accurate enough, fast enough and cheap enough?

    python3 news/scripts/eval_jev_benchmark.py --limit 12          # pilot
    python3 news/scripts/eval_jev_benchmark.py                     # all 240
    python3 news/scripts/eval_jev_benchmark.py --concurrency 8     # 3.4

Scores `jev_client` against `news/data/gold/gold_set.json` — 240 articles
whose reference labels in `news/data/gold/reference/` were adjudicated by a
DIFFERENT model family, so this is not a model grading itself.

Four configurations (plan §3.3), because "is Jev accurate" has no answer
until you say at what:

  gate        the Stage-A gate — site_relevant (noul) + quality (choice).
              The cheapest thing that could pay for itself: it decides
              whether GLM is called at all.
  flat        one choice over all 103 category:subcategory pairs at once.
  hierarchy   two calls — category (26), then subcategory within it.
  multilabel  the primary topic plus everything above a probability
              threshold, scored against the reference's topic SET.

⚠️ SCORED ON THE PRIMARY TOPIC, NOT "A TOPIC". The reference marks exactly
one `primary: True` per article and the pipeline routes on it, so credit for
"the right category appeared somewhere in the answer" would measure
something no consumer uses.

⚠️ AND ACCURACY IS REPORTED BESIDE THE BASELINE RATE. 194 of 240 gold
articles are `quality: ok` and 100 of 240 are `site_relevant: false`, so a
constant answer scores 81% on the first and 58% on the second. A number
without its baseline reads as competence when it may be the majority class —
the report prints both and the lift between them.

Cost: one call per article per configuration (two for `hierarchy`), ~$0.001
each on a full-length article. The full 240 is ~$1.
"""

import argparse
import collections
import concurrent.futures as cf
import json
import os
import random
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import jev_client as jc  # noqa: E402

REPO_ROOT = Path(os.environ.get("DATA_BG_ROOT") or SCRIPT_DIR.parents[1])
NEWS = REPO_ROOT / "news"
GOLD = NEWS / "data" / "gold" / "gold_set.json"
REFERENCE = NEWS / "data" / "gold" / "reference"
TAXONOMY = NEWS / "prompts" / "taxonomy_compact.json"

# The gate's own vocabulary, from the reference distribution.
QUALITY_VERDICTS = {
    "ok": "пълна, четима журналистическа статия",
    "too_short": "твърде кратък текст, само заглавие или анонс",
    "non_article": "не е статия - рубрика, индекс, галерия или реклама",
    "paywall_shell": "платен достъп - видим е само откъс",
    "client_render_shell": "празна обвивка, текстът се зарежда с JavaScript",
}

# ⚠️ Leave room for the questions inside LIMITS["state_chars"]: the flat
# configuration's criteria alone are ~6 KB, and build_payload bounds the
# STATE separately from the total. A state at the cap plus that criteria set
# would be refused as our own invalid payload and score as a miss.
STATE_CHARS = 18000


def load_taxonomy():
    doc = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    return doc["categories"]


def load_gold(limit=None, seed="naiasno-jev-bench"):
    """The gold articles, each paired with its reference labels.

    An article whose stored text or reference record is missing is SKIPPED
    and counted, never scored as a miss: this measures Jev, and a corpus gap
    is not Jev's fault.

    ⚠️ A PARTIAL RUN SAMPLES, IT DOES NOT TAKE THE HEAD. The gold set is
    ordered by the cell each article was drawn for, so `--limit 8` read the
    first eight `quality_short` records — one of them 50 characters long —
    and only ONE of the eight carried a topic at all, which made every topic
    configuration an n=1 measurement that still printed a confident 1.000.
    The order is a deterministic shuffle so a pilot is representative and
    two runs of the same limit are comparable.
    """
    doc = json.loads(GOLD.read_text(encoding="utf-8"))
    articles = list(doc["articles"])
    if limit:
        random.Random(seed).shuffle(articles)
    rows, missing = [], collections.Counter()
    for art in articles:
        path = REPO_ROOT / art["path"]
        ref = REFERENCE / art["domain"] / (Path(art["path"]).name)
        if not path.is_file():
            missing["article_text"] += 1
            continue
        if not ref.is_file():
            missing["reference_labels"] += 1
            continue
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
            labels = json.loads(ref.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            missing["unreadable"] += 1
            continue
        text = (stored.get("content") or "").strip()
        if not text:
            missing["empty_text"] += 1
            continue
        rows.append({
            "url": art["url"], "domain": art["domain"],
            "title": stored.get("title") or "",
            "state": f"{stored.get('title') or ''}\n\n{text}"[:STATE_CHARS],
            "labels": labels,
        })
        if limit and len(rows) >= limit:
            break
    return rows, missing


# ---- the reference answer for each configuration ---------------------------

def ref_site_relevant(labels):
    return bool(labels.get("site_relevant"))


def ref_quality(labels):
    q = labels.get("quality")
    return (q or {}).get("verdict") if isinstance(q, dict) else None


def ref_primary_topic(labels):
    """(category, subcategory) of the topic marked primary, or (None, None)."""
    for t in labels.get("topics") or []:
        if t.get("primary"):
            return t.get("category"), t.get("subcategory")
    topics = labels.get("topics") or []
    if topics:
        # ⚠️ Measured over the whole gold set: 194 articles carry exactly one
        # primary, 46 carry no topics, and ZERO carry topics without a
        # primary — so this branch is unreachable today. It stays as a guard
        # against a future reference format, and it WARNS rather than
        # silently grading against a different definition of "the topic".
        print(f"  ⚠️ no primary topic marked; scoring against the first of "
              f"{len(topics)}", file=sys.stderr)
        return topics[0].get("category"), topics[0].get("subcategory")
    return None, None


def ref_topic_set(labels):
    return {t.get("category") for t in (labels.get("topics") or [])
            if t.get("category")}


# ---- the four configurations ----------------------------------------------

def questions_gate(_cats):
    return {
        "site_relevant": {
            "type": "noul",
            "instructions": "Отнася ли се текстът до българския обществен "
                            "живот - политика, институции, обществени "
                            "средства, регулации или обществено значими "
                            "събития в страната?",
            "criteria": {"true": "да, има обществено значение за България",
                         "false": "не - спорт, шоубизнес, криминале без "
                                  "институционален елемент, лайфстайл, "
                                  "хороскоп, рецепта или чуждо събитие без "
                                  "връзка с България"},
        },
        "quality": {
            "type": "choice",
            "instructions": "Какъв е видът на този текст като публикация?",
            "criteria": dict(QUALITY_VERDICTS),
        },
    }


def flat_criteria(cats):
    out = {}
    for c in cats:
        for sub in c["subcategories"]:
            out[f"{c['id']}:{sub}"] = f"{c['label']} - {sub}"
    return out


def questions_flat(cats):
    return {"topic": {"type": "choice",
                      "instructions": "Коя е основната тема на текста?",
                      "criteria": flat_criteria(cats)}}


def questions_category(cats):
    return {"category": {"type": "choice",
                         "instructions": "Коя е основната тема на текста?",
                         "criteria": {c["id"]: c["label"] for c in cats}}}


def questions_subcategory(cats, category_id):
    cat = next((c for c in cats if c["id"] == category_id), None)
    if not cat or not cat["subcategories"]:
        return None
    return {"subcategory": {
        "type": "choice",
        "instructions": f"В рамките на темата „{cat['label']}“, кой е "
                        f"по-точният подраздел?",
        "criteria": {s: s for s in cat["subcategories"]}}}


CONFIGS = ("gate", "flat", "hierarchy", "multilabel")


def run_one(row, config, cats, threshold):
    """One article through one configuration. Returns a scored record."""
    started = time.monotonic()
    calls, cost, tokens = 0, 0.0, 0
    result = {"url": row["url"], "config": config}

    def account(outcome):
        nonlocal calls, cost, tokens
        calls += 1
        usage = outcome.usage or {}
        cost += usage.get("cost") or 0
        tokens += usage.get("input_tokens") or 0

    if config == "gate":
        out = jc.ask(row["state"], questions_gate(cats))
        account(out)
        if not out:
            result["skip"] = out.skip
        else:
            a = out.answers
            noul = a.get("site_relevant", {}).get("noul")
            result["site_relevant"] = (None if noul is None else noul >= 0.5)
            result["site_relevant_ref"] = ref_site_relevant(row["labels"])
            result["quality"] = a.get("quality", {}).get("choice")
            result["quality_ref"] = ref_quality(row["labels"])
            result["confidence"] = jc.confidence_of(a.get("quality") or {})

    elif config == "flat":
        out = jc.ask(row["state"], questions_flat(cats))
        account(out)
        if not out:
            result["skip"] = out.skip
        else:
            choice = (out.answers.get("topic") or {}).get("choice") or ""
            cat, _, sub = choice.partition(":")
            ref_cat, ref_sub = ref_primary_topic(row["labels"])
            result.update({"category": cat, "subcategory": sub,
                           "category_ref": ref_cat, "subcategory_ref": ref_sub,
                           "confidence": jc.confidence_of(
                               out.answers.get("topic") or {})})

    elif config == "hierarchy":
        out = jc.ask(row["state"], questions_category(cats))
        account(out)
        if not out:
            result["skip"] = out.skip
        else:
            cat = (out.answers.get("category") or {}).get("choice")
            ref_cat, ref_sub = ref_primary_topic(row["labels"])
            result.update({"category": cat, "category_ref": ref_cat,
                           "subcategory_ref": ref_sub,
                           "confidence": jc.confidence_of(
                               out.answers.get("category") or {})})
            sub_q = questions_subcategory(cats, cat) if cat else None
            if sub_q:
                out2 = jc.ask(row["state"], sub_q)
                account(out2)
                if out2:
                    result["subcategory"] = (
                        out2.answers.get("subcategory") or {}).get("choice")
                else:
                    result["skip_subcategory"] = out2.skip

    elif config == "multilabel":
        out = jc.ask(row["state"], questions_category(cats))
        account(out)
        if not out:
            result["skip"] = out.skip
        else:
            answer = out.answers.get("category") or {}
            probs = answer.get("probabilities") or {}
            chosen = {k for k, v in probs.items()
                      if isinstance(v, (int, float)) and v >= threshold}
            primary = answer.get("choice")
            if primary:
                chosen.add(primary)
            result.update({
                "labels": sorted(chosen),
                "labels_ref": sorted(ref_topic_set(row["labels"])),
                "primary": primary,
                "category_ref": ref_primary_topic(row["labels"])[0],
                "confidence": jc.confidence_of(answer),
            })

    result.update({"ms": int((time.monotonic() - started) * 1000),
                   "calls": calls, "cost": cost, "input_tokens": tokens})
    return result


# ---- scoring ---------------------------------------------------------------

def score(records, config):
    """Accuracy BESIDE the majority-class baseline, because the gold set is
    unbalanced enough that a constant answer looks competent."""
    answered = [r for r in records if not r.get("skip")]
    out = {"n": len(records), "answered": len(answered),
           "skipped": collections.Counter(
               r["skip"] for r in records if r.get("skip"))}
    # ⚠️ BEFORE the early return: a configuration in which every call failed
    # still SPENT money (a 400 is refused for free, a 500 is not), and
    # reporting $0 for it would hide the cost of a broken run entirely.
    out["cost"] = {
        "total": sum(r["cost"] for r in records),
        "per_article": sum(r["cost"] for r in records) / max(1, len(records)),
        "calls": sum(r["calls"] for r in records),
        "input_tokens": sum(r["input_tokens"] for r in records),
    }
    if not answered:
        return out

    def rate(pairs):
        pairs = [(g, p) for g, p in pairs if g is not None]
        if not pairs:
            return None, None, 0
        hits = sum(1 for g, p in pairs if g == p)
        majority = collections.Counter(g for g, _ in pairs).most_common(1)[0][1]
        return hits / len(pairs), majority / len(pairs), len(pairs)

    if config == "gate":
        for field in ("site_relevant", "quality"):
            acc, base, n = rate([(r.get(f"{field}_ref"), r.get(field))
                                 for r in answered])
            out[field] = {"accuracy": acc, "baseline": base, "n": n,
                          "lift": (acc - base) if acc is not None else None}
    elif config in ("flat", "hierarchy"):
        acc, base, n = rate([(r.get("category_ref"), r.get("category"))
                             for r in answered])
        out["category"] = {"accuracy": acc, "baseline": base, "n": n,
                           "lift": (acc - base) if acc is not None else None}
        pairs = [((r.get("category_ref"), r.get("subcategory_ref")),
                  (r.get("category"), r.get("subcategory")))
                 for r in answered if r.get("subcategory_ref")]
        if pairs:
            hits = sum(1 for g, p in pairs if g == p)
            out["category_subcategory"] = {"accuracy": hits / len(pairs),
                                           "n": len(pairs)}
    elif config == "multilabel":
        # ⚠️ SCORED ONLY OVER ARTICLES THAT HAVE A REFERENCE TOPIC. The
        # predicted set can never be empty (the primary choice is always
        # added), so the 36 articles the reference gives NO topic are
        # guaranteed `set_exact` misses and trivially `set_covers_reference`
        # hits — the same rows inflating one metric by 6.6pt and deflating
        # the other by 5.8pt, in opposite directions, for the same reason.
        topical = [r for r in answered if r.get("labels_ref")]
        out["n_with_reference_topic"] = len(topical)
        out["n_without_reference_topic"] = len(answered) - len(topical)
        answered_ml = topical or answered
        exact = sum(1 for r in answered_ml
                    if set(r.get("labels") or []) == set(r.get("labels_ref") or []))
        covered = sum(1 for r in answered_ml
                      if set(r.get("labels_ref") or []) <= set(r.get("labels") or []))
        sizes = [len(r.get("labels") or []) for r in answered_ml]
        acc, base, n = rate([(r.get("category_ref"), r.get("primary"))
                             for r in answered])
        out["primary"] = {"accuracy": acc, "baseline": base, "n": n,
                          "lift": (acc - base) if acc is not None else None}
        out["set_exact"] = exact / len(answered_ml)
        out["set_covers_reference"] = covered / len(answered_ml)
        out["mean_labels_predicted"] = statistics.mean(sizes) if sizes else 0
        out["mean_labels_reference"] = statistics.mean(
            len(r.get("labels_ref") or []) for r in answered_ml)

    # ⚠️ THE MEASUREMENT THAT DECIDES WHETHER THIS IS USABLE, and the
    # headline accuracy hides it. Jev is meant to be an accelerator in a
    # lane, not a replacement classifier: what matters is whether it knows
    # when it is right, so the confident share can skip GLM and the rest
    # falls through. A flat 73.7% reads as "not good enough"; the same run
    # answers 33% of articles at 98.4% and, on the quality verdict, 69% at
    # 99.4%. Reported as a curve because the threshold is a product
    # decision, not a fact about the model.
    # (prediction field, reference field) — they are NOT always the same
    # name: `multilabel` predicts `primary` and is scored against
    # `category_ref`. Keying both off one name looked for `primary_ref`,
    # which no record carries, so that config silently produced NO curve at
    # all while every other config printed one.
    field, ref_field = {
        "gate": ("quality", "quality_ref"),
        "flat": ("category", "category_ref"),
        "hierarchy": ("category", "category_ref"),
        "multilabel": ("primary", "category_ref"),
    }[config]
    graded = [(r["confidence"], r.get(field) == r.get(ref_field),
               r.get(ref_field))
              for r in answered
              if r.get(ref_field) and r.get("confidence") is not None]
    graded.sort(key=lambda t: t[0], reverse=True)
    if graded:
        curve = []
        for thr in (0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.0):
            kept = [(ok, ref) for c, ok, ref in graded if c >= thr]
            if not kept:
                continue
            # ⚠️ THE BASELINE IS RE-COMPUTED INSIDE THE BUCKET, and leaving
            # it out is the exact error this file's header forbids. The
            # high-confidence bucket is not a random sample: it is the EASY
            # articles, so the majority class is stronger there too.
            # Measured on `quality`, ≥0.95 scores 99.4% against an in-bucket
            # constant of 92.5% — a +6.9pt lift, not the +15.7 the corpus
            # baseline would imply. Without this column the curve argues for
            # paying for answers a constant gives away.
            in_bucket = collections.Counter(ref for _ok, ref in kept)
            base = in_bucket.most_common(1)[0][1] / len(kept)
            acc = sum(1 for ok, _ref in kept if ok) / len(kept)
            curve.append({"threshold": thr, "coverage": len(kept) / len(graded),
                          "accuracy": acc, "baseline": base,
                          "lift": acc - base, "n": len(kept)})
        out["calibration"] = {"field": field, "reference_field": ref_field,
                              "n": len(graded), "curve": curve}

    lat = sorted(r["ms"] for r in answered)
    out["latency_ms"] = {
        "p50": lat[len(lat) // 2],
        "p95": lat[min(len(lat) - 1, int(len(lat) * 0.95))],
        "p99": lat[min(len(lat) - 1, int(len(lat) * 0.99))],
        "max": lat[-1],
    }
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0,
                    help="articles to score (0 = all)")
    ap.add_argument("--configs", default=",".join(CONFIGS))
    ap.add_argument("--concurrency", type=int, default=1,
                    help="plan 3.4: 1 for the serial case, 4-8 for the pool")
    ap.add_argument("--threshold", type=float, default=0.15,
                    help="multilabel: probability above which a label counts")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    configs = [c.strip() for c in args.configs.split(",") if c.strip()]
    unknown = set(configs) - set(CONFIGS)
    if unknown:
        ap.error(f"unknown config(s): {sorted(unknown)}")

    cats = load_taxonomy()
    rows, missing = load_gold(args.limit or None)
    print(f"gold articles: {len(rows)}"
          + (f"   skipped: {dict(missing)}" if missing else ""))
    print(f"taxonomy: {len(cats)} categories, "
          f"{sum(len(c['subcategories']) for c in cats)} subcategories")
    print(f"configs: {configs}   concurrency: {args.concurrency}\n")

    report = {"generated_at": datetime.now(timezone.utc).isoformat(),
              "model": jc.MODEL, "endpoint": jc.ENDPOINT,
              "articles": len(rows), "skipped_articles": dict(missing),
              "concurrency": args.concurrency, "threshold": args.threshold,
              "state_chars": STATE_CHARS, "configs": {}}

    for config in configs:
        jc.reset_breaker()
        started = time.monotonic()
        if args.concurrency > 1:
            with cf.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                records = list(pool.map(
                    lambda r: run_one(r, config, cats, args.threshold), rows))
        else:
            records = [run_one(r, config, cats, args.threshold) for r in rows]
        wall = time.monotonic() - started
        scored = score(records, config)
        scored["wall_seconds"] = round(wall, 1)
        scored["articles_per_second"] = round(len(rows) / wall, 2) if wall else None
        report["configs"][config] = {"summary": scored, "records": records}

        print(f"=== {config} ===")
        print(f"  {scored['answered']}/{scored['n']} answered"
              + (f"   skips: {dict(scored['skipped'])}"
                 if scored["skipped"] else ""))
        for field in ("site_relevant", "quality", "category", "primary"):
            m = scored.get(field)
            if m and m.get("accuracy") is not None:
                print(f"  {field:12} accuracy {m['accuracy']:.3f}   "
                      f"baseline {m['baseline']:.3f}   "
                      f"lift {m['lift']:+.3f}   (n={m['n']})")
        if "category_subcategory" in scored:
            m = scored["category_subcategory"]
            print(f"  {'cat+sub':12} accuracy {m['accuracy']:.3f}   (n={m['n']})")
        if "set_exact" in scored:
            print(f"  set exact {scored['set_exact']:.3f}   "
                  f"covers reference {scored['set_covers_reference']:.3f}   "
                  f"labels {scored['mean_labels_predicted']:.2f} vs "
                  f"{scored['mean_labels_reference']:.2f} reference")
        cal = scored.get("calibration")
        if cal:
            best = [p for p in cal["curve"] if p["threshold"] >= 0.9]
            for point in best:
                print(f"  conf>={point['threshold']:.2f} on {cal['field']}: "
                      f"covers {point['coverage']:.1%} at "
                      f"{point['accuracy']:.1%} accuracy vs "
                      f"{point['baseline']:.1%} in-bucket baseline "
                      f"(lift {point['lift']:+.1%}, n={point['n']})")
        lat = scored.get("latency_ms") or {}
        cost = scored.get("cost") or {}
        print(f"  latency p50 {lat.get('p50')}ms  p95 {lat.get('p95')}ms  "
              f"p99 {lat.get('p99')}ms  max {lat.get('max')}ms")
        print(f"  cost ${cost.get('total', 0):.5f} over {cost.get('calls')} "
              f"calls = ${cost.get('per_article', 0):.6f}/article   "
              f"wall {scored['wall_seconds']}s\n")

    out_path = Path(args.out) if args.out else (
        NEWS / "data" / "_perf" / "jev" /
        f"benchmark-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    total = sum(c["summary"].get("cost", {}).get("total", 0)
                for c in report["configs"].values())
    print(f"total spend: ${total:.5f}")
    print(f"report -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
