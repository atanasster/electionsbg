# Evaluation contract fixtures

Each fixture is a language-neutral envelope consumed unchanged by the Python and TypeScript
validators. `value` is validated against `schema_target`; `task` and `records` are semantic
context and are never part of the public payload.

`expected.schema_valid` covers JSON Schema. `expected.semantic_valid` covers invariants that
need task or dataset context. `expected.gold_eligible` is separate: a valid public observation
or partial editorial correction can be useful without being complete enough for gold.

Digests are deliberately synthetic. Hash-mismatch fixtures test binding behavior, not the hash
helper itself; canonical serialization vectors are added in the following plan step.
