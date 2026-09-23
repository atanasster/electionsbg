#!/usr/bin/env python3
"""T4.4 — the sentiment SCALE record: its subjects, its roles and its store.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` Phase 1. This module owns
the shape of what is stored and the deterministic half of what is asked; the
network call lives beside it in Phase 2 and imports from here.

⚠️ FOUR REFUSALS, each a claim we decline to make.

1. **A stale record is nothing, never a stale claim.** The cache key is the
   rubric, the contract, the axes version AND the article's own content
   digest, so a re-extracted article invalidates its own scores rather than
   silently re-pointing them at different words. `current_for` returns None on
   any mismatch; it never degrades to "close enough".
2. **An incidental subject gets no tone at all.** `subject_role` separates the
   subject an article is ABOUT from the one it names in passing — the rule
   `person_tones` already carries as its refusal 4, ported to parties because
   they had none. Measured: only 12.2% of articles name any party, and a large
   share of their `neutral` rows are single passing mentions being counted as
   full assessments.
3. **Nothing defaults.** A subject the pass never looked at must not be
   indistinguishable from one it assessed and found nothing to say about, so
   the cap is RECORDED (`subjects_total` / `subjects_dropped`) rather than
   silently applied, and a failed run stores its reason instead of a neutral.
4. **No `not_applicable` on an ordinal.** The two article axes carry a
   separate applicability probability; see `jev_axes` for why a 57.1% / 87.7%
   majority answer cannot be a level on the scale it would otherwise dominate.

⚠️ ONE OF `person_tones`' REFUSALS DOES **NOT** HOLD HERE, AND SAYING SO IS
THE POINT. Its refusal 1 is "no identity, no public tone" — a tone is stored
against a resolved `news_person_id`, never against a surface. This pass has no
resolver: its subjects are the NAMES the model wrote, so two people sharing a
name share a row. That is acceptable for an article-level reading and is NOT
acceptable as an attribution, so nothing downstream may hang one of these
scores on a registry person without resolving it first. A list of refusals that
quietly omits the one you are not keeping reads as though you kept it.

⚠️ THE ROLE IS MOSTLY DETERMINISTIC, ON PURPOSE. The prior art this design
borrows from (a shipped Jev sentiment app) computes its statistics in Python
and asks the model only what needs judgement. `incidental` is mechanical — a
subject named once, not in the title — so it is decided here; only `primary`
is a judgement, and it costs one `choice` question for the whole article
rather than one per subject.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

import analyze_articles as aa  # noqa: E402
import jev_axes as ax  # noqa: E402
import jev_scales as js  # noqa: E402
import jev_text as jt  # noqa: E402

RUBRIC_VERSION = "jev-sentiment-v1"
RECORD_VERSION = 1

SUBJECT_KINDS = ("party", "person")
SUBJECT_ROLES = frozenset({"primary", "secondary", "incidental"})
# Per-SUBJECT, written by the ask in Phase 2.
ASSESSMENT_STATUSES = frozenset({"assessed", "not_assessed", "insufficient_text"})
# Per-RECORD. ⚠️ A DIFFERENT VOCABULARY, and `person_tones` keeps the two apart
# for the same reason: "the run failed" and "this subject was not assessed" are
# not the same claim, and one frozenset for both lets either be stored as the
# other. Declaring only the per-row set under a name that reads like the
# record's is how a step-4 author validates `record["status"]` against it and
# rejects every good record.
# `partial` — the axes answered but at least one SUBJECT call did not. It is
# not an answer (`ANSWERED_STATUSES` excludes it), so it is never published
# and the next run re-asks it. Stored as `ok` instead, one transient timeout
# on one chunk left those subjects unscored for as long as the key held — and
# a record with no subjects at all then read as „the party is not in this
# article" on the archive, a false claim about a named party.
RECORD_STATUSES = frozenset({"ok", "partial", "failed", "no_subjects",
                             "would_generate"})

# The least body worth asking about. Below this the title and the subject block
# have eaten the state and the answer would be about a headline.
MIN_BODY_CHARS = 200

# How many subject TONES one call asks. A call carries at most 8 questions
# (`jev_client.LIMITS`) and the first subject call also spends one on
# `primary_subject`, so six keeps every call inside the limit with room.
TONES_PER_CALL = 6

# How many subjects an article is scored for, across as many calls as that
# takes.
#
# ⚠️ IT WAS SIX — ONE CALL'S WORTH — AND THAT CAP IS WHAT HID PARTIES. The
# cap ranks subjects by mentions, so on a crowded article a party named twice
# lost its slot to people named twice. Measured on the ПП-ДБ archive: in all 8
# rows the party was absent from the stored record, every one of them had
# dropped subjects (up to 10 of 16), and the party page then had no score for
# an article about the party. The cost of the fix is one more call on the
# ~11% of articles with more than six subjects. 18 is three calls; a record
# still names what it dropped past that.
#
# ⚠️ CHANGING THIS INVALIDATES STORED RECORDS, and so does any change to how
# mentions are counted (`jev_text`): both the subject list and each subject's
# `mentions` are part of `sentiment_key`. Every article whose kept list moves
# is refused by `current_for` until it is re-asked — PAID — and until then its
# article page carries no Jev block and its archive rows read `not_scored`.
# Measured when this went from 6 to 18 alongside the separator fix: 1,181
# records, re-asked for $1.056.
MAX_SUBJECTS = 18

# `jev_client.LIMITS["state_chars"]`, restated for the same reason
# `jev_scales.MAX_SCORE_LEVELS` is — this module must stay importable without
# the network client. `test_jev_sentiment` asserts the two agree.
#
# ⚠️ THIS IS THE POINT OF THE WHOLE PASS. The GLM runner sends the first
# `build_prompts.MAX_BODY_CHARS` (6,000) characters, and 9.93% of articles are
# longer — on those the analysis is a scoped observation and `rollup_eligible`
# drops it from the party rollups entirely. At 24,000 that falls to 0.41%.
MAX_STATE_CHARS = 24000


class JevSentimentError(ValueError):
    """A record that cannot be built. Never returned as a value."""


# ─── subjects ────────────────────────────────────────────────────────────────

def subjects_for(analysis: dict, article: dict) -> tuple:
    """`(kept, total)` — the article's subjects with their Tier-1 facts.

    A subject is a party or a person `entities` names. Ordered by how much of
    the article is about them (mentions, then the title, then the corpus's own
    order) so the cap drops the least-mentioned rather than the last-listed.

    ⚠️ ORDER IS NOT COSMETIC WHEN A CAP FOLLOWS IT. `person_tones` sorts by
    surface count for the same reason: dropping by list position discards
    whichever entity the model happened to name last.

    ⚠️ A SURFACE IS NOT AN IDENTITY. These are the names the model wrote, not
    resolved ids — `person_tones`' refusal 1 ("no identity, no public tone")
    does NOT hold here and is not claimed. Two people sharing a name share a
    subject row, so nothing downstream may attribute one of these scores to a
    registry person without resolving it first.
    """
    kept, total, _ = ranked_split(analysis, article)
    return kept, total


def ranked_split(analysis: dict, article: dict) -> tuple:
    """`(kept, total, dropped)` from ONE ranking — `dropped` as
    `[{"kind", "name"}]`, the identity `attach_sentiment` joins on.

    ⚠️ ONE PASS. Calling `subjects_for` and then ranking again counts every
    mention twice on exactly the crowded articles the cap exists for.
    """
    ordered = _ranked_subjects(analysis, article)
    return (ordered[:MAX_SUBJECTS], len(ordered),
            [{"kind": r["kind"], "name": r["name"]}
             for r in ordered[MAX_SUBJECTS:]])


def _ranked_subjects(analysis: dict, article: dict) -> list:
    """Every subject, ranked — the ONE ranking the cap and its report share.

    ⚠️ ONE LOOP. `dropped_subjects` needs the tail this ranking cuts, and a
    second copy of it would drift: a name counted one way here and another way
    there is a subject reported dropped that was in fact scored.
    """
    entities = (analysis or {}).get("entities") or {}
    title = str((article or {}).get("title") or "")
    body = str((article or {}).get("content") or "")
    haystack = f"{title}\n{body}"
    rows, seen = [], set()
    for kind in SUBJECT_KINDS:
        bucket = "parties" if kind == "party" else "people"
        names = entities.get(bucket)
        # ⚠️ A STRING IS ITERABLE. `{"parties": "ГЕРБ"}` would otherwise
        # produce four single-character subjects, and a dict would iterate its
        # keys — both are silent fabrication rather than a crash.
        if isinstance(names, str) or not isinstance(names, (list, tuple)):
            continue
        for name in names:
            if not isinstance(name, str) or not name.strip():
                continue
            name = normalize_surface(name)
            key = (kind, name.casefold())
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "name": name,
                "kind": kind,
                "mentions": count_mentions(name, haystack, kind=kind),
                "in_title": count_mentions(name, title, kind=kind) > 0,
            })
    return sorted(
        rows, key=lambda r: (-r["mentions"], not r["in_title"], r["kind"], r["name"]))


def dropped_subjects(analysis: dict, article: dict) -> list:
    """`[(kind, name)]` for the subjects past `MAX_SUBJECTS`, in rank order."""
    return [(d["kind"], d["name"]) for d in ranked_split(analysis, article)[2]]


def normalize_surface(name: str) -> str:
    """Collapse internal whitespace so „Иван  Иванов" is one surface, not two."""
    return " ".join(str(name).split())


