// The flyover band on `/` — `docs/plans/home-flyover-v1.md` §8.
//
// ⚠️ THIS PUTS A MOVING MAP ON A PAGE WHOSE OWN PLAN SAID IT WOULD HAVE NONE, and the
// property that decision protected is untouched. `tests/perf.spec.ts` pins `/` in
// `MAP_FREE_HUBS` — no `vendor-geo`, `vendor-leaflet` or `vendor-charts` in the home chunk —
// and the scene has no map library AT ALL: the geometry was projected at generation time and
// the client draws plain canvas. The gate stays; what changed is the reason it passes.
//
// ⚠️ FOUR STATES, ONE RESERVED BOX. Suspense fallback, poster, canvas and reduced-motion all
// render the same box — shared dimensions and CSS — because `/` is budgeted at
// CLS < 0.1 and this band sits ABOVE the eight destination tiles. Anything that resizes here
// moves every one of them under the reader's cursor.
//
// One preview cycles columns → arcs → tour, starting with columns on refresh. The dots
// select a programme immediately; offscreen/hidden-tab pauses preserve its playback time.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { isBg } from "@/i18n";
import { captionFor, type Caption } from "@/lib/flyover/captions";
import { render } from "@/lib/flyover/render";
import {
  PROGRAMMES,
  PROGRAMME_IDS,
  stateAt,
  type ProgrammeId,
} from "@/lib/flyover/programmes";
import { nextProgramme, startingProgramme } from "@/lib/flyover/rotation";
import {
  FLYOVER_ASPECT,
  FLYOVER_H,
  FLYOVER_W,
  SWITCH_DOT_CLASS,
  SWITCH_ROW_CLASS,
} from "./box";
import { FlyoverCaptions } from "./FlyoverCaptions";
import { readPalette } from "./palette";
import { useArm } from "./useArm";
import { useFlyoverArtifact } from "./useFlyoverArtifact";
import styles from "./HomeFlyover.module.css";

/**
 * 30 fps, and 24 on a narrow viewport (plan §8.5).
 *
 * The scene is a slow camera over static geometry; at 60 fps it would look identical and cost
 * twice the battery on the page a reader is most likely to leave open.
 */
const FPS = 30;
const FPS_NARROW = 24;

/** Below this width the preview drops to 24 fps. */
const NARROW_PX = 640;

/** Retina is worth it; 3× is not — it triples the fill rate for a difference nobody sees. */
const MAX_DPR = 2;

/**
 * ⚠️ LITERAL KEYS, NEVER `` `flyover_scene_${id}` ``. `scripts/i18n/key_usage.test.ts` and
 * `bundle_reachability.test.ts` treat a built template as naming EVERY key it could match, so
 * one interpolation would make the whole family unprunable and unsplittable — and
 * `npm run i18n:prune` would stop being able to tell a live key from a dead one. The engine's
 * caption table carries the same rule and the same note.
 */
const SCENE_NAME_KEYS: Record<ProgrammeId, string> = {
  columns: "flyover_scene_columns",
  arcs: "flyover_scene_arcs",
  tour: "flyover_scene_tour",
};

/**
 * What the picture IS, for a reader who cannot see it — per scene.
 *
 * ⚠️ One string for all three was wrong for two of them: the copy describes the COLUMNS
 * picture in words („с колони по области"), and the switch works in every state — so a
 * reduced-motion reader who changed the scene had their screen reader keep announcing columns
 * over a picture of arcs. The reader it was wrong for is the one who cannot check.
 */
const SCENE_ALT_KEYS: Record<ProgrammeId, string> = {
  columns: "flyover_alt_columns",
  arcs: "flyover_alt_arcs",
  tour: "flyover_alt_tour",
};

