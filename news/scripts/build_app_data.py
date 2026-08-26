#!/usr/bin/env python3
"""Bundle the news corpus + analysis into static JSON for the newsapp (news.electionsbg.com).

Reads three layers under news/data (see .zcode/skills/analyze-news-article/SKILL.md for
the full schemas):

  * corpus        — news/data/<domain>/<file>.json, one article per file
                    (title/url/published/author/topic/keywords/description/content…)
  * analysis      — news/data/analysis/articles/<domain>/<file>.json (LLM rubric per
                    article: quality, summaries, leaning, russia_stance, ai_generated,
                    entities, party_tones, topics, story membership) and
                    news/data/analysis/stories/<id>.json (same-event clusters with
                    per-story aggregates)
  * reference     — news/topics.json (26 categories / 103 subcategories) and
                    news/data/bg_news_sites.csv (outlet rank/tier/type/scope)

and writes the app-facing bundles consumed by the standalone newsapp's data client
(newsapp/app/data.ts; the app itself is built by vite.config.news.ts):

  stats.json                corpus/analysis totals + per-category usage counts
  outlets.json              one entry per CSV outlet (+ any data-only domains), with
                            a `retired` flag and reason for outlets removed from the
                            registry — their articles stay, but the app must not
                            present them as live sources, and two asked not to be
                            crawled at all
                            article/analysis counts and leaning/russia/ai distributions
  taxonomy.json             categories/subcategories with bg/en labels + usage counts
  stories.json              all story clusters: canonical titles, summaries, aggregates,
                            members joined to corpus headlines, computed blindspot flag
  latest.json               the N most recent articles corpus-wide (compact + analysis)
  articles/<domain>.json    compact per-outlet article list; analyzed articles carry the
                            full analysis block so /article/:domain/:id is a single fetch

Stdlib only, mirroring the other news/scripts tools. Article bodies are deliberately NOT
bundled — the app shows excerpts/summaries and links out to the source (ground.news model),
keeping the whole bundle set ~5 MB and free of republication concerns.

Run:  python3 news/scripts/build_app_data.py [--data-dir news/data] [--out news/app-data]
      [--latest 600] [--quiet] [--json]
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
LEANING_LABELS = {
    "strong_conservative",
    "conservative",
    "neutral",
    "progressive",
    "strong_progressive",
    "not_applicable",
}
LEFT_WING = {"progressive", "strong_progressive"}
RIGHT_WING = {"conservative", "strong_conservative"}
RUSSIA_LABELS = {
    "strong_pro_russia",
    "pro_russia",
    "neutral",
    "anti_russia",
    "strong_anti_russia",
    "not_applicable",
}
AI_VERDICTS = {"likely_human", "unclear", "likely_ai"}
QUALITY_VERDICTS = {
    "ok",
    "paywall_shell",
    "client_render_shell",
    "too_short",
    "not_bulgarian",
    "non_article",
}
# CSV column headers carry a data-vintage suffix (_aug2026); match by prefix so a new
# vintage only changes the suffix, not this script.
CSV_COLUMN_PREFIXES = (
    "rank",
    "tier",
    "domain",
    "outlet",
    "type",
    "scope",
    "similarweb_visits",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))


def excerpt_of(article: dict, limit: int = 480) -> str:
    text = (article.get("description") or "").strip()
    if not text:
        text = re.sub(r"\s+", " ", (article.get("content") or "")).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def load_story_index(data_dir: Path) -> dict[str, str]:
    """url -> resolved story_id from analysis/index.json.

    The `story` block inside an analysis record is the raw LLM decision (null
    story_id for every new_story), so resolved membership lives only in the index
    that analyze_articles.py maintains — this is the authoritative join."""
    idx_path = data_dir / "analysis" / "index.json"
    try:
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        url: entry.get("story_id")
        for url, entry in (idx.get("articles") or {}).items()
        if entry.get("story_id")
    }


def load_analysis(data_dir: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return (by_url, by_article_id) maps of analysis records."""
    by_url: dict[str, dict] = {}
    by_article_id: dict[str, dict] = {}
    base = data_dir / "analysis" / "articles"
    if not base.is_dir():
        return by_url, by_article_id
    for domain_dir in sorted(base.iterdir()):
        if not domain_dir.is_dir():
            continue
        for fp in sorted(domain_dir.glob("*.json")):
            try:
                rec = json.loads(fp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"  ! skipping unreadable analysis {fp}: {exc}", file=sys.stderr)
                continue
            if rec.get("url"):
                by_url[rec["url"]] = rec
            by_article_id[f'{rec.get("domain")}/{fp.stem}'] = rec
    return by_url, by_article_id


