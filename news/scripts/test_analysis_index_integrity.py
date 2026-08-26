#!/usr/bin/env python3
"""The analysis index must not name a file that is not on disk.

Every other test in news/scripts/ runs against a throwaway fixture root
(DATA_BG_ROOT). This one deliberately does not, and the reason is that
news/data/ is GITIGNORED host state: the index and the analyses it points at
exist only on the machine that built them, so the drift is per-box, no review
of a diff can see it, and no fixture exercising `analyze_articles.py` alone
can observe it either — it accumulates from OUTSIDE the writer, when a corpus
article is pruned by hand, a bot_refused site's tree is removed, or a domain
is re-keyed. Measured 2026-08-27 before the guard existed: 5 of 368 `articles`
entries named an analysis file that had not been there for weeks, and nothing
anywhere reported it.

Being host state is also why an absent index SKIPS rather than fails: a fresh
clone legitimately has no corpus at all. A PRESENT-but-drifted one is red, with
the one-command repair in the message.

⚠️ A DANGLING ENTRY IS NOT A CRASH, which is why it survived. Every consumer
that walks the index by path guards the read (newsapp/app/mentions.test.ts's
`sourceAnalysis` returns null; `save_analysis`'s sibling load skips), so the
corpus simply gets quietly smaller than the index claims and every count
reconciles against the index rather than against the disk.

The repair is `python3 news/scripts/analyze_articles.py --rebuild`, which
prunes an entry whose analysis is gone and repoints one whose `article_path`
went stale.

Run:  python3 news/scripts/test_analysis_index_integrity.py
"""

import json
import os
import sys
import unittest

REPO_ROOT = os.environ.get("DATA_BG_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", ".."))
INDEX_PATH = os.path.join(REPO_ROOT, "news", "data", "analysis", "index.json")


def dangling(index, section):
    """The ONE predicate, so the mutation check below exercises the same code
    the live assertion does. A gate whose discrimination check re-implements
    the rule proves only that two implementations agree."""
    return sorted(
        key for key, entry in (index.get(section) or {}).items()
        if not (isinstance(entry, dict) and isinstance(entry.get("path"), str)
                and entry["path"]
                and os.path.exists(os.path.join(REPO_ROOT, entry["path"])))
    )


def load_index():
    if not os.path.exists(INDEX_PATH):
        return None
    with open(INDEX_PATH, encoding="utf-8") as fh:
        return json.load(fh)


class TestAnalysisIndexOnDisk(unittest.TestCase):
    def setUp(self):
        self.index = load_index()
        if self.index is None:
            # ⚠️ A DISTINCT reason. "no index committed yet" must never read as
            # "the index is clean" — a fresh clone before the first analysis run
            # is the one state where both look identical from here.
            self.skipTest(f"no analysis index at {INDEX_PATH} — nothing to check")

    def test_no_article_entry_names_a_missing_analysis(self):
        missing = dangling(self.index, "articles")
        self.assertEqual(
            missing, [],
            f"{len(missing)} of {len(self.index.get('articles') or {})} index entries name an "
            f"analysis file that is not on disk; run "
            f"`python3 news/scripts/analyze_articles.py --rebuild`. First few: "
            + ", ".join(f"{u} -> {self.index['articles'][u].get('path')}" for u in missing[:5]))

    def test_no_story_entry_names_a_missing_story_file(self):
        missing = dangling(self.index, "stories")
        self.assertEqual(
            missing, [],
            f"{len(missing)} story entries name a file that is not on disk; run "
            f"`python3 news/scripts/analyze_articles.py --rebuild`. First few: "
            + ", ".join(missing[:5]))

    def test_the_index_is_not_empty(self):
        """⚠️ Without this the two assertions above are vacuously green on an
        index whose `articles` map is `{}` — the exact state a half-written
        rebuild leaves, and the one where "no entry dangles" is most misleading."""
        self.assertGreater(len(self.index.get("articles") or {}), 0)
        self.assertGreater(len(self.index.get("stories") or {}), 0)

    def test_the_check_still_discriminates(self):
        """MUTATION CHECK. `os.path.exists` over a corpus that happens to be
        clean is satisfied by a predicate that has silently stopped looking —
        a renamed section key, a swallowed exception, an `entry.get("path")`
        that now returns None for every row. Feed the SAME predicate a
        deliberately broken index and require it to report each break."""
        good = next(iter(self.index["articles"].values()))["path"]
        broken = {
            "articles": {
                "https://example.invalid/present": {"path": good},
                "https://example.invalid/gone": {"path": "news/data/analysis/articles/nope.bg/x.json"},
                "https://example.invalid/blank": {"path": ""},
                "https://example.invalid/absent-key": {"domain": "nope.bg"},
                "https://example.invalid/wrong-type": {"path": 42},
            }
        }
        self.assertEqual(dangling(broken, "articles"), [
            "https://example.invalid/absent-key",
            "https://example.invalid/blank",
            "https://example.invalid/gone",
            "https://example.invalid/wrong-type",
        ])
        # ...and that a real path is NOT reported, so the predicate is not
        # simply returning everything it is handed.
        self.assertNotIn("https://example.invalid/present", dangling(broken, "articles"))
        # an absent section is empty, never an exception
        self.assertEqual(dangling(broken, "stories"), [])


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False, verbosity=1).result.wasSuccessful() else 1)