export const HomeFlyover: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = isBg(i18n.language) ? "bg" : "en";
  const [params] = useSearchParams();
  const { ref, armed, running } = useArm();
  const { world } = useFlyoverArtifact(armed);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [painted, setPainted] = useState(false);

  const initialProgramme = startingProgramme(params.get("scene"));
  const [programme, setProgramme] = useState<ProgrammeId>(initialProgramme);
  useEffect(() => setProgramme(initialProgramme), [initialProgramme]);

  // Seeded by the effect below and then overwritten per frame by the loop. `world` is always
  // undefined on the first render — nothing is fetched before the band arms.
  const [caption, setCaption] = useState<Caption | null>(null);

  const staticCaption = useMemo(
    () =>
      world
        ? captionFor(stateAt(PROGRAMMES[programme], 0).captionId, world)
        : null,
    [world, programme],
  );

  useEffect(() => {
    setCaption(staticCaption);
  }, [staticCaption]);

  /**
   * ⚠️ SURVIVES EFFECT RE-RUNS. `running` flips on `visibilitychange` and `draw`'s identity
   * changes with the language — both tear the effect down, so a clock declared inside it
   * restarted the programme at 0 every time a reader switched tabs. „Pausing must resume at
   * the same `t`" is the contract `useArm` states; this ref is what implements it.
   */
  const elapsedRef = useRef(0);

  // Choosing a new scene starts it at its beginning; resuming does not.
  useEffect(() => {
    elapsedRef.current = 0;
  }, [programme]);

  /**
   * ⚠️ OBSERVED, NOT MEASURED PER FRAME. `getBoundingClientRect()` inside the rAF callback,
   * immediately before writing `canvas.width`, is a read-after-write that forces a synchronous
   * layout 30 times a second — on the page with the tightest performance budget in the repo,
   * for a number that changes on resize. The rect is read ONCE to seed the first frame,
   * because `ResizeObserver` fires asynchronously.
   */
  useEffect(() => {
    const el = canvasRef.current;
    ctxRef.current = null;
    if (!el) return;
    const seeded = el.getBoundingClientRect();
    sizeRef.current = {
      w: Math.max(1, Math.round(seeded.width)),
      h: Math.max(1, Math.round(seeded.height)),
    };
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      sizeRef.current = {
        w: Math.max(1, Math.round(box.width)),
        h: Math.max(1, Math.round(box.height)),
      };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [armed, world]);

  const draw = useCallback(
    (clockSeconds: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !world) return null;
      const { w, h } = sizeRef.current;
      if (w <= 1 || h <= 1) return null;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = (ctxRef.current ??= canvas.getContext("2d"));
      if (!ctx) return null;
      // Re-applied every frame rather than on resize: writing `canvas.width` resets the
      // transform, and the two happen in the same branch often enough that tracking which
      // would cost more than the assignment.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const state = stateAt(PROGRAMMES[programme], clockSeconds);
      // This is a thumbnail beside search. City labels belong in the full article; at
      // 136–254 CSS pixels they crowd out the geography. Match the home poster treatment.
      render(
        ctx,
        world,
        { ...state, labels: 0 },
        {
          viewport: { w, h },
          palette: readPalette(canvas),
          clock: clockSeconds,
          lang,
          maxFlows: 12,
        },
      );
      return state.captionId;
    },
    [world, programme, lang],
  );

  useEffect(() => {
    if (!world || !canvasRef.current) return;
    // ⚠️ REDUCED MOTION NEVER REACHES HERE. `useArm` refuses to arm under it, so no canvas
    // mounts and no frame is ever scheduled (plan §2.9) — the guarantee lives there, and
    // `useArm.test.ts` is where it is measured. This branch is the HIDDEN-TAB pause: the
    // canvas stays mounted, the loop stops, and the picture holds where it was.
    if (!running) {
      if (draw(elapsedRef.current) !== null) setPainted(true);
      return;
    }
    let raf = 0;
    let last = 0;
    let prevCaption: string | null = null;
    const frameMs = 1000 / (sizeRef.current.w < NARROW_PX ? FPS_NARROW : FPS);
    // ⚠️ The clock is ACCUMULATED, not read from the timestamp: a band that resumed from
    // `performance.now()` after a hidden tab would jump the programme forward by however long
    // the reader was away. `last` is cleared on every (re)start, so the paused interval is
    // never added to it.
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (last === 0) last = now;
      const dt = now - last;
      if (dt < frameMs) return;
      last = now;
      elapsedRef.current += dt / 1000;
      if (elapsedRef.current >= PROGRAMMES[programme].duration) {
        setProgramme(nextProgramme(programme));
        return;
      }
      const id = draw(elapsedRef.current);
      if (id !== null) setPainted(true);
      if (id !== prevCaption) {
        prevCaption = id;
        setCaption(world ? captionFor(id, world) : null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, programme, running, draw]);

  const posterSrc = `/flyover/${programme}.webp`;
  const showCanvas = Boolean(armed && world);
  const label = caption
    ? t(caption.key, caption.params)
    : t(SCENE_ALT_KEYS[programme]);

  return (
    <section
      ref={ref}
      className={styles.band}
      aria-labelledby="flyover-heading"
      data-flyover-band={programme}
    >
      <h2 id="flyover-heading" className={styles.heading}>
        {t("flyover_heading")}
      </h2>
      <div
        className={styles.visual}
        style={{ aspectRatio: FLYOVER_ASPECT }}
        // The band as a whole is one picture to assistive technology; the caption beneath it
        // is the same sentence as live text, so a screen reader is never told to look at a map.
        role="img"
        aria-label={label}
      >
        <img
          src={posterSrc}
          alt=""
          width={FLYOVER_W}
          height={FLYOVER_H}
          loading="lazy"
          decoding="async"
          // ⚠️ Hidden only once the canvas has actually PAINTED. `render` clears to transparent
          // and never fills a background, so a poster left visible shows through as a frozen
          // t=0 ghost — the old coastline outside the new one. Hiding it on `showCanvas` alone
          // would blank the box on a browser that returns no 2D context, and for the frame
          // between mounting the canvas and the first draw. `opacity-0` rather than unmounting
          // keeps it available if the context is ever lost.
          className={`absolute inset-0 h-full w-full object-cover transition-opacity motion-reduce:transition-none ${
            painted ? "opacity-0" : ""
          }`}
        />
        {showCanvas ? (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <FlyoverCaptions caption={caption} />
      <div className={styles.controls}>
        <div className={SWITCH_ROW_CLASS}>
          <span className="sr-only" id="flyover-switch-label">
            {t("flyover_switch_label")}
          </span>
          {PROGRAMME_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === programme}
              aria-describedby="flyover-switch-label"
              onClick={() => {
                elapsedRef.current = 0;
                setProgramme(id);
              }}
              // 24 px of target around a 10 px dot: WCAG 2.2 SC 2.5.8, and no exception applies
              // — these are not inline text and there is no equivalent control on the page.
              className="grid h-6 w-6 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <span
                aria-hidden="true"
                className={`${SWITCH_DOT_CLASS} ${
                  id === programme ? "bg-foreground" : "bg-muted-foreground/40"
                }`}
              />
              <span className="sr-only">{t(SCENE_NAME_KEYS[id])}</span>
            </button>
          ))}
        </div>
        <Link
          to="/articles/2026-09-07-money-map"
          className="inline-flex min-h-6 items-center gap-1 text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("flyover_explore")} <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
};

export default HomeFlyover;
