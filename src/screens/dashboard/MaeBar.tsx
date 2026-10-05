import { FC } from "react";
import { agencyMaeBarStyle } from "./agencyMaeBar";

/** One agency's MAE as a filled track — the bar every polls leaderboard draws, so its width and
 *  colour come from `agencyMaeBarStyle` in one place. */
export const MaeBar: FC<{ mae: number; maxMae: number }> = ({
  mae,
  maxMae,
}) => {
  const { widthPct, hue } = agencyMaeBarStyle(mae, maxMae);
  return (
    <div className="relative h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="absolute top-0 bottom-0 left-0 rounded-full"
        style={{
          width: `${widthPct}%`,
          backgroundColor: `hsl(${hue} 70% 45%)`,
        }}
      />
    </div>
  );
};
