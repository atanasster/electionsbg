/**
 * Gate 1 — the cheap gate. Prints the script for a human to read and mechanically
 * checks the half that CAN be checked, before a single second of audio is bought.
 *
 *   npm run video:gate1 -- e2
 *
 * ── WHAT IS ASSERTED AND WHAT IS NOT ──────────────────────────────────────────
 * Asserted:
 *   • rule 7 — no digits anywhere in a `voiceOver` (the one rule with a
 *     mechanical test, and the one with no post-hoc fix: `bg-BG` has no
 *     pronunciation override on any provider we use).
 *   • every numeric token in an `onScreen` is findable at that scene's
 *     `grounding` path in the generated data layer — so a data refresh that
 *     moves a figure fails HERE rather than in a rendered video.
 *   • the length budget, at the measured rate for this spec — 11,0 chars/s
 *     with a delivery note, 13,5 without (references/voice.md).
 *
 * NOT asserted, deliberately: that `voiceOver` says the same number as
 * `onScreen`. Once a figure is Bulgarian words, comparing it by machine needs
 * exactly the verbalizer this whole design avoids — so the script prints the
 * numeric tokens and the number-word spans SIDE BY SIDE and the operator reads
 * them. That is rule 6, and it stays a human sign-off on purpose.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { e1 } from "../../video/src/specs/e1-inflation";
import { e2 } from "../../video/src/specs/e2-risk";
import { v3 } from "../../video/src/specs/v3-real-screen";
import type { ExplainerSpec } from "../../video/src/lib/spec";

const SPECS: Record<string, ExplainerSpec> = { e1, e2, v3 };

/**
 * Measured on Rasalgethi — references/voice.md.
 *
 * A delivery note slows the read by ~22%, so the estimate has to know whether the
 * spec carries one: 8 043 chars of E2 ran 598 s bare and 729 s directed, and a
 * single constant would be wrong by two minutes on a long-form video.
 */
const CHARS_PER_SEC_BARE = 13.5;
const CHARS_PER_SEC_DIRECTED = 11.0;
/** An explainer beat much past this reads as rushed against its canvas change. */
const SCENE_CHAR_CEILING = 260;

/**
 * Number-words in the voice track, for the operator's side-by-side read.
 *
 * Unicode property escapes, NOT `\b` — JS word boundaries are defined against
 * ASCII `\w`, so `\bдве` can never match and the whole column silently prints
 * "—" while looking like it ran. Which it did, once.
 */
const NUMBER_WORDS =
  /(?<!\p{L})(нула|едно|един|една|две|два|три|четири|пет|шест|седем|осем|девет|десет|единайсет|единадесет|дванайсет|дванадесет|тринайсет|тринадесет|четиринайсет|четиринадесет|петнайсет|петнадесет|шестнайсет|шестнадесет|седемнайсет|седемнадесет|осемнайсет|осемнадесет|деветнайсет|деветнадесет|двайсет|двадесет|трийсет|тридесет|четирийсет|четиридесет|петдесет|шейсет|шестдесет|седемдесет|осемдесет|деветдесет|сто|двеста|триста|четиристотин|петстотин|шестстотин|седемстотин|осемстотин|деветстотин|хиляд|милион|милиард|цяло|процент|първи|първо|втори|второ|трети|трето|половина|максимум)\p{L}*/giu;

/** Resolve a `$.a.b.c` path against the generated data layer. */
const at = (root: unknown, path: string): unknown =>
  path
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]),
      root,
    );

/** Every number a viewer can read off the `onScreen` string. */
const numericTokens = (s: string): string[] =>
  (s.match(/\d[\d\s .,]*\d|\d/g) ?? []).map((t) => t.trim());

/** Normalize for comparison: BG thousands spaces out, decimal comma to dot. */
const asNumber = (t: string): number =>
  Number(t.replace(/[\s ]/g, "").replace(",", "."));

/** Does `value` (a scalar or an object of scalars) carry `n` anywhere in it? */
const carries = (value: unknown, n: number): boolean => {
  if (value == null) return false;
  if (typeof value === "number") return Math.abs(value - n) < 0.005;
  if (typeof value === "string")
    return numericTokens(value).some((t) => Math.abs(asNumber(t) - n) < 0.005);
  if (Array.isArray(value)) return value.some((v) => carries(v, n));
  if (typeof value === "object")
    return Object.values(value as Record<string, unknown>).some((v) =>
      carries(v, n),
    );
  return false;
};

