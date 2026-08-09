/**
 * WebVTT sidecar for a spec — the caption track the YouTube/on-site cut uses
 * instead of burned-in text, plus the transcript that goes under the on-page
 * embed.
 *
 *   npm run video:vtt -- t1
 *
 * Cue offsets are computed from the SAME per-scene clip durations the composition
 * measures itself from, plus the same tail — so the sidecar and the burned-in
 * captions describe one timeline rather than two that drift.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { e1 } from "../../video/src/specs/e1-inflation";
import { e2 } from "../../video/src/specs/e2-risk";
import { v3 } from "../../video/src/specs/v3-real-screen";
import { audioPath, type VoiceableSpec } from "../../video/src/lib/spec";
import { toVtt } from "../../video/src/lib/captions";

/** Shorts and explainers share the fields these scripts touch (slug, kind, voice, scenes[].id/voiceOver). */
const SPECS: Record<string, VoiceableSpec> = { e1, e2, v3 };

/** Must match `sceneFrames`' default in video/src/lib/audio.ts. */
const TAIL_SECONDS = 0.35;

const durationOf = (file: string): number =>
  Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8" },
    ).trim(),
  ) || 0;

const main = () => {
  const key = process.argv[2];
  const spec = key ? SPECS[key] : undefined;
  if (!spec) {
    console.error(
      `Usage: npm run video:vtt -- <${Object.keys(SPECS).join("|")}>`,
    );
    process.exit(1);
  }

  const scenes: { text: string; offsetSec: number; durationSec: number }[] = [];
  let offset = 0;
  for (const scene of spec.scenes) {
    const file = resolve("video/public", audioPath(spec.slug, scene.id));
    if (!existsSync(file)) {
      console.error(
        `Missing audio for scene ${scene.id}. Run \`npm run video:voice -- ${key}\` first.`,
      );
      process.exit(1);
    }
    const durationSec = durationOf(file) + TAIL_SECONDS;
    scenes.push({ text: scene.voiceOver, offsetSec: offset, durationSec });
    offset += durationSec;
  }

  const outDir = resolve("raw_data/video/out");
  const vttPath = resolve(outDir, `${spec.slug}.vtt`);
  writeFileSync(vttPath, `${toVtt(scenes)}\n`, "utf8");

  // The transcript is the script — already written and already signed off at
  // gate 1, so it costs nothing and gives the crawler a text surface an embed
  // does not provide.
  const txtPath = resolve(outDir, `${spec.slug}.transcript.txt`);
  writeFileSync(
    txtPath,
    `${spec.title}\n${spec.link}\n\n${spec.scenes.map((s) => s.voiceOver).join("\n\n")}\n`,
    "utf8",
  );

  console.log(`  ${vttPath}  (${offset.toFixed(1)}s)`);
  console.log(`  ${txtPath}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
