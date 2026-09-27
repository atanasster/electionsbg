#!/usr/bin/env python3
"""The person-sentiment release gate (news-person-sentiment-v1 §8).

It consumes `news/evals/person_adjudications.json` — human answers over
(article, person) pairs, collected in the review workspace's „Оценки" queue
(`npm run news:review`) — and computes whether Jev's person scores may reach
the aggregates (`NEWS_PERSON_AGGREGATES`).

⚠️⚠️ UNMET UNTIL A HUMAN WRITES PAIRS, AND IT SAYS SO. With zero pairs every
figure is undefined, the status is UNMET with the reason „no adjudicated
pairs", and `--enforce` exits non-zero. A model may not fill the file.

What it measures, over the TEST pairs only (development, stale, unclear,
malformed and duplicate rows are excluded and COUNTED):

- TONE, on the five-level scale Jev answers on (the human answers the same
  anchors, word for word):
    exact-bucket agreement ≥ 0.60
    off-by-one-or-better   ≥ 0.90
    sign-flip rate          ≤ 0.02 on the Wilson UPPER bound — favourable read
                            as unfavourable, or the reverse: the error that
                            matters most, and the one a tolerance near parity
                            cannot see
  plus the mean absolute error on the value, reported. A pair the pipeline did
  not score while the human did is scored WRONG, never dropped — silence must
  not be the highest-scoring strategy.
- SUPPORT on THREE groups (unfavourable = levels 1–2, neutral, favourable =
  4–5), ≥ 30 human labels each, and ≥ 200 test pairs. Five buckets cannot be
  the support unit: „strongly favourable" held 12 pairs in the whole corpus
  when this was written. The five-bucket confusion is REPORTED, not gated.
- WRONG PERSON: one human „this is not the person named" on a pair whose
  identity the pipeline published fails the gate outright.
- DETECTION, from the strata that exist to see what the model hides (model
  said incidental; linked but unscored; named only in the text): precision and
  recall of „is this person a substantive subject". Reported apart from tone,
  never folded into one score, and not gated.
- AGREEMENT: Cohen's κ over pairs two different people labelled — the
  category is the tone group for a toned answer and the role otherwise
  (incidental, not_substantive, or a wrong person's role), floor 40 pairs and κ ≥ 0.60. Reported as its own arm:
  `passed_without_agreement` lets a publication proceed with that arm marked
  unmet — never presented as passed (plan §9).

⚠️ A ZERO IS A CLAIM ABOUT THE SAMPLE. „0 wrong people in 200 pairs" supports
a 95% upper bound of ~1.9% on the true rate, and the report prints it.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

ADJUDICATIONS = HERE.parent / "evals" / "person_adjudications.json"
APP_DATA = HERE.parent / "app-data"
GAZETTEER = HERE.parent / "data" / "gazetteer.json"
REGISTRY = HERE.parent / "config" / "news_persons.json"

LEVELS = 5
GROUPS = ("unfavorable", "neutral", "favorable")
ROLES = ("primary", "secondary", "incidental", "not_substantive")
SUBSTANTIVE = frozenset({"primary", "secondary"})
STRATA = ("model_scored", "model_incidental", "unscored_subject", "text_only")
DETECTION_STRATA = frozenset({"model_incidental", "unscored_subject", "text_only"})

GATES = {
    "exact_bucket": ("min", 0.60),
    "off_by_one_or_better": ("min", 0.90),
    "sign_flip_upper95": ("max", 0.02),
    "wrong_person": ("max", 0),
}
SUPPORT = {"test_pairs": 200, "per_group": 30,
           "doubly_annotated": 40, "min_kappa": 0.60}


def current_rubric() -> str:
    import jev_sentiment  # noqa: PLC0415
    return jev_sentiment.RUBRIC_VERSION


def group_of(level) -> str | None:
    """Level index 0–4 → the three support groups."""
    if not isinstance(level, int) or not 0 <= level < LEVELS:
        return None
    return "unfavorable" if level < 2 else "neutral" if level == 2 else "favorable"


def wilson(successes: int, total: int, z: float = 1.96):
    if total <= 0:
        return (None, None)
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = (z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
            / denom)
    return (round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def cohen_kappa(pairs) -> dict:
    if not pairs:
        return {"n": 0, "kappa": None, "observed_agreement": None}
    n = len(pairs)
    observed = sum(1 for a, b in pairs if a == b) / n
    a_counts, b_counts = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    expected = sum(a_counts[k] * b_counts[k]
                   for k in set(a_counts) | set(b_counts)) / (n * n)
    kappa = None if expected >= 1 else round((observed - expected) / (1 - expected), 4)
    return {"n": n, "kappa": kappa, "observed_agreement": round(observed, 4)}


def pair_key(row: dict):
    """What identifies a pair — the article, the surface, the identity and the
    versions it was judged under. The surface is part of it, so two unnamed
    people in one article stay two pairs."""
    ident = row.get("identity") or {}
    return (row.get("article_url"), row.get("surface"), ident.get("id"),
            row.get("rubric_version"), row.get("identity_version"))


def current_identity_versions(gazetteer: Path = GAZETTEER,
                              registry: Path = REGISTRY) -> dict:
    """id → the identity version a pair must have been judged under. A pair
    judged before a re-link or re-slug is STALE: excluded and counted, never
    transferred to the new identity."""
    out: dict = {}
    if gazetteer.exists():
        for e in json.loads(gazetteer.read_text(encoding="utf-8")).get("entries") or []:
            if e.get("kind") == "person" and e.get("id") and e.get("identity_version"):
                out[e["id"]] = e["identity_version"]
    if registry.exists():
        import news_persons  # noqa: PLC0415
        reg = news_persons.load_registry(registry)
        for p in reg.get("persons") or []:
            if p.get("status") == "active":
                out[p["news_person_id"]] = news_persons.identity_version(reg, p)
    return out


def own_version(pid: str, version) -> str | None:
    """The part of an identity version that belongs to this person. A news
    registry version is `<registry_version>:<this person's alias digest>`, and
    the registry vintage moves whenever ANY person is added — which must not
    make every other person's labels stale."""
    if isinstance(version, str) and pid.startswith("np_") and ":" in version:
        return version.split(":", 1)[1]
    return version


