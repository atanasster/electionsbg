// The local-election cycle to surface in the SPA.
//
// `LATEST_LOCAL_CYCLE` is the newest regular cycle as a plain constant —
// used by the data pipeline (scripts/, where React hooks aren't available)
// and as the ultimate fallback. Keep it in sync with the newest entry in
// local_elections.json.
//
// `useLatestLocalCycle()` returns the cycle in effect AS OF the selected
// parliamentary election (see localAsOf / useLocalAsOf): the most recent
// regular cycle that had already concluded by the selected election date.
// With the default (newest) election selected this is the newest cycle;
// selecting an older parliamentary vote re-anchors local government to the
// cycle in effect then (e.g. the Oct-2022 vote → mi2019). This is the default
// used wherever a component or data hook doesn't pass an explicit cycle; the
// /local/<cycle> detail routes pass their cycle explicitly and are unaffected.
//
// The string format mirrors the data/<cycle>/ folder name and the
// election-selector entry suffix: "YYYY_MM_DD_mi" or "YYYY_MM_DD_chmi".

import { useLocalAsOf } from "./useLocalAsOf";

export const LATEST_LOCAL_CYCLE = "2023_10_29_mi";

export const useLatestLocalCycle = (): string => useLocalAsOf().cycle;
