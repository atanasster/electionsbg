// The data bucket, in ONE place.
//
// ⚠️ IT WAS RESTATED FOUR TIMES AND THE FIFTH COPY WAS WRONG. `gen_home/health.ts` wrote
// `electionsbg-data`, which is not a bucket that exists, so `home:health -- --public` reported
// both home artifacts unpublished on every run no matter what was on the bucket — and its
// `drifted` branch, the one state that check was added for, sat unreachable behind the `!r.ok`
// guard. A smoke test could not catch it either: the home objects were not published yet, so
// the correct bucket 404s too.
//
// ⚠️ IMPORT-FREE ON PURPOSE. The natural home looked like `check_generated_artifacts.ts`, which
// already had a correct copy — but that module runs its `main()` at import time, so importing
// the constant from it made `home:health` perform a full nine-artifact bucket audit as a side
// effect of starting up. A constant that several tools share cannot live in a script that does
// something when you load it.

/** `gsutil` form, for `rsync` / `cp` / `rm`. */
export const BUCKET_GS = "gs://data-electionsbg-com";
/** HTTPS form, for a `fetch` — what the browser reads. */
export const BUCKET_URL = "https://storage.googleapis.com/data-electionsbg-com";
