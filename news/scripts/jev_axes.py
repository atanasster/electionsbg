#!/usr/bin/env python3
"""WHAT we ask Jev — the axes, their anchors and their instructions.

Depends on `jev_scales`, never the other way round: that module is the
arithmetic and must stay importable without any rubric text. `decode_score`
therefore takes `axes_version` as an argument rather than importing it.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` §3.4. Separated from
`jev_scales.py` on purpose: that module is arithmetic nobody should need to
re-read, this one is rubric text that will be revised. The anchors ARE the
question — `jev_client._score_criteria` refuses an empty level because a
`score` with no rubric is a billed call that cannot place anything.

⚠️ `not_applicable` IS NOT A LEVEL, AND THIS IS THE MOST LOAD-BEARING
DECISION IN THE FILE. Measured over 8,925 records: **57.1% of articles have
`leaning: not_applicable` and 87.7% have `russia_stance: not_applicable`.**
That is a statement that the question does not arise, not a position on the
axis — so putting it on the scale would drag 87.7% of the corpus onto
"neutral about Russia" when those articles are SILENT about Russia, and every
mean over the axis would be a mean over mostly-absent subject matter. Each
article axis is therefore TWO questions: a `noul` asking whether the axis
arises at all, and the `score` placing it. `noul` returns a probability, so
"silent" and "balanced" stop being the same value — which is the distinction
`storyDivergence.ts` already insists on for the label form.

⚠️ SUBJECT TONE GETS NO SUCH GATE. A subject is in the article or it is not;
its absence is answered by not asking, not by a probability.
"""
from __future__ import annotations

from jev_scales import Scale

AXES_VERSION = 1

# ⚠️ THE ORDER IS THE SITE'S, NOT A NEW ONE. `labels.ts` already exports
# `LEANING_ORDER` and `RUSSIA_ORDER` in exactly this sequence and
# `SpectrumBar.tsx` already draws them. Re-ordering here would silently flip
# every existing record's meaning when the two corpora are compared, which is
# the whole point of Phase 0.
LEANING = Scale(
    "leaning",
    ("strong_progressive", "progressive", "neutral", "conservative", "strong_conservative"),
    (
        "Материалът застъпва подчертано прогресивна позиция — защитава разширяване "
        "на права, климатични или социални политики, и представя опонентите им критично.",
        "Материалът клони към прогресивна позиция, без да е застъпнически.",
        "Материалът не заема страна по прогресивно-консервативната ос.",
        "Материалът клони към консервативна позиция, без да е застъпнически.",
        "Материалът застъпва подчертано консервативна позиция — защитава традиционни "
        "ценности, национален суверенитет или ограничаване на права, и представя "
        "опонентите им критично.",
    ),
)

RUSSIA_STANCE = Scale(
    "russia_stance",
    ("strong_pro_russia", "pro_russia", "neutral", "anti_russia", "strong_anti_russia"),
    (
        "Материалът застъпва руската гледна точка — възпроизвежда я безкритично "
        "или атакува критиците ѝ.",
        "Материалът клони към руската гледна точка.",
        "Материалът не заема страна по отношението към Русия.",
        "Материалът клони към критична към Русия позиция.",
        "Материалът застъпва подчертано критична към Русия позиция.",
    ),
)

# ⚠️ THESE FIVE LABELS ARE A VOCABULARY EXTENSION, NOT A REUSE. The site's
# tone vocabulary was four NOMINAL labels (`favorable · neutral · unfavorable ·
# mixed`), and `mixed` is not a point on an axis — it is derived from the
# distribution (`jev_scales.both_directions`). So the ordinal form is the other
# three, each side split into a plain and a strong degree, mirroring what
# `LEANING_META` / `RUSSIA_META` (NOT `TONE_META`) already do for the two
# ordinal axes. `strongly_favorable` / `strongly_unfavorable` therefore had to
# be ADDED to `newsapp/app/data.ts` and `labels.ts`; until they were, this scale
# emitted a bucket label that no `.ts` file contained and the chip would have
# rendered blank. `test_every_display_label_exists_in_the_typescript_vocabulary`
# is what keeps the two sides in step.
SUBJECT_TONE = Scale(
    "subject_tone",
    ("strongly_unfavorable", "unfavorable", "neutral", "favorable", "strongly_favorable"),
    (
        "Рамката на изданието е враждебна към субекта — подигравка, обвинение "
        "или дискредитиране в авторския текст или в заглавието.",
        "Рамката на изданието е неблагоприятна за субекта.",
        "Материалът представя субекта без благоприятна или неблагоприятна рамка.",
        "Рамката на изданието е благоприятна за субекта.",
        "Рамката на изданието е подчертано благоприятна — материалът застъпва "
        "каузата на субекта или го хвали.",
    ),
)

