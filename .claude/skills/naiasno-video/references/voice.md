# Voice — Bulgarian TTS and the verbalization rules

Load when writing any `voiceOver`, or when choosing/configuring a TTS provider.
Rationale and the provider comparison: `docs/plans/explainer-video-v1.md` §2.

## The voice is decided — use it

**`gemini` · `Rasalgethi` · `gemini-3.1-flash-tts-preview`.** Phase 0 closed
2026-08-08; the constant is `CHOSEN_VOICE` in `scripts/video/tts_bakeoff.ts`.

Put it in every spec's `voice` block and **do not vary it between videos** — a
channel that changes narrator reads as unserious. It needs no GCP setup: it runs
on the `GEMINI_API_KEY` already in `.env.local`.

Chirp 3 HD stays configured and is the fallback (30 bg-BG voices, `speaking_rate`
control, ~16% faster). To put a challenger next to the incumbent on the same six
facts:

```bash
npm run video:bakeoff -- --only=Rasalgethi,<challenger> --variants=spoken
```

## The rule that drives everything

**Every number in the voice track is spelled out in Bulgarian words. Digits and
symbols stay on screen only.**

```
onScreen:  "€1,2 млрд."
voiceOver: "един цяло и два милиарда евро"
```

**Confirmed by listening test, not assumed** (Rasalgethi, 2026-08-08): the same six
facts as `spoken` sound natural; as `raw` they are **audibly accelerated**.

The failure mode is **pacing, not pronunciation** — and that is the part worth
remembering, because it is the harder one to catch. Handed digits, the engine
compresses them and rushes; nothing in the output is identifiably *wrong*, it simply
does not sound like a person. A reviewer scanning for a mangled number will pass it.

Two reinforcing reasons the rule is not merely stylistic: `bg-BG` has **no
pronunciation override** on any provider we would use — no `<phoneme>`, no
`<say-as>`, no lexicon — so rewriting the text is the only correction lever that
exists; and spelling numbers out lets a human verify the spoken form by *reading* it
at gate 1, before any audio is generated.

`scripts/video/passage.ts` holds six worked `raw` → `spoken` pairs built from real
published facts. **Read it rather than re-deriving the patterns** — it is the
canonical reference and it is covered by tests.

## What breaks if you hand digits to the engine

| Case | Trap | Write instead |
|---|---|---|
| **Decimal comma** | `6,79 €` read as a pause or a thousands separator | «шест цяло седемдесет и девет евро» |
| **Leading symbol** | `€1,2 млрд.` — a symbol *before* the number is the shape engines most often mishandle | «един цяло и два милиарда евро» |
| **Abbreviated scale** | `млн.` / `млрд.` spelled as letters | «милиона» / «милиарда», inflected |
| **Gender agreement** | Bulgarian inflects 1 and 2 by the noun's gender | «два договора» (m) vs «две поръчки» (f) |
| **Count form** | masculine plural after a numeral | «5 договора», never «договори» |
| **Ordinal year** | `2024 г.` as «две нула две четири» | «две хиляди двайсет и четвърта година» |
| **Percent decimals** | `43,4%` | «четирийсет и три цяло и четири процента» |
| **Identifiers** | `ЕИК 000695089` read as a number — and the leading zeros vanish | digit by digit: «нула нула нула шест девет пет нула осем девет» |
| **Acronyms** | АОП / ДФЗ / КЗК mangled into nonsense words | letter-by-letter with spacing: «А О П», «Д Ф Зе», «К Зе К» |
| **Acronyms read as words** | ЦАИС ЕОП, НЗОК are pronounced as words, not letters | leave as-is; verify in the bake-off |

Note the last two rows disagree with each other on purpose: some Bulgarian acronyms
are letter-read and some are word-read, and no provider gets the split right by
default. The bake-off passage covers both.

## Stress is the one thing you cannot fix by rewriting

Bulgarian stress is not written. Place names (Ружинци, Неделино, Крушари, Малко
Търново, Самуил, Безмер) and surnames will be stressed however the model guesses,
and orthographic rewriting cannot reliably move it. This is the category with no
workaround at all.

**Consequence for topic choice:** a script that leans on an unusual place name is
taking a risk a script about a national aggregate is not. If a place name is central
and the model gets it wrong, the options are a different phrasing that avoids the
vocative position, a different provider, or a human read.

## How much text fits — measured, not estimated

Rasalgethi reads the 716-character `spoken` passage in **55.0 s** → **13.0 chars/s,
137 wpm**. Use it to size a script *before* synthesizing anything:

| Target | voiceOver budget | scenes | per scene |
|---|---|---|---|
| 30 s short | ~390 chars / ~70 words | 4 | ~100 |
| **40 s short** | **~520 chars / ~90 words** | 5 | **~105** |
| 50 s short | ~650 chars / ~115 words | 5–6 | ~115 |
| 90 s explainer | ~1 200 chars / ~205 words | 10 | ~120 |
| **12 min explainer** | **~9 400 chars / ~1 600 words** | 50–60 | **~160** |

A scene whose `voiceOver` overruns its per-scene budget will not fit the beat it was
written for. Rewrite the line rather than discovering it after the render. The
per-scene figure rises with total length because a long-form beat carries a whole
idea rather than a single number — but past ~260 characters (~20 s) a scene is
holding one canvas state for too long and wants splitting.