def surfaces_of(name: str) -> tuple:
    """Every form of this subject the article may use.

    ⚠️ THE CANONICAL NAME ALONE IS NOT ENOUGH, and this is measured. `entities`
    carries „Росен Желязков" while Bulgarian articles use the surname after
    first reference — so a verbatim count returns 0, `derive_role` called it
    `incidental`, and refusal 2 then gave the subject NO TONE AT ALL. Measured
    over 7,782 subject rows: 148 score zero on the canonical string, 52 of them
    recoverable from a surface the article actually uses.

    `person_tones` does not have this defect because it ranks on
    `mention_refs` — every surface that resolved to the identity. This module
    has no resolver, so it derives the surfaces instead.

    ⚠️ ONLY PARTS LONG ENOUGH TO BE A NAME. A two-letter fragment matches
    half the language, and an initial („А." in „А. Б. Иванов") matches nothing
    useful, so parts under four characters are dropped rather than counted.
    """
    name = normalize_surface(name)
    if not name:
        return ()
    forms = [name]
    parts = [p.strip("„“\"'()[]") for p in name.split(" ")]
    for part in parts:
        if len(part) >= 4 and part.casefold() != name.casefold():
            forms.append(part)
    # A quoted party name („Лига") is the same subject as the bare one.
    stripped = name.strip("„“\"'«»")
    if stripped and stripped.casefold() != name.casefold():
        forms.append(stripped)
    out, seen = [], set()
    for form in forms:
        key = form.casefold()
        if form and key not in seen:
            seen.add(key)
            out.append(form)
    return tuple(out)


