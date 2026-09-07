import type { VoiceableSpec } from "../lib/spec";
import { e1 } from "./e1-inflation";
import { e2 } from "./e2-risk";
import { e3 } from "./e3-money-map";
import { v3 } from "./v3-real-screen";

/** One registry for every CLI that consumes narration-bearing video specs. */
export const VOICEABLE_SPECS: Record<string, VoiceableSpec> = {
  e1,
  e2,
  "e3-money-map": e3,
  v3,
};
