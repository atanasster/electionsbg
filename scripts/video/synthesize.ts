/**
 * Per-scene voice-over for a video spec — step 5 of the `naiasno-video` skill.
 *
 *   npm run video:voice -- t1            # synthesize every scene
 *   npm run video:voice -- t1 --force    # re-synthesize clips that already exist
 *
 * ONE CLIP PER SCENE, never one for the whole video. Two independent reasons:
 * `bg-BG` has no pause control on any provider we use, so every pause between
 * sentences is made in the edit by holding a scene past its narration; and the
 * composition measures its own length from these files (`calculateMetadata`), so
 * scene timing and voice can never drift apart.
 *
 * Reuses the bake-off's Gemini adapter rather than reimplementing it — that is
 * where the retries live, and both failures they cover (a 200 carrying no audio,
 * a dropped connection) lose a scene's narration while the run looks successful.
 *
 * Silence trimming is adaptive: TTS clips carry leading/trailing silence that
 * makes cuts sag, and a fixed dB floor either misses it or eats the first
 * syllable. Measure with `loudnorm`, feed the measured gate to `silencedetect`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CHOSEN_VOICE, gemini } from "./tts_bakeoff";
import { t1 } from "../../video/src/specs/t1-cost-per-vote";
import { t2 } from "../../video/src/specs/t2-changed-winner";
import type { VideoSpec } from "../../video/src/lib/spec";

const SPECS: Record<string, VideoSpec> = { t1, t2 };
const OUT_ROOT = resolve("video/public/voiceover");

const ffmpeg = (args: string[]): string => {
  try {
    // ffmpeg writes its report to stderr even on success.
    execFileSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    return "";
  } catch (err) {
    const e = err as { stderr?: Buffer; status?: number };
    return e.stderr?.toString() ?? "";
  }
};

const ffmpegCapture = (args: string[]): string => {
  const r = execFileSync("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "buffer",
  } as never) as unknown as Buffer;
  return r?.toString() ?? "";
};

/**
 * Leading/trailing silence bounds in seconds, using the file's OWN measured
 * gating threshold rather than a constant.
 */
export const detectSilence = (
  file: string,
  duration: number,
): { start: number; end: number } => {
  let thresh = -50;
  try {
    const probe = ffmpeg([
      "-nostdin",
      "-hide_banner",
      "-i",
      file,
      "-af",
      "loudnorm=print_format=json",
      "-f",
      "null",
      "-",
    ]);
    const m = /"input_thresh"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/.exec(probe);
    if (m?.[1]) thresh = Number(m[1]);
  } catch {
    /* keep the default gate */
  }

  let start = 0;
  let end = duration;
  try {
    const out = ffmpeg([
      "-nostdin",
      "-hide_banner",
      "-i",
      file,
      "-af",
      `silencedetect=noise=${thresh}dB:d=0.25`,
      "-f",
      "null",
      "-",
    ]);
    const starts = [...out.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map(
      (x) => Number(x[1]),
    );
    const ends = [...out.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/g)].map(
      (x) => Number(x[1]),
    );
    // Leading: a silence that begins at (or within 100 ms of) zero.
    if (starts.length && starts[0]! <= 0.1 && ends.length) start = ends[0]!;
    // Trailing: a silence that runs to the end of the file.
    const lastStart = starts[starts.length - 1];
    if (
      lastStart !== undefined &&
      lastStart > start &&
      ends.length < starts.length
    ) {
      end = lastStart;
    }
  } catch {
    /* leave untrimmed rather than guess */
  }
  // Never trim to nothing, and keep a hair of air either side.
  if (!(end > start + 0.2)) return { start: 0, end: duration };
  return {
    start: Math.max(0, start - 0.05),
    end: Math.min(duration, end + 0.12),
  };
};

const durationOf = (file: string): number => {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Number(out.trim()) || 0;
};

const main = async () => {
  const key = process.argv[2];
  const force = process.argv.includes("--force");
  const spec = key ? SPECS[key] : undefined;
  if (!spec) {
    console.error(
      `Usage: npm run video:voice -- <${Object.keys(SPECS).join("|")}> [--force]`,
    );
    process.exit(1);
  }
  if (!gemini.configured()) {
    console.error(gemini.missingHint);
    process.exit(1);
  }
  if (spec.voice.voiceId !== CHOSEN_VOICE.voiceId) {
    console.warn(
      `[warn] spec voice ${spec.voice.voiceId} != CHOSEN_VOICE ${CHOSEN_VOICE.voiceId}`,
    );
  }

  const outDir = resolve(OUT_ROOT, spec.slug);
  mkdirSync(outDir, { recursive: true });
  console.log(
    `\n${spec.slug} — ${spec.scenes.length} scenes · ${spec.voice.voiceId}\n`,
  );

  const written: string[] = [];
  for (const scene of spec.scenes) {
    const file = resolve(outDir, `${String(scene.id).padStart(2, "0")}.wav`);
    if (existsSync(file) && !force) {
      console.log(
        `  = scene ${scene.id} exists (${(statSync(file).size / 1024).toFixed(0)} KB) — --force to redo`,
      );
      written.push(file);
      continue;
    }

    // Rule 7 is a property of the spec, but a digit reaching the engine here is
    // what it exists to prevent — so it is also checked at the last moment.
    if (/\d/.test(scene.voiceOver)) {
      console.error(
        `  ✗ scene ${scene.id}: voiceOver contains digits — spell them out (rule 7)\n      ${scene.voiceOver}`,
      );
      process.exit(1);
    }

    const audio = await gemini.synthesize(
      { id: spec.voice.voiceId, label: spec.voice.voiceId },
      scene.voiceOver,
    );
    writeFileSync(file, audio);

    const raw = durationOf(file);
    const { start, end } = detectSilence(file, raw);
    if (start > 0.02 || end < raw - 0.02) {
      const tmp = `${file}.trim.wav`;
      ffmpegCapture([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        file,
        "-ss",
        String(start),
        "-to",
        String(end),
        tmp,
      ]);
      if (existsSync(tmp) && statSync(tmp).size > 1024) {
        execFileSync("mv", [tmp, file]);
      }
    }
    const final = durationOf(file);
    console.log(
      `  ✓ scene ${scene.id}  ${final.toFixed(1)}s` +
        (final < raw - 0.02
          ? `  (trimmed ${(raw - final).toFixed(2)}s of silence)`
          : ""),
    );
    written.push(file);
  }

  // The render reads one file per scene; a missing one becomes a silent scene
  // that calculateMetadata will happily size to zero frames.
  const missing = spec.scenes.filter(
    (s) => !existsSync(resolve(outDir, `${String(s.id).padStart(2, "0")}.wav`)),
  );
  if (missing.length) {
    console.error(
      `\n✗ missing audio for scene(s): ${missing.map((s) => s.id).join(", ")}`,
    );
    process.exit(1);
  }

  const total = written.reduce((a, f) => a + durationOf(f), 0);
  console.log(
    `\n  total narration: ${total.toFixed(1)}s across ${written.length} scenes`,
  );
  if (spec.kind === "short" && total > 60) {
    console.warn(
      `  [warn] ${total.toFixed(1)}s exceeds the 60s Reels/Shorts ceiling`,
    );
  }
  console.log(`  → ${outDir}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
