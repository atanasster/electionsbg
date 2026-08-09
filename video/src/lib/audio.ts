import { ALL_FORMATS, Input, UrlSource } from "mediabunny";

/**
 * Duration of an audio file, in seconds. Used from `calculateMetadata` so a
 * composition sizes ITSELF from the narration rather than carrying hand-entered
 * scene lengths that drift the moment a line is reworded.
 *
 * Mediabunny rather than ffprobe: it runs in the browser context Remotion renders
 * in, so the same call works in the Studio preview and in a headless render.
 */
export const getAudioDuration = async (src: string): Promise<number> => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src, { getRetryDelay: () => null }),
  });
  return input.computeDuration();
};

/**
 * Per-scene durations in FRAMES, plus the total.
 *
 * `tail` pads each scene past the end of its narration. `bg-BG` has no pause
 * control on any provider we use (see references/voice.md), so every pause
 * between sentences is created here, in the edit, by holding the scene after the
 * voice stops. Without it the cuts land on the final syllable and the video feels
 * like it is being read at you.
 */
export const sceneFrames = async (
  srcs: string[],
  fps: number,
  tailSeconds = 0.35,
): Promise<{ durations: number[]; total: number }> => {
  const seconds = await Promise.all(srcs.map(getAudioDuration));
  const durations = seconds.map((s) =>
    Math.max(1, Math.ceil((s + tailSeconds) * fps)),
  );
  return { durations, total: durations.reduce((a, b) => a + b, 0) };
};