def compact_analysis(rec: dict) -> dict:
    """Keep everything the article page renders; drop bookkeeping (paths, timestamps)."""
    return {
        "summary_bg": rec.get("summary_bg"),
        "summary_en": rec.get("summary_en"),
        "leaning": rec.get("leaning"),
        "russia_stance": rec.get("russia_stance"),
        "ai_generated": rec.get("ai_generated"),
        "entities": rec.get("entities"),
        "party_tones": rec.get("party_tones"),
        "topics": rec.get("topics"),
        "quality": rec.get("quality"),
        "site_relevant": rec.get("site_relevant"),
        "model": rec.get("model"),
        "analyzed_at": rec.get("analyzed_at"),
    }


def blindspot_of(members: list[dict]) -> dict | None:
    """Ground.news-style blindspot: a story with ≥2 leaning-labeled members where one
    political wing is entirely absent. Returns {"side": <missing wing>} or None. Neutral
    and not_applicable members carry no wing signal and never trigger a blindspot."""
    labelled = [m for m in members if m.get("leaning") in LEFT_WING | RIGHT_WING]
    if len(labelled) < 2:
        return None
    has_left = any(m["leaning"] in LEFT_WING for m in labelled)
    has_right = any(m["leaning"] in RIGHT_WING for m in labelled)
    if has_left and not has_right:
        return {"side": "right"}
    if has_right and not has_left:
        return {"side": "left"}
    return None


def rank_of(meta: dict) -> int:
    """CSV sort key; non-numeric ranks (future vintages: n/a, 100+, –) sort last."""
    raw = str(meta.get("rank") or "")
    return int(raw) if raw.isdigit() else 10**9


