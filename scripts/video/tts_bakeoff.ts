/**
 * Bulgarian TTS bake-off — phase 0 of docs/plans/explainer-video-v1.md.
 *
 * Synthesizes ONE identical passage (scripts/video/passage.ts) across every
 * provider, writes the clips, and builds a BLIND compare page so the voice is
 * chosen by ear rather than by price list.
 *
 *   npm run video:bakeoff -- --list            # what bg-BG voices each provider has
 *   npm run video:bakeoff -- --dry-run         # passage + plan + cost, no API calls
 *   npm run video:bakeoff                      # synthesize everything available
 *   npm run video:bakeoff -- --providers=google --voices=6
 *
 * WHY THIS EXISTS AS A COMMITTED SCRIPT rather than a few curl calls: the
 * decision it makes (which voice narrates everything this brand publishes) has to
 * be re-made whenever a provider ships a model, and re-running the SAME passage
 * is the only way that comparison means anything. It is also the rig for the §2b
 * question — record a human reading `passage.txt` into the same folder as
 * `human__<name>__spoken.mp3` and the compare page picks it up with no code change.
 *
 * WHY BLIND BY DEFAULT: you will have read the plan and you know which one costs
 * 10x. Labels are hidden behind a reveal button so the ear goes first.
 *
 * Credentials — every provider is optional and missing keys SKIP-AND-WARN rather
 * than throw, so a run with one key configured still produces a usable page:
 *
 *   GOOGLE_TTS_API_KEY        (or GOOGLE_TTS_ACCESS_TOKEN for a Bearer token)
 *   AZURE_SPEECH_KEY + AZURE_SPEECH_REGION      e.g. westeurope
 *   ELEVENLABS_API_KEY        (ELEVENLABS_MODEL_ID overrides the default model)
 *
 * NOTE ON bg-BG's limits, since they shape what this test can even ask: Chirp 3 HD
 * supports neither pause control nor custom pronunciations for `bg-bg`, so there
 * is no phoneme override to fall back on and nothing here tries to use one. What
 * the passage probes is exactly what has no fix — see passage.ts.
 *
 * Output (gitignored, regenerable): raw_data/video/tts_bakeoff/
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PASSAGE,
  VARIANTS,
  passageText,
  coveredCases,
  type Variant,
} from "./passage";

const OUT_DIR = resolve("raw_data/video/tts_bakeoff");
const LANG = "bg-BG";

type Voice = { id: string; label: string; gender?: string };
type Provider = {
  name: string;
  /** Why this provider is in the bake-off at all — printed in --list. */
  note: string;
  configured: () => boolean;
  missingHint: string;
  listVoices: () => Promise<Voice[]>;
  synthesize: (voice: Voice, text: string) => Promise<Buffer>;
};

const env = (k: string) => process.env[k]?.trim() || "";

/** Fail loudly with the provider's own message — a 401 body says more than a code. */
const ensureOk = async (res: Response, what: string) => {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(
    `${what} → HTTP ${res.status} ${res.statusText}${body ? ` · ${body.slice(0, 300)}` : ""}`,
  );
};

// ---------------------------------------------------------------------------
// Google Cloud TTS — the incumbent recommendation: 30 Chirp 3 HD voices for bg-BG
// ---------------------------------------------------------------------------
const google: Provider = {
  name: "google",
  note: "Chirp 3 HD — 30 bg-BG voices, $30/1M chars, 1M/month free",
  configured: () =>
    !!(env("GOOGLE_TTS_API_KEY") || env("GOOGLE_TTS_ACCESS_TOKEN")),
  missingHint: "set GOOGLE_TTS_API_KEY (or GOOGLE_TTS_ACCESS_TOKEN)",
  listVoices: async () => {
    const res = await fetch(googleUrl("voices", { languageCode: LANG }), {
      headers: googleAuthHeaders(),
    });
    await ensureOk(res, "google voices.list");
    const json = (await res.json()) as {
      voices?: { name: string; ssmlGender?: string }[];
    };
    return (json.voices ?? []).map((v) => ({
      id: v.name,
      label: v.name,
      gender: v.ssmlGender,
    }));
  },
  synthesize: async (voice, text) => {
    const res = await fetch(googleUrl("text:synthesize"), {
      method: "POST",
      headers: { "content-type": "application/json", ...googleAuthHeaders() },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: LANG, name: voice.id },
        // MP3 so the compare page plays everywhere. Chirp 3 HD rejects A-Law;
        // speakingRate is left at default because pacing is a per-scene edit
        // decision (see the plan), not something to bake into the comparison.
        audioConfig: { audioEncoding: "MP3" },
      }),
    });
    await ensureOk(res, `google synthesize ${voice.id}`);
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent)
      throw new Error(`google returned no audio for ${voice.id}`);
    return Buffer.from(json.audioContent, "base64");
  },
};

