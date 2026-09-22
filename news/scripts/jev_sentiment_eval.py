#!/usr/bin/env python3
"""T4.4 Phase 0 — measure the Jev sentiment pass against the GLM corpus.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` Phase 0. Reads the stored
sidecars and the 8,925 GLM analyses and answers the nine questions the plan
lists. Publishes nothing: this is the phase whose whole output is a dated eval
in `news/evals/`.

⚠️⚠️ AGREEMENT IS NOT ACCURACY, AND THIS FILE CANNOT ESTABLISH ACCURACY.
Where Jev and GLM differ, one of them is wrong and nothing here says which.
Every figure below is a comparison between two models, and the report says so
in those words rather than in a footnote. The only thing that converts "they
differ" into "which is right" is the 50-row blinded worksheet this emits for
`adjudicate_editorial_treatment.py` — the plan's own recommendation, and a
gate on Phase 5 rather than on Phases 1-4.

⚠️ THE IN-BUCKET BASELINE IS RECOMPUTED FOR EVERY CONFIDENCE BUCKET. A
high-confidence bucket is not a random sample — it is the easy articles, so
the majority class is stronger there too. `jev-benchmark-2026-09-20.md`
published the accuracy column alone once and it made the quality gate look
four times better than it is; that report's own rule is the one applied here.

⚠️⚠️ THE STRATUM IS ABOUT WHAT **GLM** READ, NOT WHAT JEV READ, AND GETTING
THAT BACKWARDS INVERTS THE WHOLE MEASUREMENT. The comparison is only
like-for-like when both models saw the same article; where GLM read a 6,000-
character prefix and Jev read the whole text, a disagreement is evidence FOR
Jev rather than against it. Splitting on Jev's own 24,000-character flag puts
**831 GLM-truncated articles (9.12% of 9,108)** into the headline `full`
stratum — measured — while isolating the ~57 that only Jev cut. That is
exactly the pollution this paragraph exists to forbid, in the direction the
pass exists to fix.

The signal is `analysis_provenance.body_truncated` on the GLM record. 371
records carry no provenance at all; they are their OWN stratum (`glm_unknown`)
rather than being assumed complete.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

import jev_axes as ax  # noqa: E402
import jev_scales as js  # noqa: E402
import jev_sentiment as sm  # noqa: E402

# The two articles the plan names as regression cases (§4.2): a hostile piece
# whose target is a PERSON and whose party appears once inside a commenter's
# quote, and one where the only favourable evidence was the party's own MEP
# being quoted. Both must land near zero for their party.
REGRESSION_ARTICLES = (
    {"slug": "09d05e6c", "domain": "pik.bg", "party": "ПП-ДБ",
     "why": "hostility targets Гюров; ПП-ДБ appears once, inside a Facebook comment"},
    {"slug": "d5aca28c", "domain": "actualno.com", "party": "ПП-ДБ",
     "why": "the only favourable evidence was the party's own MEP, quoted"},
)

CONFIDENCE_BUCKETS = (0.95, 0.90, 0.0)

# What GLM saw, which is what decides whether a disagreement is comparable.
STRATA = ("glm_full", "glm_prefix", "glm_unknown")


def glm_stratum(analysis: dict) -> str:
    """Which stratum this article's GLM record belongs to.

    ⚠️ `unrecorded` IS NOT `full`. 371 records carry no `analysis_provenance`,
    so nobody wrote down what their analyst read; calling them complete is a
    claim, and the headline figure is the one place it would land.
    """
    prov = (analysis or {}).get("analysis_provenance")
    if not isinstance(prov, dict) or not isinstance(prov.get("body_truncated"), bool):
        return "glm_unknown"
    return "glm_prefix" if prov["body_truncated"] else "glm_full"


# ─── loading ─────────────────────────────────────────────────────────────────

def load_analyses(data_dir: Path) -> dict:
    """`url -> analysis` for every GLM record on disk."""
    out = {}
    for path in Path(data_dir).glob("analysis/articles/*/*.json"):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(doc, dict) and doc.get("url"):
            out[doc["url"]] = doc
    return out


def load_records(data_dir: Path) -> dict:
    """`url -> sentiment record` for every sidecar on disk."""
    out = {}
    for path in sm.sentiment_dir(data_dir).glob("*.json"):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(doc, dict) and doc.get("url"):
            out[doc["url"]] = doc
    return out


# ─── 1. the contract probe ───────────────────────────────────────────────────

def contract_findings(records: dict) -> dict:
    """Is `score` fractional? Does `confidence` equal `max(probabilities)`?

    Plan §2.3 and §2.4, both OPEN questions settled by reading the corpus
    rather than by argument. The prior-art app's code is written as if `score`
    is fractional; our one captured probe returned an integer whose
    distribution had an expected value of 2.99 — indistinguishable in that
    sample. And `confidence == max(p)` held on all five captured answers, which
    is five.
    """
    fractional = integral = 0
    agree = disagree = 0
    for block in iter_score_blocks(records):
        level = block.get("level")
        if isinstance(level, (int, float)) and not isinstance(level, bool):
            if float(level).is_integer():
                integral += 1
            else:
                fractional += 1
        if block.get("confidence_reported") is None:
            continue
        if block.get("confidence_agrees"):
            agree += 1
        else:
            disagree += 1
    return {
        "score_integral": integral,
        "score_fractional": fractional,
        "score_is_fractional": fractional > 0,
        "confidence_agrees": agree,
        "confidence_disagrees": disagree,
        "confidence_rule_holds": disagree == 0 and agree > 0,
    }


def iter_score_blocks(records: dict):
    for record in records.values():
        for block in (record.get("axes") or {}).values():
            if isinstance(block, dict) and isinstance(block.get("score"), dict):
                yield block["score"]
        for row in record.get("subjects") or []:
            if isinstance(row, dict) and isinstance(row.get("tone"), dict):
                yield row["tone"]


# ─── 3-5. agreement with GLM, by stratum ─────────────────────────────────────

def glm_axis_label(analysis: dict, axis_id: str):
    block = (analysis or {}).get(axis_id)
    if not isinstance(block, dict):
        return None
    return block.get("label")


def axis_agreement(records: dict, analyses: dict, axis_id: str) -> dict:
    """Confusion matrix and the off-by-one rate, split by stratum.

    ⚠️ OFF-BY-ONE IS REPORTED SEPARATELY FROM A SIGN FLIP. On an ordinal, a
    disagreement of one bucket and a disagreement across neutral are different
    events, and a single accuracy figure cannot tell them apart — which is
    exactly what makes a nominal accuracy misleading here.
    """
    scale = next(a["scale"] for a in ax.ARTICLE_AXES if a["id"] == axis_id)
    order = {label: i for i, label in enumerate(scale.labels)}
    strata = {name: collections.Counter() for name in STRATA}
    distances = {name: [] for name in STRATA}
    jev_truncated = 0
    not_applicable = 0
    for url, record in records.items():
        analysis = analyses.get(url)
        block = (record.get("axes") or {}).get(axis_id)
        if not analysis or not isinstance(block, dict):
            continue
        if not isinstance(block.get("score"), dict):
            continue
        glm = glm_axis_label(analysis, axis_id)
        if glm == "not_applicable":
            # GLM's majority answer is "the question does not arise"; Jev
            # answers that with the `noul`, not with a level, so the two are
            # not comparable here. Counted, never folded into the matrix.
            not_applicable += 1
            continue
        if glm not in order:
            continue
        jev = js.bucket_label(block["score"]["value"], scale)
        stratum = glm_stratum(analysis)
        if record.get("truncated"):
            jev_truncated += 1
        strata[stratum][(glm, jev)] += 1
        distances[stratum].append(abs(order[glm] - order[jev]))
    return {
        "axis": axis_id,
        "not_applicable_skipped": not_applicable,
        "jev_truncated": jev_truncated,
        "strata": {name: summarize_matrix(matrix, distances[name])
                   for name, matrix in strata.items()},
    }


def summarize_matrix(matrix: collections.Counter, distances: list) -> dict:
    total = sum(matrix.values())
    if not total:
        return {"n": 0}
    exact = sum(v for (a, b), v in matrix.items() if a == b)
    within_one = sum(1 for d in distances if d <= 1)
    return {
        "n": total,
        "exact": exact,
        "exact_rate": exact / total,
        "within_one_rate": within_one / total,
        "mean_distance": sum(distances) / len(distances) if distances else None,
        "matrix": {f"{a}->{b}": v for (a, b), v in sorted(matrix.items())},
    }


def subject_agreement(records: dict, analyses: dict) -> dict:
    """The SUBJECT axis against GLM's party tones, split the same way.

    ⚠️ THIS AXIS WAS MISSING FROM THE REPORT ENTIRELY, and it is the one both
    named regression cases and `/party/:id` depend on. GLM's vocabulary here is
    four NOMINAL labels, so the comparison folds Jev's five ordinal buckets
    onto them: the strong degrees have no GLM counterpart, and `mixed` is not a
    point on the axis at all (it is measured separately, by `mixed_separation`).
    """
    fold = {"strongly_unfavorable": "unfavorable", "unfavorable": "unfavorable",
            "neutral": "neutral", "favorable": "favorable",
            "strongly_favorable": "favorable"}
    strata = {name: collections.Counter() for name in STRATA}
    distances = {name: [] for name in STRATA}
    mixed_skipped = incidental = 0
    for url, record in records.items():
        analysis = analyses.get(url)
        if not analysis:
            continue
        glm_by_party = {t.get("party"): t.get("tone")
                        for t in (analysis.get("party_tones") or [])
                        if isinstance(t, dict)}
        stratum = glm_stratum(analysis)
        for row in record.get("subjects") or []:
            if row.get("subject_role") == "incidental":
                incidental += 1
                continue
            tone = row.get("tone")
            glm = glm_by_party.get(row.get("name"))
            if not isinstance(tone, dict) or glm not in ("favorable", "unfavorable",
                                                         "neutral", "mixed"):
                continue
            if glm == "mixed":
                mixed_skipped += 1
                continue
            scale = ax.ANCHOR_VARIANTS.get(tone.get("levels"), ax.SUBJECT_TONE)
            jev = fold[ax.SUBJECT_TONE.labels[js.bucket_index(tone["value"], scale)]]
            order = {"unfavorable": 0, "neutral": 1, "favorable": 2}
            strata[stratum][(glm, jev)] += 1
            distances[stratum].append(abs(order[glm] - order[jev]))
    return {
        "axis": "subject_tone",
        "mixed_skipped": mixed_skipped,
        "incidental_skipped": incidental,
        "strata": {name: summarize_matrix(matrix, distances[name])
                   for name, matrix in strata.items()},
    }


# ─── 4. calibration ──────────────────────────────────────────────────────────

def calibration(records: dict, analyses: dict, axis_id: str) -> list:
    """Agreement inside each confidence bucket, with the baseline RECOMPUTED.

    ⚠️ THE BASELINE MUST BE RECOMPUTED PER BUCKET. The high-confidence bucket
    is the easy articles, so a constant answer scores better there too —
    publishing the accuracy column alone is the error
    `jev-benchmark-2026-09-20.md` made once and then wrote a rule against.
    """
    scale = next(a["scale"] for a in ax.ARTICLE_AXES if a["id"] == axis_id)
    rows = []
    for url, record in records.items():
        analysis = analyses.get(url)
        block = (record.get("axes") or {}).get(axis_id)
        if not analysis or not isinstance(block, dict):
            continue
        score = block.get("score")
        if not isinstance(score, dict):
            continue
        glm = glm_axis_label(analysis, axis_id)
        if glm not in set(scale.labels):
            continue
        rows.append((score.get("confidence_derived") or 0.0,
                     glm, js.bucket_label(score["value"], scale)))
    out = []
    for threshold in CONFIDENCE_BUCKETS:
        bucket = [r for r in rows if r[0] >= threshold]
        if not bucket:
            out.append({"threshold": threshold, "n": 0})
            continue
        agree = sum(1 for _, glm, jev in bucket if glm == jev)
        majority = collections.Counter(glm for _, glm, _ in bucket).most_common(1)[0][1]
        out.append({
            "threshold": threshold,
            "n": len(bucket),
            "coverage": len(bucket) / len(rows) if rows else 0.0,
            "agreement": agree / len(bucket),
            "in_bucket_baseline": majority / len(bucket),
            "lift": (agree - majority) / len(bucket),
        })
    return out


# ─── 6. the derived `mixed` separation ───────────────────────────────────────

def mixed_separation(records: dict, analyses: dict) -> dict:
    """Does `both_directions` recover GLM's `mixed` without its `neutral`?

    Returns the ROC over τ rather than a chosen threshold: the plan fits τ
    HERE and refuses to quote one before this has run.
    """
    positives, negatives = [], []
    for url, record in records.items():
        analysis = analyses.get(url)
        if not analysis:
            continue
        glm_by_party = {t.get("party"): t.get("tone")
                        for t in (analysis.get("party_tones") or [])
                        if isinstance(t, dict)}
        for row in record.get("subjects") or []:
            tone = row.get("tone")
            if not isinstance(tone, dict):
                continue
            label = glm_by_party.get(row.get("name"))
            if label not in ("mixed", "neutral"):
                continue
            probs = {int(k): v for k, v in (tone.get("probabilities") or {}).items()}
            scale = ax.ANCHOR_VARIANTS.get(tone.get("levels"), ax.SUBJECT_TONE)
            tails = tail_mass(probs, scale)
            (positives if label == "mixed" else negatives).append(tails)
    return {
        "mixed_n": len(positives),
        "neutral_n": len(negatives),
        "roc": roc(positives, negatives),
    }


def tail_mass(probs: dict, scale) -> float:
    """The smaller of the two tails — the quantity τ is compared against."""
    if not probs:
        return 0.0
    values, extent = scale.values, scale.extent
    left = sum(p for i, p in probs.items()
               if 0 <= i < len(values) and values[i] / extent <= -js.BOTH_DIRECTIONS_TAIL)
    right = sum(p for i, p in probs.items()
                if 0 <= i < len(values) and values[i] / extent >= js.BOTH_DIRECTIONS_TAIL)
    return min(left, right)


# Renormalized tail masses are long floats, and rounding a threshold UP
# excludes the very point that generated it from its own bucket — measured,
# 48.7% of realistic masses round up, costing 5.3 recall points at n=19 on the
# curve τ is fitted from. Comparisons are made with a tolerance instead.
ROC_TOLERANCE = 1e-9


def roc(positives: list, negatives: list) -> list:
    """`[{tau, recall, false_positive_rate}]` over the observed thresholds.

    ⚠️ THE THRESHOLDS ARE THE OBSERVED VALUES THEMSELVES, unrounded, and the
    comparison carries a tolerance. A rounded τ is not a point on this curve:
    round 0.2000000001 to 0.2 and the mass that produced it still clears it,
    but round 0.1999999999 UP and it does not — so the recall reported at that
    τ is lower than the one the threshold actually delivers.
    """
    if not positives and not negatives:
        return []
    thresholds = sorted({t for t in positives + negatives if t > 0}
                        | {0.05, 0.1, 0.2, 0.3})
    out = []
    for tau in thresholds:
        hit = sum(1 for t in positives if t >= tau - ROC_TOLERANCE)
        false = sum(1 for t in negatives if t >= tau - ROC_TOLERANCE)
        out.append({
            "tau": tau,
            "recall": hit / len(positives) if positives else None,
            "false_positive_rate": false / len(negatives) if negatives else None,
        })
    return out


# ─── 7. applicability ────────────────────────────────────────────────────────

def applicability_separation(records: dict, analyses: dict, axis_id: str) -> dict:
    """Does the `noul` gate separate GLM's `not_applicable` from its `neutral`?

    The most load-bearing new question in the design: `not_applicable` is
    57.1% of `leaning` and 87.7% of `russia_stance`, so if the gate cannot
    tell "silent" from "balanced", neither can any surface built on it.
    """
    applies_id = next(a["applies_id"] for a in ax.ARTICLE_AXES if a["id"] == axis_id)
    groups = collections.defaultdict(list)
    for url, record in records.items():
        analysis = analyses.get(url)
        block = (record.get("axes") or {}).get(axis_id)
        if not analysis or not isinstance(block, dict):
            continue
        applies = block.get("applies")
        if not isinstance(applies, (int, float)):
            continue
        label = glm_axis_label(analysis, axis_id)
        if label == "not_applicable":
            groups["not_applicable"].append(float(applies))
        elif label == "neutral":
            groups["neutral"].append(float(applies))
        elif label:
            groups["positioned"].append(float(applies))
    neutral = groups.get("neutral") or []
    positioned = groups.get("positioned") or []
    absent = groups.get("not_applicable") or []
    return {
        "axis": axis_id,
        "question": applies_id,
        "groups": {name: describe(values) for name, values in groups.items()},
        # ⚠️ THE QUESTION IS "SILENT vs BALANCED", AND ONLY THIS PAIR ASKS IT.
        # Contrasting against every non-`not_applicable` article folds in the
        # POSITIONED ones, which are 79.9% of that group on `russia_stance` —
        # an easier separation than the one the design rests on, reported
        # under its name.
        "separation_vs_neutral": separation(neutral, absent),
        "separation_vs_any_answer": separation(neutral + positioned, absent),
    }


def describe(values: list) -> dict:
    if not values:
        return {"n": 0}
    ordered = sorted(values)
    return {"n": len(values), "mean": sum(values) / len(values),
            "median": ordered[len(ordered) // 2],
            "p10": ordered[int(len(ordered) * 0.1)],
            "p90": ordered[int(len(ordered) * 0.9)]}


def separation(applicable, not_applicable):
    """Probability that a random applicable article scores above a random
    inapplicable one — the AUC, computed directly because the samples are
    small enough and a library would be a dependency for one number."""
    if not applicable or not_applicable is None or not not_applicable:
        return None
    wins = ties = 0
    for a in applicable:
        for b in not_applicable:
            if a > b:
                wins += 1
            elif a == b:
                ties += 1
    return (wins + 0.5 * ties) / (len(applicable) * len(not_applicable))


# ─── 8. the named regression articles ────────────────────────────────────────

def regression_cases(records: dict, analyses: dict) -> list:
    """The two articles §4.2 names, and what Jev said about their party."""
    out = []
    for case in REGRESSION_ARTICLES:
        found = None
        for url, record in records.items():
            analysis = analyses.get(url) or {}
            path = str(analysis.get("article_path") or "")
            if case["slug"] in path and case["domain"] in path:
                found = record
                break
        row = {**case, "found": found is not None}
        if found:
            subject = next((r for r in found.get("subjects") or []
                            if r.get("name") == case["party"]), None)
            if subject and isinstance(subject.get("tone"), dict):
                tone = subject["tone"]
                # ⚠️ THE SCALE THAT PRODUCED THE VALUE, not the display one.
                # A 9-anchor +1.0 is `l-1`; bucketed through the 5-anchor
                # scale it reads `favorable` — a SIGN FLIP, on the two
                # articles that are Phase 0's named acceptance gate.
                scale = ax.ANCHOR_VARIANTS.get(tone.get("levels"), ax.SUBJECT_TONE)
                row["value"] = tone["value"]
                row["normalized"] = js.normalize(tone["value"], scale)
                row["levels"] = tone.get("levels")
                row["bucket"] = ax.SUBJECT_TONE.labels[
                    js.bucket_index(tone["value"], scale)]
                row["subject_role"] = subject.get("subject_role")
            elif subject:
                row["subject_role"] = subject.get("subject_role")
                row["value"] = None
        out.append(row)
    return out


# ─── 9. cost and latency ─────────────────────────────────────────────────────

def spend(records: dict) -> dict:
    costs, times, tokens = [], [], []
    for record in records.values():
        for call in (record.get("calls") or {}).values():
            if isinstance(call.get("cost"), (int, float)):
                costs.append(call["cost"])
            if isinstance(call.get("ms"), (int, float)):
                times.append(call["ms"])
            if isinstance(call.get("input_tokens"), (int, float)):
                tokens.append(call["input_tokens"])
    ordered = sorted(times)
    return {
        "calls": len(costs),
        "total_cost": sum(costs),
        "cost_per_article": sum(costs) / len(records) if records else None,
        "mean_input_tokens": sum(tokens) / len(tokens) if tokens else None,
        "p50_ms": ordered[len(ordered) // 2] if ordered else None,
        "p95_ms": ordered[int(len(ordered) * 0.95)] if ordered else None,
    }


# ─── the blinded worksheet ───────────────────────────────────────────────────

def sharpest_disagreements(records: dict, analyses: dict, limit: int = 50) -> list:
    """The rows a human should read, ordered by how far the two models are.

    ⚠️ BLINDED BY CONSTRUCTION: neither model's answer is in the row. The
    existing adjudication tool hides the outlet and the URL until asked and
    records a reveal; feeding it a row that carries the answers would make the
    kappa meaningless rather than merely inconvenient.
    """
    scored = []
    for axis in ax.ARTICLE_AXES:
        scale = axis["scale"]
        order = {label: i for i, label in enumerate(scale.labels)}
        for url, record in records.items():
            analysis = analyses.get(url)
            block = (record.get("axes") or {}).get(axis["id"])
            if not analysis or not isinstance(block, dict):
                continue
            score = block.get("score")
            if not isinstance(score, dict):
                continue
            glm = glm_axis_label(analysis, axis["id"])
            if glm not in order:
                continue
            jev = js.bucket_label(score["value"], scale)
            distance = abs(order[glm] - order[jev])
            if distance:
                scored.append({
                    "axis": axis["id"],
                    "article_path": analysis.get("article_path"),
                    "distance": distance,
                })
    scored.sort(key=lambda r: -r["distance"])
    return scored[:limit]


# ─── the report ──────────────────────────────────────────────────────────────

def build_report(records: dict, analyses: dict) -> dict:
    return {
        "generated_at": _now(),
        "records": len(records),
        "analyses": len(analyses),
        "contract": contract_findings(records),
        "agreement": ([axis_agreement(records, analyses, a["id"])
                       for a in ax.ARTICLE_AXES]
                      + [subject_agreement(records, analyses)]),
        "calibration": {a["id"]: calibration(records, analyses, a["id"])
                        for a in ax.ARTICLE_AXES},
        "mixed": mixed_separation(records, analyses),
        "applicability": [applicability_separation(records, analyses, a["id"])
                          for a in ax.ARTICLE_AXES],
        "regression_cases": regression_cases(records, analyses),
        "spend": spend(records),
        "worksheet": sharpest_disagreements(records, analyses),
    }


def _now() -> str:
    import analyze_articles as aa  # noqa: PLC0415
    return aa.now_iso()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=str(ROOT / "news/data"))
    parser.add_argument("--out", default=None, help="write the report as JSON")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir)
    records = load_records(data_dir)
    if not records:
        print("no sentiment sidecars — run `npm run news:jev-sentiment` first",
              file=sys.stderr)
        return 0
    report = build_report(records, load_analyses(data_dir))
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