def parse_visits(raw: str | None) -> int | None:
    """'18.3M'/'940K'/'123' -> visit count, so consumers never parse suffixes."""
    if not raw:
        return None
    m = re.fullmatch(r"([\d.]+)\s*([KMB]?)", raw.strip(), flags=re.IGNORECASE)
    if not m:
        return None
    mult = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[m.group(2).upper()]
    try:
        return int(float(m.group(1)) * mult)
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, default=REPO / "news" / "data")
    ap.add_argument("--out", type=Path, default=REPO / "news" / "app-data")
    ap.add_argument("--latest", type=int, default=600)
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument(
        "--json",
        action="store_true",
        help="print the summary as one JSON object on stdout (orchestration contract "
        "shared with fetch_latest_articles.py / save_articles.py / analyze_articles.py)",
    )
    args = ap.parse_args()

    data_dir: Path = args.data_dir
    out_dir: Path = args.out
    generated_at = now_iso()
    verbose = not args.quiet

    # ---- reference data -----------------------------------------------------------
    try:
        taxonomy_doc = json.loads((REPO / "news" / "topics.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"fatal: cannot read {REPO / 'news' / 'topics.json'}: {exc}", file=sys.stderr)
        return 1
    categories = taxonomy_doc.get("categories", [])

    outlets_csv: dict[str, dict] = {}
    csv_path = data_dir / "bg_news_sites.csv"
    if csv_path.exists():
        with csv_path.open(encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            # Map suffixed headers (rank_aug2026…) back to their logical names.
            colmap = {}
            for raw in reader.fieldnames or []:
                for prefix in CSV_COLUMN_PREFIXES:
                    if raw == prefix or raw.startswith(prefix + "_"):
                        colmap[raw] = prefix
                        break
            for row in reader:
                item = {colmap.get(k, k): (v or None) for k, v in row.items() if colmap.get(k)}
                domain = item.get("domain")
                if domain:
                    outlets_csv[domain] = item

    # Outlets removed from the registry. Their articles were collected in good
    # faith and stay in the bundle — deleting real reporting because the source
    # later declined to be crawled would be the wrong correction — but the app
    # must not present a retired outlet as a live source, and two of these
    # asked not to be crawled at all.
    retired: dict[str, dict] = {}
    retired_path = data_dir / "retired_sites.csv"
    if retired_path.exists():
        try:
            with retired_path.open(encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    domain = (row.get("domain") or "").strip()
                    if domain:
                        retired[domain] = {
                            "reason": (row.get("reason") or "").strip() or None,
                            "retired_on": (row.get("retired_on") or "").strip() or None,
                        }
        except (OSError, csv.Error, UnicodeDecodeError):
            pass

    # ---- corpus + analysis --------------------------------------------------------
    analysis_by_url, analysis_by_id = load_analysis(data_dir)
    story_index = load_story_index(data_dir)
    domain_names = sorted(
        d.name
        for d in data_dir.iterdir()
        if d.is_dir() and not d.name.startswith("_") and d.name != "analysis"
    )

    articles_by_domain: dict[str, list[dict]] = {}
    all_latest: list[dict] = []
    leaning_by_domain: dict[str, dict[str, int]] = {}
    russia_by_domain: dict[str, dict[str, int]] = {}
    ai_by_domain: dict[str, dict[str, int]] = {}
    analyzed_by_domain: dict[str, int] = {d: 0 for d in domain_names}
    topic_article_counts: dict[tuple[str, str | None], int] = {}

    for domain in domain_names:
        records: list[dict] = []
        for fp in sorted((data_dir / domain).glob("*.json")):
            try:
                art = json.loads(fp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"  ! skipping unreadable article {fp}: {exc}", file=sys.stderr)
                continue
            analysis = analysis_by_url.get(art.get("url")) or analysis_by_id.get(
                f"{domain}/{fp.stem}"
            )
            rec = {
                "id": fp.stem,
                "domain": domain,
                "title": art.get("title"),
                "url": art.get("url"),
                "published": art.get("published"),
                "author": art.get("author"),
                "topic": art.get("topic"),
                "keywords": art.get("keywords"),
                "excerpt": excerpt_of(art),
                "content_chars": art.get("content_chars"),
                "story_id": None,
            }
            if analysis:
                # Resolved story membership comes from the index (the decision block
                # carries story_id only for same_story attachments).
                rec["story_id"] = story_index.get(art.get("url")) or (
                    analysis.get("story") or {}
                ).get("story_id")
                rec["analysis"] = compact_analysis(analysis)
                analyzed_by_domain[domain] = analyzed_by_domain.get(domain, 0) + 1
                lean = (analysis.get("leaning") or {}).get("label")
                stance = (analysis.get("russia_stance") or {}).get("label")
                ai = (analysis.get("ai_generated") or {}).get("verdict")
                if lean in LEANING_LABELS:
                    bucket = leaning_by_domain.setdefault(domain, {})
                    bucket[lean] = bucket.get(lean, 0) + 1
                if stance in RUSSIA_LABELS:
                    bucket = russia_by_domain.setdefault(domain, {})
                    bucket[stance] = bucket.get(stance, 0) + 1
                if ai in AI_VERDICTS:
                    bucket = ai_by_domain.setdefault(domain, {})
                    bucket[ai] = bucket.get(ai, 0) + 1
                for t in analysis.get("topics") or []:
                    key = (t.get("category"), t.get("subcategory"))
                    topic_article_counts[key] = topic_article_counts.get(key, 0) + 1
            records.append(rec)
            all_latest.append(rec)
        # Newest first; undated records sort last ("" < any ISO date under reverse).
        records.sort(key=lambda r: r.get("published") or "", reverse=True)
        articles_by_domain[domain] = records

    # ---- per-domain bundles --------------------------------------------------------
    for domain, records in articles_by_domain.items():
        write_json(
            out_dir / "articles" / f"{domain}.json",
            {
                "domain": domain,
                "outlet": (outlets_csv.get(domain) or {}).get("outlet") or domain,
                "generated_at": generated_at,
                "articles": records,
            },
        )
    # A renamed/removed corpus domain would otherwise leave its stale bundle behind
    # (the out dir is gitignored, so nothing would surface it).
    articles_out = out_dir / "articles"
    if articles_out.is_dir():
        for fp in articles_out.glob("*.json"):
            if fp.stem not in articles_by_domain:
                fp.unlink()

    # ---- latest.json ----------------------------------------------------------------
    latest = [r for r in all_latest if r.get("published")]
    latest.sort(key=lambda r: r["published"], reverse=True)
    write_json(
        out_dir / "latest.json",
        {"generated_at": generated_at, "articles": latest[: args.latest]},
    )

    # ---- stories.json ----------------------------------------------------------------
    stories_dir = data_dir / "analysis" / "stories"
    stories = []
    story_topic_counts: dict[str, int] = {}
    if stories_dir.is_dir():
        corpus_records = {(r["domain"], r["id"]): r for r in all_latest}
        for fp in sorted(stories_dir.glob("*.json")):
            try:
                st = json.loads(fp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            members = []
            for m in st.get("members") or []:
                article_id = Path(m["article_path"]).stem if m.get("article_path") else None
                title = None
                # Every member's corpus file was parsed moments ago — resolve from
                # memory; only re-read the disk for members whose file vanished.
                rec = corpus_records.get((m.get("domain"), article_id))
                if rec:
                    title = rec.get("title")
                elif m.get("article_path"):
                    try:
                        title = json.loads(
                            (REPO / m["article_path"]).read_text(encoding="utf-8")
                        ).get("title")
                    except (OSError, json.JSONDecodeError):
                        pass
                members.append(
                    {
                        "domain": m.get("domain"),
                        "article_id": article_id,
                        "url": m.get("url"),
                        "title": title,
                        "published": m.get("published"),
                        "leaning": m.get("leaning"),
                        "russia_stance": m.get("russia_stance"),
                    }
                )
            members.sort(key=lambda m: m.get("published") or "")
            primary = next(
                (t for t in st.get("topics") or [] if t.get("primary")),
                (st.get("topics") or [{}])[0] if st.get("topics") else None,
            )
            if primary:
                story_topic_counts[primary.get("category", "?")] = (
                    story_topic_counts.get(primary.get("category", "?"), 0) + 1
                )
            stories.append(
                {
                    "id": st.get("id"),
                    "title_bg": st.get("canonical_title_bg"),
                    "title_en": st.get("canonical_title_en"),
                    "summary_bg": st.get("summary_bg"),
                    "summary_en": st.get("summary_en"),
                    "first_published": st.get("first_published"),
                    "last_published": st.get("last_published"),
                    "topics": st.get("topics") or [],
                    "related_story_ids": st.get("related_story_ids") or [],
                    "entities": st.get("entities") or {},
                    "aggregates": st.get("aggregates") or {},
                    "blindspot": blindspot_of(members),
                    "members": members,
                }
            )
    stories.sort(key=lambda s: s.get("last_published") or "", reverse=True)
    write_json(out_dir / "stories.json", {"generated_at": generated_at, "stories": stories})

    # ---- taxonomy.json (with usage counts) -------------------------------------------
    def count_for(cat_id: str, sub_id: str | None) -> int:
        return topic_article_counts.get((cat_id, sub_id), 0)

    taxonomy_out = {
        "version": taxonomy_doc.get("version"),
        "generated_at": generated_at,
        "categories": [
            {
                "id": c["id"],
                "label": c["label"],
                "route": c.get("route"),
                "article_count": count_for(c["id"], None)
                + sum(count_for(c["id"], s["id"]) for s in c.get("subcategories") or []),
                "story_count": story_topic_counts.get(c["id"], 0),
                "subcategories": [
                    {
                        "id": s["id"],
                        "label": s["label"],
                        "article_count": count_for(c["id"], s["id"]),
                    }
                    for s in c.get("subcategories") or []
                ],
            }
            for c in categories
        ],
    }
    write_json(out_dir / "taxonomy.json", taxonomy_out)

    # ---- outlets.json -----------------------------------------------------------------
    outlets = []
    seen = set()
    for domain, meta in sorted(outlets_csv.items(), key=lambda kv: rank_of(kv[1])):
        seen.add(domain)
        outlets.append(
            {
                "domain": domain,
                "outlet": meta.get("outlet") or domain,
                "retired": False,
                "retired_reason": None,
                "retired_on": None,
                "rank": rank_of(meta) if rank_of(meta) != 10**9 else None,
                "tier": meta.get("tier"),
                "type": meta.get("type"),
                "scope": meta.get("scope"),
                "visits": parse_visits(meta.get("similarweb_visits")),
                "article_count": len(articles_by_domain.get(domain, [])),
                "analyzed_count": analyzed_by_domain.get(domain, 0),
                "leaning": leaning_by_domain.get(domain, {}),
                "russia_stance": russia_by_domain.get(domain, {}),
                "ai_generated": ai_by_domain.get(domain, {}),
            }
        )
    for domain in domain_names:  # domains with data but absent from the CSV
        if domain in seen:
            continue
        gone = retired.get(domain)
        outlets.append(
            {
                "domain": domain,
                "outlet": domain,
                # A retired outlet's articles stay — they were collected in
                # good faith — but the app must not present it as a live
                # source, and two of these asked not to be crawled at all.
                "retired": bool(gone),
                "retired_reason": (gone or {}).get("reason"),
                "retired_on": (gone or {}).get("retired_on"),
                "rank": None,
                "tier": None,
                "type": None,
                "scope": None,
                "visits": None,
                "article_count": len(articles_by_domain.get(domain, [])),
                "analyzed_count": analyzed_by_domain.get(domain, 0),
                "leaning": leaning_by_domain.get(domain, {}),
                "russia_stance": russia_by_domain.get(domain, {}),
                "ai_generated": ai_by_domain.get(domain, {}),
            }
        )
    write_json(out_dir / "outlets.json", {"generated_at": generated_at, "outlets": outlets})

    # ---- stats.json --------------------------------------------------------------------
    published_dates = [r["published"] for r in all_latest if r.get("published")]
    total_articles = len(all_latest)
    analyzed_total = sum(analyzed_by_domain.values())
    write_json(
        out_dir / "stats.json",
        {
            "generated_at": generated_at,
            "taxonomy_version": taxonomy_doc.get("version"),
            "total_articles": total_articles,
            "analyzed_articles": analyzed_total,
            "analyzed_pct": round(100 * analyzed_total / total_articles, 1) if total_articles else 0,
            "stories": len(stories),
            "domains": len(domain_names),
            "outlets_catalogued": len(outlets_csv),
            "first_published": min(published_dates) if published_dates else None,
            "last_published": max(published_dates) if published_dates else None,
            "articles_by_domain": {d: len(r) for d, r in sorted(articles_by_domain.items())},
        },
    )

    total_files = len(list(out_dir.rglob("*.json")))
    total_bytes = sum(p.stat().st_size for p in out_dir.rglob("*.json"))
    summary = {
        "out": str(out_dir),
        "total_articles": total_articles,
        "analyzed_articles": analyzed_total,
        "analyzed_pct": round(100 * analyzed_total / max(total_articles, 1), 1),
        "stories": len(stories),
        "outlets": len(outlets),
        "files": total_files,
        "bytes": total_bytes,
        "generated_at": generated_at,
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    elif verbose:
        print(
            f"news app-data → {out_dir}: {total_articles} articles "
            f"({analyzed_total} analyzed, {summary['analyzed_pct']}%), "
            f"{len(stories)} stories, {len(outlets)} outlets, "
            f"{total_files} files, {total_bytes / 1_048_576:.1f} MB"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
