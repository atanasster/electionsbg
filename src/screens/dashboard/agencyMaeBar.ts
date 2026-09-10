// The MAE→bar/color formula shared by `PollsTile.tsx` (parliamentary) and
// `PresidentialPollsTile.tsx` — extracted so a future tuning of the mapping
// cannot silently drift between the two: a bar that reads as "good" on one
// page and "bad" on the other, for the same numeric miss, is the failure
// this module exists to rule out.

export const agencyMaeBarStyle = (
  mae: number,
  maxMae: number,
): { widthPct: number; hue: number } => ({
  widthPct: Math.max(2, (mae / maxMae) * 100),
  hue: Math.max(0, 140 - mae * 30),
});

export const missSign = (error: number): string => (error > 0 ? "+" : "");

export const missColorClass = (error: number): string =>
  error > 0 ? "text-emerald-600" : "text-rose-600";