def partition(rows: list, *, rubric: str | None, versions: dict | None) -> dict:
    excluded = Counter()
    scorable, by_key, seen = [], defaultdict(list), set()
    for row in rows:
        if not isinstance(row, dict):
            excluded["malformed"] += 1
            continue
        if row.get("split") != "test":
            excluded["development"] += 1
            continue
        # A declined answer carries no role by design, so it is read first.
        if row.get("declined"):
            excluded["unclear"] += 1
            continue
        if row.get("role") not in ROLES:
            excluded["malformed"] += 1
            continue
        if rubric and row.get("rubric_version") != rubric:
            excluded["stale_rubric"] += 1
            continue
        ident = row.get("identity") or {}
        if versions and ident.get("id") and ident["id"] not in versions:
            # Retired or merged away: the label was about a person who no
            # longer exists here, and is never transferred.
            excluded["retired_identity"] += 1
            continue
        if (versions and ident.get("id")
                and own_version(ident["id"], row.get("identity_version"))
                != own_version(ident["id"], versions[ident["id"]])):
            excluded["stale_identity"] += 1
            continue
        if row.get("role") in SUBSTANTIVE and group_of(row.get("level")) is None \
                and not row.get("wrong_person"):
            # A substantive role with no tone is an unfinished answer.
            excluded["unlabelled_tone"] += 1
            continue
        key = pair_key(row)
        by_key[key].append(row)
        if key in seen:
            if any(p.get("annotator") == row.get("annotator")
                   for p in by_key[key][:-1]):
                excluded["duplicate_pair"] += 1
            continue
        seen.add(key)
        scorable.append(row)
    # An adjudicating row WINS over either annotator's.
    index = {pair_key(r): i for i, r in enumerate(scorable)}
    for key, rows_for_key in by_key.items():
        verdict = next((r for r in rows_for_key if r.get("adjudicated")), None)
        if verdict is not None and key in index:
            scorable[index[key]] = verdict
    return {"scorable": scorable, "excluded": dict(excluded), "by_key": by_key}


