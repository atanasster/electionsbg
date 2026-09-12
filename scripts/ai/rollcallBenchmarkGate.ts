import { ROLLCALL_VERSION } from "../../src/lib/rollcallQuery";
export const CAPABILITY_WARM_TARGET_MS = 500;
export function capabilityReady(value: unknown): boolean {
  const c = value as {
    version?: string;
    revision?: string;
    corpora?: Record<string, { ready?: boolean; revision?: string }>;
  } | null;
  return (
    c?.version === ROLLCALL_VERSION &&
    !!c.revision &&
    [
      "parliamentSessions",
      "parliamentVotes",
      "parliamentCasts",
      "councilSessions",
      "councilResolutions",
      "councilCasts",
    ].every((name) => !!c.corpora?.[name]?.ready && !!c.corpora[name].revision)
  );
}
export const warmP95 = (samples: number[]) => {
  const warm = samples.slice(1).sort((a, b) => a - b);
  return warm.length >= 6 ? warm[Math.ceil(warm.length * 0.95) - 1] : Infinity;
};
export const capabilityGate = (responses: unknown[], samples: number[]) =>
  responses.length === samples.length &&
  samples.length >= 7 &&
  responses.every(capabilityReady) &&
  warmP95(samples) < CAPABILITY_WARM_TARGET_MS;
