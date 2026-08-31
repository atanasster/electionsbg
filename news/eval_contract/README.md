# News article evaluation contract

This directory is the language-neutral v1 contract shared by the public TypeScript API and
the offline Python news pipeline. `contract.json` is the registry of canonical values and
limits. The JSON Schemas distinguish the untrusted public submission request from the normalized
stored article evaluation, and also define an immutable operator event and versioned dataset
manifest.

The contract deliberately preserves the analysis vocabulary already used by the corpus.
Product copy may describe `progressive` as liberal/progressive, but persisted values must not
be renamed. Russia stance has its own six-value scale. Party tone is categorical and applies
to an article-party pair.

## Trust boundary

- A public submission is an untrusted community observation, not a correction or gold label.
- Only a local maintainer workflow may adjudicate or promote a submission.
- A complete evaluation explicitly assesses both scalar axes and the full meaningful party
  set. An empty `party_tones` array means “no meaningful party,” not “party work omitted.”
- The public request contains selected labels but no model-relative dispositions. The backend
  derives `confirmed`, `changed`, `added` and `unable_to_judge` against the hidden task snapshot
  before validating and storing `article_evaluation.schema.json`.
- Ambiguous party names may use a null `party_id`; the system must never guess an identity.
- Full article text, raw network identifiers, Turnstile tokens, browser IDs and abuse hashes
  are outside this contract and must never enter public or gold datasets.

## Versioning and hashes

Every boundary uses lowercase `sha256:<hex>` digests. Dataset entries bind a URL and content
hash; an analysis hash is optional only when no model analysis existed at selection time.
Changing a stored article's content invalidates an adjudication until it is revalidated. A
model rerun alone does not invalidate a human decision about unchanged content.

Canonical records use sorted object keys, UTF-8 Unicode-scalar strings, Unicode code-point
length and the ECMAScript JSON number spelling. Unpaired UTF-16 surrogates are rejected in
values, object keys and article content. Integer-valued numbers outside JavaScript's safe range
(`±(2^53-1)`) are rejected instead of being rounded differently by Python and TypeScript.
Party surface keys use trim + NFC + locale-independent lowercase in both runtimes.
`canonical.py` and `canonical.ts` are the only hashing implementations; the validators and
pipeline callers import them rather than maintaining another serializer.

Schemas use JSON Schema draft 2020-12. Dataset manifests bind both selection inputs and the
ordered frozen label records, and require a group ID for every split assignment. Semantic checks
that JSON Schema cannot express—such as duplicate canonical party IDs, scope-correct reason
codes, model-relative dispositions, matching statistics, and group leakage across dataset
splits—belong in the matching Python and TypeScript validators.

The `uri` format is deliberately narrower than generic JSON Schema URI: public source URLs
must be absolute HTTP(S) URLs without whitespace or embedded credentials. Timestamps use the
RFC 3339 calendar form `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)` with real calendar dates.
Manifest entries and frozen records are positionally linked by `article_key` and by content or
analysis hashes whenever the record carries them; neither side may contain a duplicate key.
The public HTTP boundary derives its request limit from `limits.public_request_bytes`, rejects every
recognized route above that UTF-8 byte count before route-specific handling, and rejects any body on
aggregate GET requests. Article-key domains use lowercase ASCII DNS labels (canonical `xn--`
punycode is supported), with the DNS label and 253-character hostname limits enforced.
