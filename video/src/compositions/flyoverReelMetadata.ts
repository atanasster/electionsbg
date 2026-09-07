import type { CalculateMetadataFunction } from "remotion";
import {
  applyPartial,
  cloneState,
  STATE_ZERO,
  type FlyoverState,
} from "../../../src/lib/flyover/state";
import { EXPLAINER_TAIL_SECONDS } from "../lib/audio";
import type { ExplainerScene, ExplainerSpec } from "../lib/spec";

export type FlyoverReelEdit = {
  id: number;
  /** Keep a complete, already-approved passage from the source scene. */
  voiceOver: string;
  onScreen: string;
  body?: string;
  /** Bounds in the source WAV, measured at silent sentence boundaries. */
  trimStartSeconds: number;
  trimEndSeconds: number;
};

/**
 * The plan's scenes 1, 2 and 4, re-cut to complete sentences from the approved
 * explainer narration. This keeps the social cut inside 25–50 seconds without
 * speeding up the voice or commissioning a separate script/recording.
 */
export const MONEY_MAP_REEL_EDITS: readonly FlyoverReelEdit[] = [
  {
    id: 1,
    voiceOver:
      "Петдесет и шест цяло и шест процента от сумата е при възложители със седалище в София. Това е мястото на купувача, не непременно мястото на работата.",
    onScreen: "56,6%",
    body: "По седалище на възложителя · не по място на работата",
    trimStartSeconds: 6.85,
    trimEndSeconds: 18.5,
  },
  {
    id: 2,
    voiceOver:
      "Към изпълнителя имаме двата края за четирийсет и три цяло и девет милиарда евро от деветдесет и четири цяло и две.",
    onScreen: "€43,9 млрд. / €94,2 млрд.",
    body: "Когато знаем и възложителя, и изпълнителя",
    trimStartSeconds: 0.25,
    trimEndSeconds: 10.35,
  },
  {
    id: 4,
    voiceOver:
      "При земеделските субсидии картата се обръща. Пловдив е първи с осемстотин и деветнайсет милиона евро, следван от София със седемстотин и седемнайсет и Добрич с шестстотин деветдесет и осем.",
    onScreen: "819 · 717 · 698 млн. €",
    body: "София 717 млн. € · Добрич 698 млн. €",
    trimStartSeconds: 0.25,
    trimEndSeconds: 16.55,
  },
];

export type MaterializedFlyoverReelScene = ExplainerScene<FlyoverState> &
  FlyoverReelEdit;

export type FlyoverReelProps = {
  spec: ExplainerSpec<FlyoverState>;
  edits: readonly FlyoverReelEdit[];
  /** Filled by calculateMetadata from the selected scenes' narration. */
  sceneDurations: number[];
  /** Social video autoplays muted, so this is true in the registered cut. */
  captions: boolean;
};

/**
 * Select cutdown scenes without changing the persistent canvas story.
 *
 * A scene carries a PARTIAL state. Scene 4, for example, relies on scene 3 to
 * turn scene 2's arcs and Sofia highlight off. A naive `[1, 2, 4]` filter would
 * therefore render the wrong map. Resolve every preceding patch first, then
 * attach a full snapshot to each selected scene.
 */
export const materializeFlyoverCutdown = (
  spec: ExplainerSpec<FlyoverState>,
  edits: readonly FlyoverReelEdit[],
): MaterializedFlyoverReelScene[] => {
  const sceneIds = edits.map((edit) => edit.id);
  if (new Set(sceneIds).size !== edits.length) {
    throw new Error("Flyover cutdown scene ids must be unique");
  }

  const resolved = new Map<number, ExplainerScene<FlyoverState>>();
  let state = cloneState(STATE_ZERO);
  for (const scene of spec.scenes) {
    state = applyPartial(state, scene.canvas ?? {});
    resolved.set(scene.id, { ...scene, canvas: cloneState(state) });
  }

  return edits.map((edit) => {
    const scene = resolved.get(edit.id);
    if (!scene) {
      throw new Error(`Unknown flyover cutdown scene: ${edit.id}`);
    }
    if (
      edit.trimStartSeconds < 0 ||
      edit.trimEndSeconds <= edit.trimStartSeconds
    ) {
      throw new Error(
        `Invalid audio trim for flyover cutdown scene: ${edit.id}`,
      );
    }
    return { ...scene, ...edit };
  });
};

export const flyoverReelDurations = (
  edits: readonly FlyoverReelEdit[],
  fps: number,
  tempo = 1,
): number[] =>
  edits.map((edit) => {
    const trimBefore = Math.round(edit.trimStartSeconds * fps);
    const trimAfter = Math.round(edit.trimEndSeconds * fps);
    const spokenFrames = (trimAfter - trimBefore) / tempo;
    return Math.max(1, Math.ceil(spokenFrames + EXPLAINER_TAIL_SECONDS * fps));
  });

export const assertFlyoverReelRuntime = (total: number, fps: number): void => {
  const seconds = total / fps;
  if (seconds < 25 || seconds > 50) {
    throw new Error(
      `Flyover reel must be 25–50s; measured ${seconds.toFixed(2)}s`,
    );
  }
};

export const calculateFlyoverReelMetadata: CalculateMetadataFunction<
  FlyoverReelProps
> = async ({ props }) => {
  const fps = 30;
  materializeFlyoverCutdown(props.spec, props.edits);
  const durations = flyoverReelDurations(
    props.edits,
    fps,
    props.spec.voice.tempo ?? 1,
  );
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  assertFlyoverReelRuntime(total, fps);
  return {
    durationInFrames: total,
    fps,
    props: { ...props, sceneDurations: durations },
  };
};