def count_mentions(name: str, haystack: str, *, kind: str = "party") -> int:
    """How many times the article names this subject, by any of its surfaces.

    ⚠️ WHOLE-WORD, through the ONE boundary class in `jev_text.py`: „Иван" must
    not count inside „Иванов", and a plain `str.count` would. The boundary is
    spelled for Cyrillic — `\b` is ASCII-only and never matches after a
    Cyrillic letter, so it reports 0 for every Bulgarian surface.

    ⚠️⚠️ THE INFLECTIONAL TAIL IS FOR PARTIES ONLY, AND THAT IS NOT A
    SIMPLIFICATION — IT IS THE WHOLE REASON THE RULE IS SAFE. A party takes the
    Bulgarian definite article („Възраждането" is „Възраждане"), so a tail is
    the same surface. A PERSON name does not, and allowing one there
    reintroduces the exact defect the word boundary exists to prevent:
    „Иван" + a three-letter tail matches „Иванов", so every article about one
    man would count as an article about another. Measured: with tails on
    people, „Иван" scores 2 on „Иван Иванов"; without, 1.

    Positions are counted once: a longer surface and a shorter one that overlaps
    it („Росен Желязков" and „Желязков") must not both score the same words.
    """
    if not name or not haystack:
        return 0
    allow_tail = kind == "party"
    spans = set()
    for surface in surfaces_of(name):
        for match in jt.mention_matches(surface, haystack, allow_tail=allow_tail):
            spans.add(match)
    # Drop a span contained in a longer one, so an overlap counts once.
    kept = [a for a in spans
            if not any(b != a and b[0] <= a[0] and a[1] <= b[1] for b in spans)]
    return len(kept)