def pipeline_level(row: dict):
    idx = row.get("pipeline_bucket_index")
    return idx if isinstance(idx, int) and 0 <= idx < LEVELS else None


def tone_metrics(rows: list) -> dict:
    """Over pairs the HUMAN placed as a substantive subject with a tone."""
    judged = [r for r in rows if r.get("role") in SUBSTANTIVE
              and group_of(r.get("level")) and not r.get("wrong_person")]
    n = len(judged)
    exact = near = flips = declined = 0
    abs_err = []
    confusion: dict = defaultdict(Counter)
    for r in judged:
        human, model = r["level"], pipeline_level(r)
        confusion[human][model if model is not None else "declined"] += 1
        if model is None:
            declined += 1          # scored WRONG on both counts, never dropped
            continue
        exact += human == model
        near += abs(human - model) <= 1
        flips += (human < 2 and model > 2) or (human > 2 and model < 2)
        if isinstance(r.get("pipeline_value"), (int, float)):
            abs_err.append(abs((human - 2) - r["pipeline_value"]))
    return {
        "n": n, "declined_by_pipeline": declined,
        "exact_bucket": round(exact / n, 4) if n else None,
        "off_by_one_or_better": round(near / n, 4) if n else None,
        "sign_flips": flips,
        "sign_flip_upper95": wilson(flips, n)[1],
        "mae_value": round(sum(abs_err) / len(abs_err), 4) if abs_err else None,
        "confusion": {str(h): dict(c) for h, c in sorted(confusion.items())},
        "per_group": dict(Counter(group_of(r["level"]) for r in judged)),
    }


def detection(rows: list) -> dict:
    """Is the person a substantive subject? The pipeline says yes on a
    model-scored pair and no on every detection stratum."""
    tp = fp = fn = 0
    for r in rows:
        human = r.get("role") in SUBSTANTIVE
        model = r.get("stratum") == "model_scored"
        tp += human and model
        fp += (not human) and model
        fn += human and not model
    return {"tp": tp, "fp": fp, "fn": fn,
            "precision": round(tp / (tp + fp), 4) if tp + fp else None,
            "recall": round(tp / (tp + fn), 4) if tp + fn else None,
            "recall_wilson95": wilson(tp, tp + fn)}


def agreement(by_key: dict) -> dict:
    pairs = []
    for rows in by_key.values():
        first = {}
        for r in rows:
            if not r.get("adjudicated"):
                first.setdefault(r.get("annotator"), r)
        if len(first) >= 2:
            a, b = list(first.values())[:2]
            pairs.append((group_of(a.get("level")) or a.get("role"),
                          group_of(b.get("level")) or b.get("role")))
    return cohen_kappa(pairs)


def support_of(rows: list, tones: dict, kappa: dict) -> dict:
    per_group = {g: tones["per_group"].get(g, 0) for g in GROUPS}
    short = {g: n for g, n in per_group.items() if n < SUPPORT["per_group"]}
    strata = Counter(r.get("stratum") for r in rows)
    agreement_ok = (kappa["n"] >= SUPPORT["doubly_annotated"]
                    and kappa.get("kappa") is not None
                    and kappa["kappa"] >= SUPPORT["min_kappa"])
    enough = len(rows) >= SUPPORT["test_pairs"] and not short
    return {"test_pairs": len(rows), "pairs_floor": SUPPORT["test_pairs"],
            "per_group": per_group, "per_group_floor": SUPPORT["per_group"],
            "groups_below_floor": short,
            "strata": {s: strata.get(s, 0) for s in STRATA},
            "doubly_annotated": kappa["n"], "kappa": kappa.get("kappa"),
            "agreement_passed": agreement_ok,
            "passed_without_agreement": enough,
            "passed": enough and agreement_ok}


