import { useSearchParams } from "react-router-dom";

// Persistent "Compare with EU peers" toggle for the IndicatorsScreen.
// State lives in the URL search param `compare=1` so the user can copy the
// current address and share the exact view (snapshot strips + peer lines on
// vs. clean BG view off). Default is OFF — a first-time visitor sees only
// Bulgarian indicators, with the comparison discoverable via the toggle
// button in each peer-aware section header.

const PARAM_NAME = "compare";

export const useCompareToggle = (): [boolean, () => void] => {
  const [params, setParams] = useSearchParams();
  const enabled = params.get(PARAM_NAME) === "1";

  const toggle = () => {
    // Build a fresh copy so we don't mutate the live URLSearchParams reference
    // react-router hands us. `replace: true` keeps the toggle from polluting
    // browser history — a user clicking back from /indicators?compare=1 should
    // land at the previous page, not toggle the overlay off mid-route.
    const next = new URLSearchParams(params);
    if (enabled) next.delete(PARAM_NAME);
    else next.set(PARAM_NAME, "1");
    setParams(next, { replace: true });
  };

  return [enabled, toggle];
};
