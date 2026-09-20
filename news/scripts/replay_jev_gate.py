#!/usr/bin/env python3
"""Phase 3.8 — replay the Stage-A gate over live traffic already on disk.

    python3 news/scripts/replay_jev_gate.py --limit 100          # ~$0.01
    python3 news/scripts/replay_jev_gate.py --since 2026-09-19

The gold-set benchmark (§3.3) measured Jev against reference labels on a
curated, deliberately balanced 240 articles. This asks the question the
go/no-go actually turns on, on the corpus the pipeline really sees:

  1. After the named-entity veto, HOW MANY articles is the gate even allowed
     to decide about? The plan's own stopping rule is here — "if the veto
     leaves the gate less than ~10% of articles to terminate, record that and
     stop at shadow", because the saving would be under $2/month and not
     worth a silent-failure surface.
  2. Of those, what share would it terminate, and does it agree with GLM?
  3. ⚠️ CIVIC RECALL: of the articles GLM judged site-relevant, how many
     would the gate have suppressed? The §8 bar is ≥0.98, and this is the
     only number where a miss is not a cost but a deletion — a civic article
     silently dropped before anyone reads it.

Reads GLM's STORED answers (`news/data/analysis/articles/**`), so GLM is not
re-run and the comparison costs only the Jev calls. It writes nothing back
into the corpus.
"""

import argparse
import collections
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import analyze_local as al  # noqa: E402
import jev_client as jc  # noqa: E402

REPO_ROOT = Path(os.environ.get("DATA_BG_ROOT") or SCRIPT_DIR.parents[1])
ANALYSES = REPO_ROOT / "news" / "data" / "analysis" / "articles"

VETO_KINDS = {"person", "party", "institution", "company"}


def vetoed(analysis):
    """The same veto `triage_one` applies, read off the STORED mentions.

    Using GLM's stored mentions is the honest choice: at gate time the
    mentions come from the gazetteer pass that runs BEFORE analysis, and it
    is the same list. Recomputing them here would measure a different veto
    from the one that would really fire.

    A record with no `mentions` key at all (643 of 3,357 on this corpus) is
    treated as VETOED, matching `triage_one`, which falls back for exactly
    that case (`mentions_unavailable`). Reading it as un-vetoed instead would
    hand the gate a population it can never see.
    """
    if not isinstance(analysis.get("mentions"), list):
        return True
    return any(m.get("kind") in VETO_KINDS
               for m in analysis["mentions"]
               if isinstance(m, dict))