def gate(tones: dict, wrong: int, support: dict, n: int) -> dict:
    values = {"exact_bucket": tones["exact_bucket"],
              "off_by_one_or_better": tones["off_by_one_or_better"],
              "sign_flip_upper95": tones["sign_flip_upper95"],
              "wrong_person": wrong}
    checks = {}
    for name, (kind, bound) in GATES.items():
        value = values[name]
        # ⚠️ FAILS CLOSED: a zero over an empty sample is not a pass.
        passed = (n > 0 and value is not None
                  and (value >= bound if kind == "min" else value <= bound))
        checks[name] = {"value": value, kind: bound, "passed": passed}
    measures_ok = all(c["passed"] for c in checks.values())
    return {"checks": checks, "support": support,
            "passed_without_agreement": measures_ok and support["passed_without_agreement"],
            "passed": measures_ok and support["passed"]}


def published_distribution(app_data: Path) -> dict:
    """The published bucket shares — the drift baseline, so a change that
    makes the gate easier by relabelling everything neutral is visible."""
    index = app_data / "persons.json"
    if not index.exists():
        return {"available": False, "reason": "no persons.json"}
    counts: Counter = Counter()
    for row in json.loads(index.read_text(encoding="utf-8")).get("persons") or []:
        for bucket, n in (row.get("counts") or {}).items():
            counts[bucket] += int(n or 0)
    total = sum(counts.values())
    return {"available": True, "units": total, "counts": dict(counts),
            "shares": {k: round(v / total, 4) for k, v in counts.items()} if total else {}}


def build_report(path: Path = ADJUDICATIONS, *, rubric: str | None = None,
                 versions: dict | None = None, app_data: Path = APP_DATA) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    rows = raw.get("pairs") or []
    part = partition(rows, rubric=rubric, versions=versions)
    scorable = part["scorable"]
    tones = tone_metrics(scorable)
    # A wrong person counts wherever the PIPELINE attached the identity —
    # every stratum but `text_only`, whose identity the sampler supplied.
    wrong = sum(1 for r in scorable if r.get("wrong_person")
                and r.get("stratum") != "text_only")
    kappa = agreement(part["by_key"])
    support = support_of(scorable, tones, kappa)
    verdict = gate(tones, wrong, support, len(scorable))
    status = ("UNMET — 0 adjudicated pairs; nothing here is a measured accuracy"
              if not scorable else "MET" if verdict["passed"]
              else "MET EXCEPT AGREEMENT" if verdict["passed_without_agreement"]
              else "UNMET")
    return {
        "version": 2, "source": str(path), "rubric_version": rubric,
        "pairs_in_file": len(rows), "excluded": part["excluded"],
        "tones": tones, "wrong_person": wrong,
        "detection": detection(scorable), "inter_annotator": kappa,
        "gate": verdict, "status": status,
        "zero_claims": {"upper_bound_95_at_this_n": wilson(0, len(scorable))[1]
                        if scorable else None},
        "published_distribution": published_distribution(app_data),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--adjudications", type=Path, default=ADJUDICATIONS)
    ap.add_argument("--app-data", type=Path, default=APP_DATA)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--enforce", action="store_true",
                    help="exit non-zero unless every floor, agreement included, is met")
    args = ap.parse_args(argv)
    report = build_report(args.adjudications, rubric=current_rubric(),
                          versions=current_identity_versions(),
                          app_data=args.app_data)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"person sentiment gate: {report['status']}")
        s = report["gate"]["support"]
        print(f"  test pairs: {s['test_pairs']} (floor {s['pairs_floor']}); "
              f"per group {s['per_group']} (floor {s['per_group_floor']})")
        print(f"  agreement: {s['doubly_annotated']} doubly annotated, "
              f"κ {s['kappa']} — {'met' if s['agreement_passed'] else 'UNMET'}")
        for name, row in report["gate"]["checks"].items():
            bound = row.get("min", row.get("max"))
            print(f"  {'ok ' if row['passed'] else 'UNMET'} {name}: "
                  f"{row['value']} (bound {bound})")
        d = report["detection"]
        print(f"  detection (reported, not gated): precision {d['precision']}, "
              f"recall {d['recall']}")
        if report["excluded"]:
            print(f"  excluded: {report['excluded']}")
    return 1 if args.enforce and not report["gate"]["passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