The spec declares its own window as `runtimeSeconds` and `npm run video:gate1`
enforces it. Length is a property of the VIDEO, not of the format.

Note this is the **`spoken`** rate — the whole point of the rule above is that
`spoken` runs *longer* than the same facts as digits (716 vs 433 chars here). Budget
from the spelled-out text, never from the on-screen figure.

## Provider state (verified 2026-08-08 — all figures measured, not documented)

| Provider | bg-BG | Notes |
|---|---|---|
| **Gemini** ⭐ **chosen** | **30 voices** (16 M / 14 F) | `gemini-3.1-flash-tts-preview`. **No GCP setup** — reuses `GEMINI_API_KEY`. Returns headerless L16 PCM (needs a WAV wrapper). No pace control. ~55 s on the passage. |
| Google Chirp 3 HD | **31** (30 HD + 1 Standard) | $30/1M chars, 1M/mo free. **No pause control, no custom pronunciation for `bg-bg`** — Google's own locale-exclusion tables. `speaking_rate` 0.25×–2× works. ~46 s on the passage (**~16% faster**). Enabled on project `elections-bg`. |
| Azure | **2** (`KalinaNeural`, `BorislavNeural`) | No HD variant, no styles, no multilingual. The reflexive choice and the weakest one. |
| ElevenLabs v3 | supported (`bul`) | ~10× Google's rate; quality on lower-traffic languages is uneven by the vendor's own framing. |
| **Human narrator** | — | Dissolves every problem on this page. ~€15–40 per short (estimate, needs real quotes). Cost is **latency**, not money — it breaks same-day publishing. |

**Tiering:** TTS for time-sensitive shorts, a human for evergreen long-form.

Worth knowing that Chirp 3 HD lost on ear despite winning on voice count, pace
control and speed. Do not re-litigate it from the table — re-litigate it by listening.

### Cloud TTS auth is not an API key

Chirp 3 HD **rejects API-key auth outright** — `401 · "API keys are not supported by
this API. Expected OAuth2 access token"`. There is no `GOOGLE_TTS_API_KEY` and its
absence is deliberate. Two operator steps, both already done for `elections-bg`:

```bash
gcloud services enable texttospeech.googleapis.com --project elections-bg
export GOOGLE_TTS_ACCESS_TOKEN=$(gcloud auth print-access-token)
export GOOGLE_CLOUD_PROJECT=elections-bg   # user creds carry no project → 403 without it
```

The token is short-lived; mint it in the same shell as the run.

## Re-running the bake-off

Phase 0 is closed, so this is now for **re-validation** — a provider ships a model, or
a voice grates after real scripts — not for selection.

```bash
npm run video:bakeoff -- --list                     # bg-BG voices per provider
npm run video:bakeoff -- --dry-run                  # passage + cost, no API calls
npm run video:bakeoff -- --only=Rasalgethi,<x> --variants=spoken   # challenger vs incumbent
npm run video:bakeoff -- --providers=google --gender=male --voices=6
```

It renders a blind compare page (Проба A/B/C) so the ear goes before the price list.
Drop a human recording in as `human__<name>__spoken.mp3` (or `.wav`/`.m4a`) and it
joins the comparison with no code change.

**The duration delta is a cheap pre-screen.** Both variants say the same words, so a
`raw` clip much shorter than its `spoken` twin means the engine swallowed the numbers
rather than reading them. Measured: Rasalgethi **−4.0 s** is already audible as
rushing; `bg-BG-Chirp3-HD-Achird` was **−16.0 s**. It varies *by voice within one
engine*, so it ranks candidates before you listen — it is not a production gate, since
only `spoken` is ever synthesized for a real video.

## Synthesis mechanics

- **One clip per scene, never one for the whole video.** `bg-bg` has no pause
  control, so every pause comes from the edit — and per-scene clips are what the
  composition measures its own duration from (`references/remotion.md`).
- **Trim silence adaptively.** TTS clips carry leading/trailing silence that makes
  cuts sag. Measure with `loudnorm=print_format=json`, take `input_thresh`, feed it
  to `silencedetect=noise=${thresh}dB:d=0.5`, apply as `trimBefore`/`trimAfter`.
  Use the measured threshold, not a fixed dB floor.
- **Keep the voice fixed across a series.** Store `voice.provider` + `voice.voiceId`
  in the spec. A channel that changes narrator between videos reads as unserious.
- **⚠️ Retry, and verify every clip exists before rendering.** Two transient
  failures were observed on 2026-08-08, and **both lose a scene's narration while the
  run still reports success**:
  - **HTTP 200 with an empty candidate** (`finishReason: "OTHER"`, no parts) instead
    of an error — roughly once in seven requests.
  - **A dropped connection** (`fetch failed`) on a ~50 s generation.

  `tts_bakeoff.ts` retries both (3 attempts) and does *not* retry genuine HTTP
  errors, since a 400 says the same thing three times. Any per-scene synthesis step
  must do the same — and then **assert one audio file per scene** before handing off
  to the render. A silently missing clip becomes a silent scene, which `calculateMetadata`
  will happily size to zero frames.
