import { staticFile } from "remotion";
import { FONT, THEME } from "../theme";

/**
 * Loads the site's Cyrillic Inter AND makes it the document default.
 *
 * ── WHY THE GLOBAL RULE, NOT JUST THE @font-face ──────────────────────────────
 * Setting `fontFamily` on a frame component only styles its CHILDREN, and this
 * project keeps putting things beside the frame rather than inside it: captions
 * and the explainer's rail both render as SIBLINGS of the stage, inside their own
 * `<Sequence>`. Both shipped a render in Chromium's default serif before anyone
 * noticed — readable, on-brand for nobody, and invisible on a machine that happens
 * to have Inter installed.
 *
 * Patching each offender is whack-a-mole: the next component rendered outside the
 * frame has the same bug and no warning. A `*`-level default closes the class.
 *
 * Injected once at module scope — a <style> per component would be re-inserted on
 * every frame of every scene.
 */
let injected = false;

export const injectFonts = (): void => {
  if (injected || typeof document === "undefined") return;
  injected = true;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = staticFile("fonts/inter.css");
  document.head.appendChild(link);

  // COLOR belongs here for exactly the same reason as the family, and it bit
  // separately: with the font fixed, the explainer's rail headline still rendered
  // near-BLACK on the dark stage, because it inherited neither. Its kicker, body
  // and stat only survived by having explicit colours of their own.
  //
  // Inline styles still win, so a component that sets its own colour is
  // unaffected — this only supplies the default that sibling-of-the-stage
  // components never had.
  const style = document.createElement("style");
  style.textContent =
    `html, body, #root, * { font-family: ${FONT}; }` +
    `html, body, #root { color: ${THEME.dark.text}; }`;
  document.head.appendChild(style);
};