def derive_role(subject: dict, *, is_primary: bool) -> str:
    """`primary` · `secondary` · `incidental` — the deterministic half.

    ⚠️ `incidental` IS MECHANICAL AND `primary` IS A JUDGEMENT. A subject named
    once and absent from the title is being mentioned in passing, which no
    model needs to decide; which of several substantial subjects the article is
    ABOUT is exactly what a model is for, and it arrives as `is_primary` from
    one `choice` question covering the whole article.

    `primary` wins over the incidental test deliberately: if the model says the
    article is about this subject, one mention is a fact about our counting,
    not about the article.

    ⚠️ ZERO MENTIONS IS "WE COULD NOT COUNT IT", NOT "NAMED IN PASSING", and
    the difference decides whether a subject is assessed at all. Measured: 148
    of 7,782 subject rows score zero while the article does name the subject.
    Reading that as `incidental` publishes nothing about a subject nobody
    assessed — the failure direction refusal 2 must not cause. It errs the
    other way instead, and the count is recorded so the case stays visible.
    """
    if is_primary:
        return "primary"
    mentions = subject.get("mentions", 0)
    if not isinstance(mentions, int) or mentions <= 0:
        return "secondary"
    if mentions <= 1 and not subject.get("in_title"):
        return "incidental"
    return "secondary"


# ─── the record ──────────────────────────────────────────────────────────────