def load_corpus(limit=None, since=None, seed="naiasno-jev-replay"):
    rows, skipped = [], collections.Counter()
    files = sorted(ANALYSES.glob("*/*.json"))
    if limit:
        random.Random(seed).shuffle(files)
    for path in files:
        try:
            analysis = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            skipped["unreadable_analysis"] += 1
            continue
        if since and (analysis.get("analyzed_at") or "") < since:
            skipped["older_than_since"] += 1
            continue
        art_path = REPO_ROOT / (analysis.get("article_path") or "")
        if not art_path.is_file():
            skipped["article_missing"] += 1
            continue
        try:
            article = json.loads(art_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            skipped["unreadable_article"] += 1
            continue
        if not (article.get("content") or "").strip():
            skipped["empty_text"] += 1
            continue
        rows.append({"analysis": analysis, "article": article,
                     "path": analysis.get("article_path")})
        if limit and len(rows) >= limit:
            break
    return rows, skipped


def replay(rows, sleep=0.0):
    """Ask Jev about every article the veto lets through."""
    out = []
    for row in rows:
        analysis, article = row["analysis"], row["article"]
        rec = {
            "path": row["path"],
            "glm_site_relevant": bool(analysis.get("site_relevant")),
            "glm_quality": (analysis.get("quality") or {}).get("verdict"),
            "vetoed": vetoed(analysis),
        }
        if rec["vetoed"]:
            out.append(rec)
            continue
        state = "\n".join([
            f"ЗАГЛАВИЕ: {article.get('title') or '—'}",
            f"ТЕКСТ:\n{(article.get('content') or '')[:2000]}",
        ])
        outcome = jc.ask(state, {
            "obvious_not_site_relevant": {
                "type": "noul",
                "instructions": "Очевидно ли е, че този текст НЕ се отнася до "
                                "българския обществен живот - тоест е чист "
                                "спорт или прогноза за времето, без "
                                "институции, политика или обществени "
                                "средства?"},
            "subcategory": {
                "type": "choice",
                "instructions": "Ако текстът не е обществено значим, към коя "
                                "категория спада?",
                "criteria": {"weather": "прогноза за времето",
                             "sports": "спорт, мач, отбор или турнир",
                             "other": "нещо друго, или текстът Е обществено "
                                      "значим"}},
        })
        if not outcome:
            rec["skip"] = outcome.skip
        else:
            noul = (outcome.answers.get("obvious_not_site_relevant")
                    or {}).get("noul")
            sub = (outcome.answers.get("subcategory") or {}).get("choice")
            # ⚠️ THE ENFORCING RULE, NOT THE SHADOW'S. `triage_one` requires
            # a THIRD thing beyond a confident answer in a safe subcategory:
            # the article's own TITLE must contain one of that
            # subcategory's terms (`title_tokens & SAFE_TRIAGE_TITLE_TERMS
            # [subcategory]`) — a check on the article, not a claim by the
            # model, and the nearest thing to the verbatim-evidence proof
            # that Jev cannot supply. Measuring without it over-states the
            # gate's reach 7x (34 of 600 against 5) and invents the only
            # civic loss in the whole replay.
            title_tokens = set(re.findall(
                r"[\w]+", str(article.get("title") or "").casefold(),
                re.UNICODE))
            terms = al.SAFE_TRIAGE_TITLE_TERMS.get(sub or "", frozenset())
            rec.update({
                "not_site_relevant": noul, "subcategory": sub,
                "cost": (outcome.usage or {}).get("cost") or 0,
                "ms": outcome.ms,
                "title_term_match": bool(title_tokens & terms),
                "would_suppress": bool(
                    noul is not None and noul >= 0.98
                    and sub in al.SAFE_TRIAGE_TITLE_TERMS
                    and (title_tokens & terms)),
            })
        out.append(rec)
        if sleep:
            time.sleep(sleep)
    return out


def summarize(records):
    total = len(records)
    vetoed_n = sum(1 for r in records if r["vetoed"])
    eligible = [r for r in records if not r["vetoed"]]
    asked = [r for r in eligible if "would_suppress" in r]
    suppress = [r for r in asked if r["would_suppress"]]

    # ⚠️ THE NUMBER THE GO/NO-GO TURNS ON. Of the articles GLM judged
    # site-relevant, how many would the gate have suppressed? A miss here is
    # not a cost, it is a civic article deleted before anyone reads it.
    civic = [r for r in asked if r["glm_site_relevant"]]
    civic_lost = [r for r in civic if r["would_suppress"]]
    recall = (1 - len(civic_lost) / len(civic)) if civic else None

    agree = [r for r in asked
             if r["would_suppress"] == (not r["glm_site_relevant"])]
    return {
        "articles": total,
        "vetoed": vetoed_n,
        "vetoed_share": vetoed_n / total if total else None,
        "eligible": len(eligible),
        "eligible_share": len(eligible) / total if total else None,
        "asked": len(asked),
        "skips": collections.Counter(r["skip"] for r in eligible
                                     if r.get("skip")),
        "would_suppress": len(suppress),
        # Of the WHOLE corpus, not of the eligible subset: this is the share
        # of paid calls the gate would actually save, and the plan's ~10%
        # stopping rule is stated against it.
        "terminated_share_of_corpus": len(suppress) / total if total else None,
        "agreement_with_glm": len(agree) / len(asked) if asked else None,
        "civic_articles_asked": len(civic),
        "civic_suppressed": len(civic_lost),
        "civic_recall": recall,
        "cost": sum(r.get("cost") or 0 for r in records),
        "subcategories": collections.Counter(
            r.get("subcategory") for r in suppress),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--since", default=None,
                    help="only analyses at or after this ISO timestamp")
    ap.add_argument("--sleep", type=float, default=0.0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    rows, skipped = load_corpus(args.limit or None, args.since)
    print(f"corpus: {len(rows)} analysed articles"
          + (f"   skipped {dict(skipped)}" if skipped else ""))
    if not rows:
        print("nothing to replay", file=sys.stderr)
        return 1

    records = replay(rows, sleep=args.sleep)
    s = summarize(records)

    print(f"\nnamed-entity veto: {s['vetoed']}/{s['articles']} "
          f"({s['vetoed_share']:.1%}) — the gate never sees these")
    print(f"eligible:          {s['eligible']} ({s['eligible_share']:.1%})")
    print(f"asked:             {s['asked']}"
          + (f"   skips {dict(s['skips'])}" if s["skips"] else ""))
    print(f"would suppress:    {s['would_suppress']} "
          f"= {s['terminated_share_of_corpus']:.1%} of the corpus")
    if s["agreement_with_glm"] is not None:
        print(f"agreement w/ GLM:  {s['agreement_with_glm']:.1%}")
    if s["civic_recall"] is not None:
        verdict = "PASS" if s["civic_recall"] >= 0.98 else "FAIL"
        print(f"civic recall:      {s['civic_recall']:.4f} "
              f"({s['civic_suppressed']} of {s['civic_articles_asked']} "
              f"site-relevant articles suppressed) — §8 bar 0.98: {verdict}")
    if s["subcategories"]:
        print(f"suppressed as:     {dict(s['subcategories'])}")
    print(f"\ncost: ${s['cost']:.5f}")

    # The plan's own stopping rule, evaluated rather than left to a reader.
    if s["terminated_share_of_corpus"] is not None:
        if s["terminated_share_of_corpus"] < 0.10:
            print("\n⚠️ Under the plan's ~10% rule: the veto leaves the gate "
                  "too little to terminate for an enforcing gate to be worth "
                  "a silent-failure surface. STOP AT SHADOW.")
        else:
            print("\nAbove the plan's ~10% rule — an enforcing gate would "
                  "save a material share, subject to the civic-recall bar.")

    out_path = Path(args.out) if args.out else (
        REPO_ROOT / "news" / "data" / "_perf" / "jev" /
        f"replay-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(
        {"generated_at": datetime.now(timezone.utc).isoformat(),
         "model": jc.MODEL, "summary": s, "records": records},
        ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"report -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