const main = () => {
  const key = process.argv[2];
  const spec = key ? SPECS[key] : undefined;
  if (!spec) {
    console.error(
      `Usage: npm run video:gate1 -- <${Object.keys(SPECS).join("|")}>`,
    );
    process.exit(1);
  }

  // Tempo is a render-time playback rate, so it multiplies the delivered rate.
  const rate =
    (spec.voice.direction ? CHARS_PER_SEC_DIRECTED : CHARS_PER_SEC_BARE) *
    (spec.voice.tempo ?? 1);

  const dataCache = new Map<string, unknown>();
  const load = (file: string): unknown => {
    if (!dataCache.has(file))
      dataCache.set(file, JSON.parse(readFileSync(resolve(file), "utf8")));
    return dataCache.get(file);
  };

  const problems: string[] = [];
  let totalChars = 0;

  console.log(`\n${spec.title}`);
  console.log(`${spec.slug} · ${spec.kind} · ${spec.scenes.length} scenes`);
  console.log(`${spec.link}`);
  console.log(
    spec.voice.direction
      ? `\ndirection  ${spec.voice.direction}\n`
      : `\ndirection  — none. The engine rushes without one; see references/voice.md.\n`,
  );

  for (const s of spec.scenes) {
    const chars = s.voiceOver.length;
    totalChars += chars;

    // Rule 7 — no digits in the voice track.
    const digits = s.voiceOver.match(/\d/g);
    if (digits)
      problems.push(
        `scene ${s.id}: voiceOver contains digits (${digits.join("")})`,
      );
    if (chars > SCENE_CHAR_CEILING)
      problems.push(
        `scene ${s.id}: voiceOver is ${chars} chars (ceiling ${SCENE_CHAR_CEILING})`,
      );

    // Grounding — every number shown must exist at the declared path.
    let groundLine = "—";
    if (s.grounding) {
      const value = at(load(s.grounding.file), s.grounding.path);
      if (value === undefined) {
        problems.push(
          `scene ${s.id}: grounding path ${s.grounding.path} resolves to nothing`,
        );
        groundLine = `MISSING ${s.grounding.path}`;
      } else {
        const missing = numericTokens(s.onScreen)
          .map(asNumber)
          .filter((n) => Number.isFinite(n) && !carries(value, n));
        if (missing.length)
          problems.push(
            `scene ${s.id}: onScreen ${missing.join(", ")} not found at ${s.grounding.path}`,
          );
        groundLine = `${s.grounding.path} = ${JSON.stringify(value)}`;
      }
    } else if (numericTokens(s.onScreen).length) {
      problems.push(
        `scene ${s.id}: onScreen shows a figure with no grounding block`,
      );
    }

    console.log(`── ${String(s.id).padStart(2)} ${s.kicker ?? ""}`);
    console.log(`   onScreen   ${s.onScreen}`);
    console.log(
      `   digits     ${numericTokens(s.onScreen).join(" · ") || "—"}`,
    );
    console.log(
      `   spoken №   ${(s.voiceOver.match(NUMBER_WORDS) ?? []).join(" · ") || "—"}`,
    );
    console.log(`   voiceOver  ${s.voiceOver}`);
    console.log(`   grounding  ${groundLine}`);
    console.log(
      `   length     ${chars} chars · ${(chars / rate).toFixed(1)}s\n`,
    );
  }

  const secs = totalChars / rate;
  const [lo, hi] = spec.runtimeSeconds;
  console.log(
    `TOTAL ${totalChars} chars → ~${secs.toFixed(0)}s (${(secs / 60).toFixed(1)} min) narration` +
      ` at ${rate.toFixed(1)} ch/s ${spec.voice.direction ? "(directed" : "(no direction — the engine will RUSH"}` +
      `${spec.voice.tempo && spec.voice.tempo !== 1 ? `, ×${spec.voice.tempo}` : ""})` +
      ` · declared window ${lo}–${hi}s`,
  );
  // The window is the SPEC's, not the format's — see `runtimeSeconds` in spec.ts.
  if (secs < lo || secs > hi)
    problems.push(
      `narration runs ~${secs.toFixed(0)}s, outside the declared ${lo}–${hi}s window`,
    );

  if (problems.length) {
    console.error(`\n✗ GATE 1 FAILED — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log(
    `\n✓ mechanical checks pass. Rule 6 (spoken ≡ shown) is the OPERATOR's read:\n` +
      `  compare "digits" against "spoken №" on every scene above, then sign off.`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