# ⚠️ THE VOICE AND TARGET CONTROLS LIVE HERE NOW, AND NOWHERE ELSE.
# Dropping the verbatim-quote contract (plan §4) removed the `voice` field the
# old gate could have checked, so these two rules are no longer enforceable by
# any gate and survive only as instruction text. Both are measured defects, not
# hypotheticals:
#   • voice — 23 of 112 published positioned tones (21%) rested SOLELY on
#     quoted speech; in the actualno/Минчев row the quoted speaker was the
#     party's own MEP, and the model's rationale said "рамката следва неговите
#     оценки" in as many words;
#   • target — in the pik.bg/Гюров row the outlet's hostility is aimed at a
#     PERSON and "ПП-ДБ" appears once in the whole article, inside a Facebook
#     commenter's quote.
# Both articles are named Phase 0 regression cases for exactly this reason.
SUBJECT_TONE_INSTRUCTIONS = (
    "Оцени как `body` и `title` представят субекта, посочен в `subjects`.\n"
    "Оценяваш РАМКАТА НА ИЗДАНИЕТО, не субекта и не мненията, които материалът цитира.\n"
    "Цитирана похвала или цитирано нападение от друг говорител — включително от "
    "самия субект или от негов представител — НЕ е рамка на изданието. Материал, "
    "който предава изявление без собствена оценка, е неутрален.\n"
    "Не приписвай на партия отношението към неин кандидат, депутат или представител: "
    "ако авторският текст напада човек, а партията е спомената само мимоходом или "
    "само в чужд цитат, рамката към ПАРТИЯТА е неутрална."
)

LEANING_INSTRUCTIONS = (
    "Заема ли `body` страна по прогресивно-консервативната ос? "
    "Оценяваш рамката на изданието, не цитираните мнения."
)

RUSSIA_INSTRUCTIONS = (
    "Каква позиция заема `body` по отношение на Русия? "
    "Оценяваш рамката на изданието, не цитираните мнения."
)

# The `noul` gates (§3.3). Phrased as the question whose answer is a
# probability — "does this arise", never "is this neutral".
LEANING_APPLIES_INSTRUCTIONS = (
    "Засяга ли `body` изобщо вътрешнополитически спор, по който може да се "
    "заеме прогресивна или консервативна позиция? Отговори с вероятност."
)

RUSSIA_APPLIES_INSTRUCTIONS = (
    "Засяга ли `body` изобщо Русия, руската политика или войната в Украйна, "
    "така че материалът да може да заеме позиция? Отговори с вероятност."
)

PRIMARY_SUBJECT_INSTRUCTIONS = (
    "Кой от изброените в `subjects` е ГЛАВНИЯТ субект на материала — този, "
    "за когото материалът е? Ако материалът не е за никого от тях, избери `none`."
)

# One entry per article axis: the applicability gate and the scale it gates.
ARTICLE_AXES = (
    {"id": "leaning", "scale": LEANING,
     "instructions": LEANING_INSTRUCTIONS,
     "applies_id": "leaning_applies",
     "applies_instructions": LEANING_APPLIES_INSTRUCTIONS},
    {"id": "russia_stance", "scale": RUSSIA_STANCE,
     "instructions": RUSSIA_INSTRUCTIONS,
     "applies_id": "russia_applies",
     "applies_instructions": RUSSIA_APPLIES_INSTRUCTIONS},
)

# ⚠️ PHASE 0's COMPARISON ARM, and it is not a candidate for production.
# `jev-benchmark-2026-09-20.md` finding 2 measured that MORE options made the
# COARSE answer better (+15.3 points on category, and far better calibrated),
# which is the opposite of the intuition that fewer anchors are easier — so the
# plan (§3.2) refuses to settle 5-vs-9 by argument and scores both over the
# same articles. These labels are synthetic (`l-4`…`l4`): there is no 9-label
# vocabulary on the site, and `jev_scales.bucket_label` REFUSES a non-5-label
# scale for that reason — a 9-anchor run is bucketed through the display scale
# it is being compared against, never through its own anchors.
SUBJECT_TONE_9 = Scale(
    "subject_tone_9",
    tuple(f"l{i - 4}" for i in range(9)),
    (
        "Материалът напада субекта директно — обвинение, подигравка или дискредитиране.",
        "Рамката е враждебна.",
        "Рамката е ясно неблагоприятна.",
        "Рамката е леко неблагоприятна.",
        "Материалът представя субекта без оценъчна рамка.",
        "Рамката е леко благоприятна.",
        "Рамката е ясно благоприятна.",
        "Рамката е подчертано благоприятна.",
        "Материалът застъпва каузата на субекта — хвали го или го защитава открито.",
    ),
    # No 9-label vocabulary exists on the site, and none is wanted: this arm is
    # bucketed through the 5-label display scale it is compared against.
    renderable=False,
)

ANCHOR_VARIANTS = {5: SUBJECT_TONE, 9: SUBJECT_TONE_9}

# The scales whose labels the CLIENT draws. `jev_scales.bucket_label` refuses
# anything not marked `renderable`, and the test below asserts every label here
# exists in `newsapp/app/labels.ts` — the check that a label COUNT could not make.
DISPLAY_SCALES = (LEANING, RUSSIA_STANCE, SUBJECT_TONE)
