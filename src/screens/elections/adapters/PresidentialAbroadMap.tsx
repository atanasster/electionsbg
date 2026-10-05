// The presidential abroad map, as a shell adapter — every country with a station, coloured by
// the leading ticket. See `PresidentialAbroadMap` for why it is drawn by country and how the
// six continent geometry files serve as the country→continent crosswalk.

import { FC } from "react";
import { PresidentialAbroadMap as Map } from "@/screens/presidential/PresidentialAbroadMap";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const PresidentialAbroadMap: FC<ElectionMapAdapterProps> = ({
  cycle,
  round,
}) => <Map cycle={cycle} round={round === 2 ? 2 : 1} />;

export default PresidentialAbroadMap;
