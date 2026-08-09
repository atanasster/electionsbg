/**
 * Caption pages derived from a scene's script and its measured clip duration.
 *
 * WHY NOT WHISPER. `@remotion/install-whisper-cpp` would give real word-level
 * timestamps, but its documented model is English-only; Bulgarian needs a
 * multilingual one whose BG accuracy is undocumented, and it is a large download
 * to validate. Meanwhile we already know two things exactly: the text of every
 * scene (it is the spec's `voiceOver`, signed off at gate 1) and the duration of
 * every clip (measured for `calculateMetadata`). Distributing the former across
 * the latter needs no model and cannot mis-transcribe.
 *
 * WHAT THIS COSTS, stated plainly: the timing is DERIVED, not measured, so a page
 * boundary can sit a beat early or late. That is why pages are shown WHOLE rather
 * than with a per-word highlight — a highlight that is subtly out of sync reads as
 * broken, whereas a whole page a little early simply reads as a caption. Upgrade
 * to Whisper alignment only if word-level karaoke is actually wanted, and validate
 * Bulgarian first.
 */

export type CaptionPage = {
  text: string;
  /** Seconds from the start of the SCENE. */
  fromSec: number;
  toSec: number;
};

/** Chunk length that reads comfortably on a phone without the eye jumping. */
const MAX_CHARS = 34;

/**
 * A page must be at least this long before a sentence end is allowed to close
 * it, so "Да." does not get a page to itself.
 *
 * ABSOLUTE, not a fraction of `maxChars`. The first draft used `maxChars * 0.45`,
 * which inverts the intent: a wider page made sentence breaks LESS likely, so two
 * whole sentences shared one page exactly when there was room to separate them.
 */
const MIN_SENTENCE_PAGE = 12;

/**
 * Split into pages on word boundaries, preferring to break after sentence-ending
 * punctuation so a page rarely straddles two sentences.
 */
export const paginate = (text: string, maxChars = MAX_CHARS): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const pages: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length > maxChars) {
      pages.push(cur);
      cur = w;
    } else {
      cur = next;
    }
    // A sentence just ended and the page is substantial — close it here rather
    // than letting the next sentence start on the same page.
    if (/[.!?…]$/.test(cur) && cur.length >= MIN_SENTENCE_PAGE) {
      pages.push(cur);
      cur = "";
    }
  }
  if (cur) pages.push(cur);
  return pages;
};

/**
 * Time pages across `durationSec` in proportion to their length in characters.
 *
 * Characters rather than words: Bulgarian word lengths vary enough that a
 * word-count split drifts noticeably by the end of a 8-second scene, and
 * characters track speech duration much more closely (the measured rate is
 * ~13 chars/second — see references/voice.md).
 */
export const timePages = (
  text: string,
  durationSec: number,
  maxChars = MAX_CHARS,
): CaptionPage[] => {
  const pages = paginate(text, maxChars);
  if (!pages.length || durationSec <= 0) return [];

  const total = pages.reduce((a, p) => a + p.length, 0) || 1;
  let acc = 0;
  return pages.map((p, i) => {
    const share = (p.length / total) * durationSec;
    const fromSec = acc;
    acc += share;
    // Last page always runs to the end, so rounding can never leave a gap of
    // uncaptioned speech at the end of a scene.
    const toSec = i === pages.length - 1 ? durationSec : acc;
    return { text: p, fromSec, toSec };
  });
};

/** `00:00:01.234` — WebVTT's cue-timestamp format. */
export const vttTime = (sec: number): string => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${rest
    .toFixed(3)
    .padStart(6, "0")}`;
};

/**
 * A WebVTT sidecar for YouTube and the on-site player, where burned-in text
 * blocks translation and looks worse. `offsets` are each scene's start time in
 * the finished video.
 */
export const toVtt = (
  scenes: { text: string; offsetSec: number; durationSec: number }[],
): string => {
  const cues: string[] = ["WEBVTT", ""];
  for (const scene of scenes) {
    for (const p of timePages(scene.text, scene.durationSec)) {
      cues.push(
        `${vttTime(scene.offsetSec + p.fromSec)} --> ${vttTime(
          scene.offsetSec + p.toSec,
        )}`,
        p.text,
        "",
      );
    }
  }
  return cues.join("\n");
};
