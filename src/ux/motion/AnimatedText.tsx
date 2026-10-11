import { FC } from "react";
import { useTweenedText } from "./useTweenedText";

/** A formatted figure that rolls to its new value when it changes. Pair it with
 *  `tabular-nums` so the frames do not shift the layout. */
export const AnimatedText: FC<{ value: string; duration?: number }> = ({
  value,
  duration,
}) => <>{useTweenedText(value, duration)}</>;
