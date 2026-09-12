import type { Envelope, ToolArgs } from "./types";

/** The contest actually read by an answer; trends do not identify one contest. */
export const answerElection = (
  env: Envelope,
  args: ToolArgs = {},
): string | undefined => {
  const dates = new Set(
    (env.provenance ?? []).flatMap((p) => {
      const date = p.match(/^(\d{4}_\d{2}_\d{2})\//)?.[1];
      return date ? [date] : [];
    }),
  );
  if (dates.size) return dates.size === 1 ? [...dates][0] : undefined;
  return typeof args.election === "string" ? args.election : undefined;
};