/**
 * Built with URL/URLSearchParams rather than string concatenation: `voices`
 * already carries a `?languageCode=` and `text:synthesize` does not, so a
 * hand-rolled `?key=` suffix is right on one endpoint and broken on the other.
 */
export const googleUrl = (
  path: string,
  params: Record<string, string> = {},
): string => {
  const u = new URL(`https://texttospeech.googleapis.com/v1/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const key = env("GOOGLE_TTS_API_KEY");
  if (key) u.searchParams.set("key", key);
  return u.toString();
};
const googleAuthHeaders = (): Record<string, string> => {
  const token = env("GOOGLE_TTS_ACCESS_TOKEN");
  return token ? { authorization: `Bearer ${token}` } : {};
};

// ---------------------------------------------------------------------------
// Azure AI Speech — the reflexive choice for BG, and the one with only 2 voices
// ---------------------------------------------------------------------------
const xmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

const azure: Provider = {
  name: "azure",
  note: "Neural — only KalinaNeural + BorislavNeural for bg-BG, no HD, no styles",
  configured: () => !!(env("AZURE_SPEECH_KEY") && env("AZURE_SPEECH_REGION")),
  missingHint: "set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. westeurope)",
  listVoices: async () => {
    const region = env("AZURE_SPEECH_REGION");
    const res = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      { headers: { "Ocp-Apim-Subscription-Key": env("AZURE_SPEECH_KEY") } },
    );
    await ensureOk(res, "azure voices/list");
    const json = (await res.json()) as {
      ShortName: string;
      Locale: string;
      Gender?: string;
    }[];
    return json
      .filter((v) => v.Locale === LANG)
      .map((v) => ({ id: v.ShortName, label: v.ShortName, gender: v.Gender }));
  },
  synthesize: async (voice, text) => {
    const region = env("AZURE_SPEECH_REGION");
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${LANG}">` +
      `<voice name="${voice.id}">${xmlEscape(text)}</voice></speak>`;
    const res = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": env("AZURE_SPEECH_KEY"),
          "content-type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "naiasno-tts-bakeoff",
        },
        body: ssml,
      },
    );
    await ensureOk(res, `azure synthesize ${voice.id}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

// ---------------------------------------------------------------------------
// ElevenLabs — best-in-class on major languages; the open question is whether
// that holds for a low-traffic one at 10x Google's character rate.
// ---------------------------------------------------------------------------
const eleven: Provider = {
  name: "eleven",
  note: "v3 multilingual (70+ langs incl. bul) — ~$300/1M chars, 10x Google",
  configured: () => !!env("ELEVENLABS_API_KEY"),
  missingHint: "set ELEVENLABS_API_KEY",
  listVoices: async () => {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY") },
    });
    await ensureOk(res, "eleven voices");
    const json = (await res.json()) as {
      voices?: {
        voice_id: string;
        name: string;
        labels?: { gender?: string };
      }[];
    };
    // Voices are language-agnostic here (the MODEL carries the language), so
    // there is nothing to filter on — take what the account has.
    return (json.voices ?? []).map((v) => ({
      id: v.voice_id,
      label: v.name,
      gender: v.labels?.gender,
    }));
  },
  synthesize: async (voice, text) => {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env("ELEVENLABS_API_KEY"),
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: env("ELEVENLABS_MODEL_ID") || "eleven_multilingual_v2",
          language_code: "bg",
        }),
      },
    );
    await ensureOk(res, `eleven synthesize ${voice.label}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

const PROVIDERS: Provider[] = [google, azure, eleven];

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

/**
 * Pick `n` voices with a gender mix rather than the alphabetical head. Google
 * returns 30 bg-BG Chirp 3 HD voices whose names are star names in alphabetical
 * order — taking the first 4 samples one corner of the range and would make the
 * bake-off a test of the letter A.
 */
const pickVoices = (voices: Voice[], n: number): Voice[] => {
  if (voices.length <= n) return voices;
  const byGender = new Map<string, Voice[]>();
  for (const v of voices) {
    const g = (v.gender || "UNKNOWN").toUpperCase();
    byGender.set(g, [...(byGender.get(g) ?? []), v]);
  }
  // Round-robin across genders, and inside each take an evenly-spaced sample.
  const buckets = [...byGender.values()].map((list) => {
    const step = Math.max(
      1,
      Math.floor(list.length / Math.ceil(n / byGender.size)),
    );
    return list.filter((_, i) => i % step === 0);
  });
  const out: Voice[] = [];
  for (let i = 0; out.length < n; i++) {
    let progressed = false;
    for (const b of buckets) {
      if (b[i]) {
        out.push(b[i]);
        progressed = true;
        if (out.length === n) break;
      }
    }
    if (!progressed) break;
  }
  return out;
};

// ---------------------------------------------------------------------------
// Compare page
// ---------------------------------------------------------------------------

/**
 * Stable, non-alphabetical clip order. Deterministic (no Math.random) so a
 * re-run produces the same blind labels and a note like "Проба C was best"
 * still means something tomorrow.
 */
const stableHash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/**
 * A, B, … Z, AA, AB … — `String.fromCharCode(65 + i)` silently produces `[`, `\`
 * past 26 clips, and 3 providers × 10 voices reaches that easily.
 */
export const blindLabel = (i: number): string => {
  let out = "";
  for (let n = i; ; n = Math.floor(n / 26) - 1) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    if (n < 26) return out;
  }
};

