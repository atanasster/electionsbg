# Voice — Bulgarian TTS and the verbalization rules

Load when writing any `voiceOver`, or when choosing/configuring a TTS provider.
Rationale and the provider comparison: `docs/plans/explainer-video-v1.md` §2.

## The rule that drives everything

**Every number in the voice track is spelled out in Bulgarian words. Digits and
symbols stay on screen only.**

```
onScreen:  "€1,2 млрд."
voiceOver: "един цяло и два милиарда евро"
```

This is not stylistic. `bg-BG` has **no pronunciation override** on any provider we
would use, so there is no `<phoneme>`, no `<say-as>`, no lexicon. Rewriting the text
is the only correction lever that exists. Spelling numbers out also means a human can
verify the spoken form by *reading* it at gate 1, before any audio is generated.

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

## Provider state (verified 2026-08-08)

| Provider | bg-BG | Notes |
|---|---|---|
| **Google Chirp 3 HD** ⭐ | **30 voices** | $30/1M chars, 1M/mo free. **No pause control, no custom pronunciation for `bg-bg`** — both confirmed in Google's own locale-exclusion tables. `speaking_rate` 0.25×–2× does work. |
| Azure | **2** (`bg-BG-KalinaNeural`, `bg-BG-BorislavNeural`) | No HD variant, no styles, no multilingual. The reflexive choice and the weakest one. |
| ElevenLabs v3 | supported (`bul`) | ~10× Google's rate; quality on lower-traffic languages is uneven by the vendor's own framing. |
| **Human narrator** | — | Dissolves every problem on this page. ~€15–40 per short (estimate, needs real quotes). Cost is **latency**, not money — it breaks same-day publishing. |

**Tiering:** TTS for time-sensitive shorts, a human for evergreen long-form.

**The decision is the bake-off's, not this file's:**

```bash
npm run video:bakeoff -- --list        # what bg-BG voices each provider actually has
npm run video:bakeoff -- --dry-run     # passage + plan + cost, no API calls
npm run video:bakeoff                  # synthesize everything configured
```

It renders a blind compare page (Проба A/B/C) so the ear goes before the price list,
and it synthesizes both `raw` and `spoken` variants of the same six facts — comparing
those two **is** the experiment that decides whether the spell-out rule above is
necessary, sufficient, or ceremony. Drop a human recording in as
`human__<name>__spoken.mp3` and it joins the comparison with no code change.

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