def sentiment_key(article: dict, subjects: list) -> str:
    """The cache key: everything that can change the answer.

    ⚠️ THE ARTICLE'S CONTENT DIGEST IS IN IT, via the same
    `aa.evidence_snapshot` the analysis layer uses. A re-extracted article
    moves the digest and the record is refused rather than re-pointed at
    different words — the property that makes a stored score outlive nothing
    it was made about.

    ⚠️ AND SO ARE THE TIER-1 FACTS, WHICH IS THE LESS OBVIOUS HALF. `mentions`
    and `in_title` are SHOWN to the model and decide the role, so a change to
    how they are counted is a change to the question. Without them a
    `count_mentions` fix would leave every stored record current with the old
    counting behind it — "a stale record served as current", which refusal 1
    claims to prevent. `MAX_STATE_CHARS` is in for the same reason: it decides
    how much of the article was read.
    """
    _, _, digest = aa.evidence_snapshot(article)
    payload = json.dumps([
        RUBRIC_VERSION, RECORD_VERSION, ax.AXES_VERSION,
        js.SCALE_CONTRACT_VERSION, MAX_STATE_CHARS, digest,
        [[s["kind"], s["name"], s.get("mentions"), bool(s.get("in_title"))]
         for s in subjects],
    ], ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def text_scope_for(article: dict, *, truncated: bool) -> dict:
    """What JEV actually saw, in `aa.text_scope_of`'s shape.

    ⚠️ NOT `aa.text_scope_of(analysis, article)` WITH THE ANALYSIS RECORD —
    that reads `analysis_provenance.max_body_chars`, which is the GLM runner's
    6,000-character prefix. Using it here would badge a 10,000-character
    article Jev read IN FULL as a `prefix` of 6,000, and a 30,000-character one
    Jev read 24,000 of as 6,000 too — making the entire point of this pass
    (9.93% of articles exceed 6,000; 0.41% exceed 24,000) invisible in the
    badge that exists to show it.
    """
    return aa.text_scope_of(
        {"analysis_provenance": {"max_body_chars": MAX_STATE_CHARS,
                                 "body_truncated": bool(truncated)}},
        article)


def check_subject_budget(subjects: list) -> None:
    """Refuse more subjects than the pass scores for one article.

    ⚠️ ONE MESSAGE, ONE PLACE. The state builder and the question builder both
    need this and both had their own copy. The PER-CALL question budget is a
    separate rule (`TONES_PER_CALL`), enforced where a call's questions are
    built.
    """
    if len(subjects) > MAX_SUBJECTS:
        raise JevSentimentError(
            f"{len(subjects)} subjects exceeds the {MAX_SUBJECTS}-subject budget")


def state_for(article: dict, subjects: list) -> tuple:
    """`(state, truncated)` — the structured state Jev is asked about.

    ⚠️ STRUCTURED, WITH THE FIELDS THE QUESTIONS NAME. The instructions in
    `jev_axes` refer to `body`, `title` and `subjects` by name, which is how
    one call asks about several subjects without repeating the text. The
    Tier-1 facts ride along so the model has the prominence signal without
    spending a question on it.
    """
    check_subject_budget(subjects)
    title = str((article or {}).get("title") or "")
    body = str((article or {}).get("content") or "")
    state = {
        "title": title,
        "body": "",
        "subjects": [
            {"i": i, "name": s["name"], "kind": s["kind"],
             "mentions": s["mentions"], "in_title": s["in_title"]}
            for i, s in enumerate(subjects)
        ],
    }
    state["body"], truncated = _fit_body(state, body, MAX_STATE_CHARS)
    return state, truncated


def _fit_body(state: dict, body: str, cap: int) -> tuple:
    """The largest prefix of `body` whose SERIALIZED state fits `cap`.

    ⚠️ JSON ESCAPING EXPANDS THE BODY, so a cap applied to the RAW length
    overflows by one character per escapable one — and real article bodies are
    full of newlines. Measured: 52 of the 53 articles long enough to truncate
    produced a state over 24,000 characters, worst +650.
    `jev_client.build_payload` refuses that as `invalid_state`, which its own
    contract classifies as OUR bug rather than an outage.

    A fixture of `"я" * N` cannot catch this — it has nothing to escape — so
    the regression test uses a body carrying quotes and newlines.
    """
    def size(n: int) -> int:
        return len(json.dumps({**state, "body": body[:n]}, ensure_ascii=False))

    if size(len(body)) <= cap:
        return body, False
    empty = size(0)
    if empty > cap:
        raise JevSentimentError(
            f"no room for a body: {empty} chars of title and subjects")
    # Invariant: size(lo) <= cap < size(hi).
    lo, hi = 0, len(body)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if size(mid) <= cap:
            lo = mid
        else:
            hi = mid
    if lo < MIN_BODY_CHARS:
        raise JevSentimentError(
            f"only {lo} chars of body fit — the title and subjects leave too "
            f"little to judge an article by")
    return body[:lo], True


def empty_record(article: dict, *, status: str, reason=None,
                 subjects_total: int = 0, subjects_dropped: int = 0,
                 subjects_dropped_names=None) -> dict:
    """A record that carries no scores, and says why."""
    if status not in RECORD_STATUSES:
        raise JevSentimentError(f"unknown record status {status!r}")
    return {
        "version": RECORD_VERSION,
        "rubric_version": RUBRIC_VERSION,
        "axes_version": ax.AXES_VERSION,
        "contract_version": js.SCALE_CONTRACT_VERSION,
        "url": (article or {}).get("url"),
        "sentiment_key": None,
        "status": status,
        "reason": reason,
        "model": None,
        "state_chars": None,
        "truncated": None,
        "text_scope": None,
        "axes": {},
        "subjects": [],
        "subjects_total": subjects_total,
        "subjects_dropped": subjects_dropped,
        # ⚠️ WHICH ones, not only how many. „Not in `subjects`" is otherwise
        # two different facts — not in the article, or past the cap — and a
        # page that reads the first when it is the second tells a reader a
        # party is not in an article that is about it.
        "subjects_dropped_names": list(subjects_dropped_names or []),
        "generated_at": aa.now_iso(),
    }


# ─── storage ─────────────────────────────────────────────────────────────────

def sentiment_dir(data_dir) -> Path:
    return Path(data_dir) / "analysis" / "sentiment"


def path_for(url: str, data_dir) -> Path:
    # ⚠️ REFUSES AN EMPTY URL rather than hashing it: every url-less record
    # would otherwise collide on one sidecar and overwrite each other, which
    # looks like a cache hit for an unrelated article.
    if not url or not str(url).strip():
        raise JevSentimentError("a record needs a url to be stored under")
    return sentiment_dir(data_dir) / f"{jt.article_key(url)}.json"


def cached(url: str, data_dir):
    try:
        path = path_for(url, data_dir)
    except JevSentimentError:
        return None
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # An unreadable sidecar is nothing, never a partial claim.
        return None
    # Valid JSON that is not an object is the same kind of nothing.
    return doc if isinstance(doc, dict) else None


# A record that ANSWERED something. ⚠️ `failed` is deliberately absent:
# see `current_for`.
ANSWERED_STATUSES = frozenset({"ok", "no_subjects"})


def versions_current(doc) -> bool:
    """Do this record's four version stamps match the code now running?

    ⚠️ ONE DEFINITION, TWO CALLERS, AND THE SECOND ONE GOT IT WRONG. The
    publication gate re-implemented this filter and kept ONE of the checks
    (`status`), so a record the store itself refuses as stale published
    verbatim onto a party page and reported a clean attach. Every consumer of
    a stored record asks the same question and must ask it here.

    ⚠️ IT DOES NOT CHECK THE CONTENT DIGEST, and cannot: the digest lives in
    `sentiment_key`, which is a function of the ARTICLE, and a consumer that
    holds only the record has no article to hash. `current_for` — the producer
    side, which does hold one — is the only place that check can happen, and it
    is why the ask re-asks rather than the publisher re-deciding. The residual
    case is an article re-extracted since the last ask: its record is version
    -current and points at words that have moved, and only running the pass
    again clears it.
    """
    return (isinstance(doc, dict)
            and doc.get("version") == RECORD_VERSION
            and doc.get("rubric_version") == RUBRIC_VERSION
            and doc.get("axes_version") == ax.AXES_VERSION
            and doc.get("contract_version") == js.SCALE_CONTRACT_VERSION)


def answered(doc) -> bool:
    """A record that is current AND said something. The publication filter."""
    return versions_current(doc) and doc.get("status") in ANSWERED_STATUSES


def current_for(article: dict, analysis: dict, data_dir):
    """The stored record for THIS article and THIS subject set, or None.

    ⚠️⚠️ A `failed` RECORD IS NOT CURRENT, AND THIS IS THE DIFFERENCE BETWEEN
    A CACHE AND A SCAR. A failed record says "we asked once and the network
    did not answer" — it is a log of an attempt, not an answer — so treating
    it as current makes one transient outage permanently remove those articles
    from the corpus: every later healthy run reports them `cached` and never
    re-asks, and the only escape is `--force`, which re-pays for everything.
    Measured on an injected outage before this check existed.
    """
    doc = cached((article or {}).get("url") or "", data_dir)
    if not answered(doc):
        return None
    subjects, _ = subjects_for(analysis, article)
    if doc.get("sentiment_key") != sentiment_key(article, subjects):
        return None
    return doc


def store(record: dict, data_dir) -> Path:
    """Write one record beside the analysis.

    ⚠️ ATOMIC, through the same `aa.write_json_atomic` `person_tones` uses: a
    plain write truncates the destination first, so an interrupted batch
    replaces a valid record with half of one.

    ⚠️ The sidecar tree is the whole footprint of this pass — the 8,925
    analysis records are never touched, so the phase is reversible by deleting
    a directory.
    """
    path = path_for(record.get("url") or "", data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    aa.write_json_atomic(str(path), record)
    return path