type Clip = { file: string; provider: string; voice: string; variant: Variant };

const buildComparePage = (clips: Clip[]): string => {
  const byVariant = VARIANTS.map((variant) => ({
    variant,
    clips: clips
      .filter((c) => c.variant === variant)
      .sort((a, b) => stableHash(a.file) - stableHash(b.file)),
  })).filter((g) => g.clips.length > 0);

  const lines = PASSAGE.map(
    (l) => `
    <tr>
      <td class="cases">${l.cases.map((c) => `<span class="chip">${c}</span>`).join(" ")}</td>
      <td class="raw">${esc(l.raw)}</td>
      <td class="spoken">${esc(l.spoken)}</td>
      <td class="listen">${esc(l.listenFor)}</td>
    </tr>`,
  ).join("");

  const groups = byVariant
    .map(
      (g) => `
  <section>
    <h2>Вариант: ${g.variant} <span class="sub">${
      g.variant === "raw"
        ? "цифрите както са на екрана"
        : "числата изписани с думи (мярката от §2 на плана)"
    }</span></h2>
    <div class="grid">
      ${g.clips
        .map(
          (c, i) => `
      <div class="clip" data-provider="${esc(c.provider)}" data-voice="${esc(c.voice)}">
        <div class="blind">Проба ${blindLabel(i)}</div>
        <div class="reveal">${esc(c.provider)} · ${esc(c.voice)}</div>
        <audio controls preload="none" src="./${esc(c.file)}"></audio>
        <textarea placeholder="Бележки: кои от трудните случаи сгреши?"></textarea>
      </div>`,
        )
        .join("")}
    </div>
  </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TTS bake-off — български глас за Наясно</title>
<style>
  :root{--bg:#0b1224;--bg2:#070b16;--text:#f2f5f8;--muted:#9aa7bd;--accent:#df6b43;--rule:#22304d}
  *{box-sizing:border-box}
  body{margin:0;padding:32px;background:var(--bg);color:var(--text);
       font:16px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  h1{margin:0 0 4px;font-size:26px}
  h2{margin:32px 0 12px;font-size:18px;border-bottom:1px solid var(--rule);padding-bottom:8px}
  .sub{color:var(--muted);font-weight:400;font-size:14px}
  p.lede{color:var(--muted);max-width:70ch;margin:0 0 24px}
  table{border-collapse:collapse;width:100%;font-size:13px;margin-bottom:8px}
  th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--rule)}
  th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.raw{font-variant-numeric:tabular-nums}
  td.listen{color:var(--muted)}
  .chip{display:inline-block;background:var(--bg2);border:1px solid var(--rule);
        border-radius:99px;padding:1px 8px;font-size:11px;color:var(--accent)}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
  .clip{background:var(--bg2);border:1px solid var(--rule);border-radius:12px;padding:14px}
  .blind{font-weight:700;font-size:15px;margin-bottom:8px}
  .reveal{display:none;color:var(--accent);font-size:13px;margin-bottom:8px;
          font-variant-numeric:tabular-nums;word-break:break-all}
  body.revealed .reveal{display:block}
  body.revealed .blind{color:var(--muted);font-weight:400;font-size:12px}
  audio{width:100%}
  textarea{width:100%;margin-top:10px;min-height:56px;background:var(--bg);color:var(--text);
           border:1px solid var(--rule);border-radius:8px;padding:8px;font:inherit;font-size:13px;resize:vertical}
  button{background:var(--accent);color:#0b1224;border:0;border-radius:8px;
         padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
</style></head><body>
<h1>Кой глас чете Наясно</h1>
<p class="lede">Един и същ пасаж, всички доставчици. Пробите са <strong>анонимни</strong> —
първо слушай, после разкрий. Пасажът е съставен само от случаи, които <strong>нямат
поправка през API</strong> за български: Chirp 3 HD не поддържа нито паузи, нито
собствено произношение за <code>bg-bg</code>.</p>
<button id="reveal">Разкрий кой кой е</button>

<h2>Какво слушаме</h2>
<table><thead><tr><th>случай</th><th>на екрана (raw)</th><th>изговорено (spoken)</th><th>за какво да се внимава</th></tr></thead>
<tbody>${lines}</tbody></table>
${groups}

<h2>Човешки прочит</h2>
<p class="lede">Пусни същия пасаж на български диктор (текстът е в <code>passage.txt</code>)
и сложи файла тук като <code>human__&lt;име&gt;__spoken.mp3</code>. Скриптът го включва
автоматично при следващо пускане — това е сравнението от §2b на плана.</p>

<script>
  document.getElementById('reveal').addEventListener('click', () => {
    document.body.classList.toggle('revealed');
  });
</script>
</body></html>`;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const main = async () => {
  const wanted = (arg("providers") || "google,azure,eleven")
    .split(",")
    .map((s) => s.trim());
  const variants = (arg("variants") || VARIANTS.join(","))
    .split(",")
    .map((s) => s.trim()) as Variant[];
  const perProvider = Number(arg("voices") || 4);
  const listOnly = flag("list");
  const dryRun = flag("dry-run");

  const active = PROVIDERS.filter((p) => wanted.includes(p.name));
  if (!active.length) {
    console.error(`No known provider in --providers=${wanted.join(",")}`);
    process.exit(1);
  }

  console.log(`\nBulgarian TTS bake-off — ${LANG}`);
  console.log(
    `Hard cases covered by the passage: ${coveredCases().join(", ")}`,
  );
  for (const v of variants) {
    console.log(`  ${v.padEnd(7)} ${passageText(v).length} chars`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // The human-narrator half of the test needs the text in a form you can email.
  writeFileSync(
    resolve(OUT_DIR, "passage.txt"),
    `${PASSAGE.map((l) => l.spoken).join("\n\n")}\n`,
    "utf8",
  );

  const clips: Clip[] = [];
  let synthesized = 0;
  let charsBilled = 0;

  for (const provider of active) {
    if (!provider.configured()) {
      console.warn(`\n[skip] ${provider.name} — ${provider.missingHint}`);
      continue;
    }
    let voices: Voice[];
    try {
      voices = await provider.listVoices();
    } catch (err) {
      console.warn(`\n[skip] ${provider.name} — ${(err as Error).message}`);
      continue;
    }

    console.log(`\n${provider.name} — ${provider.note}`);
    console.log(`  ${voices.length} voice(s) available for ${LANG}`);
    if (listOnly) {
      for (const v of voices) {
        console.log(
          `    ${v.label}${v.gender ? ` (${v.gender.toLowerCase()})` : ""}`,
        );
      }
      continue;
    }

    const picked = pickVoices(voices, perProvider);
    console.log(
      `  using ${picked.length}: ${picked.map((v) => v.label).join(", ")}`,
    );

    for (const voice of picked) {
      for (const variant of variants) {
        const text = passageText(variant);
        const safe = voice.label.replace(/[^\w.-]+/g, "-");
        const file = `${provider.name}__${safe}__${variant}.mp3`;
        charsBilled += text.length;
        if (dryRun) {
          clips.push({
            file,
            provider: provider.name,
            voice: voice.label,
            variant,
          });
          continue;
        }
        try {
          const audio = await provider.synthesize(voice, text);
          writeFileSync(resolve(OUT_DIR, file), audio);
          clips.push({
            file,
            provider: provider.name,
            voice: voice.label,
            variant,
          });
          synthesized++;
          console.log(`    ✓ ${file} (${(audio.length / 1024).toFixed(0)} KB)`);
        } catch (err) {
          // One bad voice must not cost the whole run — the other clips are
          // still a usable comparison.
          console.warn(`    ✗ ${file} — ${(err as Error).message}`);
        }
      }
    }
  }

  if (listOnly) {
    console.log("");
    return;
  }

  // Any human recording dropped into the folder joins the comparison for free.
  if (existsSync(OUT_DIR)) {
    for (const f of readdirSync(OUT_DIR)) {
      if (!f.startsWith("human__") || !f.endsWith(".mp3")) continue;
      const [, name = "human", variant = "spoken"] = f
        .replace(/\.mp3$/, "")
        .split("__");
      if (!clips.some((c) => c.file === f)) {
        clips.push({
          file: f,
          provider: "human",
          voice: name,
          variant: variant as Variant,
        });
        console.log(`\n  + human read picked up: ${f}`);
      }
    }
  }

  if (!clips.length) {
    // In a real run this is a failure. In --dry-run with no keys yet configured
    // it is the expected state — you ran it to read the passage and the plan —
    // so exit 0 rather than reporting a failure that did not happen.
    const msg =
      "Nothing to compare. Configure at least one provider above, or drop a human__*.mp3 into the output folder.";
    if (dryRun) {
      console.log(`\n${msg}`);
      console.log(
        `Passage written for a human narrator: ${resolve(OUT_DIR, "passage.txt")}\n`,
      );
      return;
    }
    console.error(`\n${msg}`);
    process.exit(1);
  }

  writeFileSync(
    resolve(OUT_DIR, "index.html"),
    buildComparePage(clips),
    "utf8",
  );

  console.log(
    `\n${dryRun ? "[dry-run] would synthesize" : "synthesized"} ${dryRun ? clips.length : synthesized} clip(s) · ${charsBilled.toLocaleString("en-US")} chars`,
  );
  console.log(
    `Free tier reference: 1,000,000 chars/month on Chirp 3 HD — this run is ${((charsBilled / 1_000_000) * 100).toFixed(3)}% of it.`,
  );
  console.log(`\nCompare page: ${resolve(OUT_DIR, "index.html")}`);
  console.log("Listen blind first, then press «Разкрий кой кой е».\n");
};

// Entrypoint guard (same idiom as scripts/bucket_sync_paths.ts) — passage.test.ts
// imports `blindLabel` / `googleUrl` from here, and without this the whole
// bake-off would run on import.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
