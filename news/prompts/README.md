# Prompt assets for the standalone runner

These files exist because **the branching logic lived in a SKILL, not in
code**. `analyze-news-article/SKILL.md` is 262 lines of prose that an agent
reads; a Mac mini running a 12B model at 03:00 has no agent. So the decision
procedure became `news/scripts/analyze_local.py`, and only the rubric — the
part that is genuinely a judgment brief — stayed as prompt text.

| file | what | source of truth |
| --- | --- | --- |
| `analyze_system.md` | the rubric | derived from `SKILL.md`, kept in step by `scripts/test_prompts.py` |
| `analyze_schema.gbnf` | grammar-constrained output | GENERATED from the record schema — never hand-edited |
| `taxonomy_compact.json` | labels only | GENERATED from `news/topics.json` |

⚠️ **Two of the three are generated, and editing them by hand is the failure
mode this table exists to prevent.** Run `python3 news/scripts/build_prompts.py`
after changing `news/topics.json` or the record schema in
`analyze_articles.py`; `test_prompts.py` fails when they drift.

⚠️ **The grammar is worth more than the choice of model.**
`analyze_articles.py` rejects a WHOLE record on any schema or taxonomy
violation, and a 12B asked to free-form nested JSON with enum labels will trip
that gate often enough to matter. GBNF makes an invalid label unrepresentable
rather than merely rejected afterwards.
