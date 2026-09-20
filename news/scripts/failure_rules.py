#!/usr/bin/env python3
"""What a per-article failure MEANS — the one definition, in one place.

Two very different things arrive in a save result's `failed` list:

  a DECISION   the page was fetched and the gate refused it on its CONTENT
               (non_article_page, thin_body, title_as_body, off_domain,
               robots_disallowed)
  a FAILURE    we never got the page (HTTP 403, a timeout, a reset)

Only the second is worth another attempt, and the distinction has to be one
rule because two consumers act on it:

  * `merge_retry_queue` (save_articles.py) — a decision is never queued;
    those have the rejection ledger and its own TTL, and re-fetching tonight
    what the gate refused on purpose is just noise.
  * `escalate_browser.sh` — the page-level browser fallback.

⚠️ THE SECOND ONE DID NOT HAVE THE RULE, and read `failed` verbatim. So it
spent a real browser — 45 s a page, 5 pages, per domain, inside an hourly
job — re-fetching pages that had been decided against on content, which
identical bytes in a browser cannot change; and when they failed again it
wrote the domain a six-hour cooldown for "yielding nothing", which reads as
an outlet block and is not one. Measured 2026-09-20 on the 05:00 sweep: all
5 escalated dnes.bg URLs were recipes and horoscopes the article gate
rejects by design (`/a/528-gladen-gid/`, `/a/7-mish-mash/`), and
plovdiv24.bg's were its own SECTION pages — the homepage, „Новини",
„Спортни новини".

This module has no imports beyond `re` on purpose: it is imported from a
shell one-liner inside the escalator, where pulling in the whole saver (and
its fetch_latest_articles dependency) would be both slow and a way for an
unrelated import error to empty the URL list.
"""

import re

# Per-article failures that are DECISIONS, not transient errors. Prefix
# matched, because each of these details carries an explanation after the
# code ("non_article_page (no Article JSON-LD, ...)").
TERMINAL_FAILURE_RE = re.compile(
    r"^(non_article_page|title_as_body|thin_body|no title and no content"
    r"|robots_disallowed|off_domain)")


# The structured reasons the body/article gate records. A `failed` row that
# carries one of these is a decision whatever its prose says.
TERMINAL_REASONS = frozenset({
    "non_article_page", "title_as_body", "thin_body",
    "no title and no content", "robots_disallowed", "off_domain",
})


def is_terminal_failure(detail, reason=None):
    """True when this failure is a decision about the page's content.

    ⚠️ PREFER THE STRUCTURED REASON. `_reject` has always known which gate
    fired and used to drop it, leaving both consumers to re-derive the answer
    from the prefix of a human-readable sentence — so rewording one detail
    string reinstated the defect in the UNSAFE direction (a decision read as
    a fetch failure, escalated to a browser that cannot change it) with every
    test still green. The prose match stays as the fallback, because rows
    reaching here from older state files and from the non-`_reject` producers
    carry no reason.

    Unknown or empty details are NOT terminal: a failure this rule does not
    recognise gets another attempt, which costs one fetch, rather than being
    silently retired, which costs an article. New gate reasons must be added
    here — that is the intended direction of the asymmetry.
    """
    if reason:
        return reason in TERMINAL_REASONS
    return bool(TERMINAL_FAILURE_RE.match(detail or ""))
