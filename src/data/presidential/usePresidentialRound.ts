// The presidential round on screen, read from and written to the shared `pollRound` parameter.
// ⚠ ROUND 1 IS THE DEFAULT (art. 93 (3) is a test on round 1), and an unavailable round
// resolves to round 1, so a link carrying `pollRound=2` into a place with no runoff never
// selects a round that is not there.

import { useSearchParams } from "react-router-dom";
import { ROUND_PARAM } from "./roundParam";

/** The round on screen and its setter, validated against the rounds this page actually has. */
export const usePresidentialRound = (
  available: readonly (1 | 2)[],
): [1 | 2, (r: 1 | 2) => void] => {
  const [params, setParams] = useSearchParams();
  const round: 1 | 2 =
    params.get(ROUND_PARAM) === "2" && available.includes(2) ? 2 : 1;
  const setRound = (value: 1 | 2) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(ROUND_PARAM, String(value));
        return next;
      },
      { replace: true },
    );
  return [round, setRound];
};
