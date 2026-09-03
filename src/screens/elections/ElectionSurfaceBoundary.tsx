// The one place that decides whether a page renders the new surface or its existing body
// (Phase 2 item 2).
//
// ⚠ THE FALLBACK IS THE DEFAULT, NOT THE ERROR PATH. §12's rollback is "a missing artifact
// renders the legacy body", and v1 publishes only the latest parliamentary cycle and the latest
// two local ones — so most of the corpus takes the legacy branch by design. Anything this
// boundary cannot positively verify goes there: an unpublished cycle, an unreadable file, a
// schema version this build does not know, and every level §5.0 serves from its canonical shard.
//
// ⚠ IT RENDERS THE SURFACE ONLY FOR `schemaVersion === 1`. A future v2 is not a corrupt file, it
// is a document this build cannot read — and the difference matters because one is a defect and
// the other is a planned migration. `useElectionSurface` separates them; this only has to trust
// the separation and fall back either way.
//
// ⚠ LOADING IS NOT ABSENCE. A route param that has not resolved yet, and a fetch in flight, both
// render the CHILDREN wrapped in `aria-busy` rather than the fallback: swapping to the legacy
// body mid-load is a layout shift a reader sees, and — worse — it is silent to a screen reader,
// which is what Phase 2 item 5's `aria-busy` requirement is about.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  rendersSurface,
  useElectionSurface,
  type UseElectionSurfaceArgs,
} from "@/data/elections/useElectionSurface";
import type { ElectionSurfaceV1 } from "@/data/elections/surfaceTypes";

export type ElectionSurfaceBoundaryProps = UseElectionSurfaceArgs & {
  /** Rendered when a usable v1 surface is available. */
  children: (surface: ElectionSurfaceV1) => ReactNode;
  /** The page's existing composition. Rendered whenever the surface is not usable. */
  fallback: ReactNode;
  /** Shown while the surface resolves. Must match the final layout's dimensions (item 5). */
  skeleton?: ReactNode;
  /** The surface a `canonical` level built from its OWN shard (§5.0).
   *
   *  ⚠ THIS IS WHAT MAKES `canonical` A RENDERABLE STATE. §5.0's rule is that a level already
   *  inside its budget gets no second artifact and "the shell reads that shard through the same
   *  `surfacePath.ts` indirection and a thin adapter" — so the level is not un-migratable, it
   *  simply has no fetch. Without this the boundary could only fall back, which would leave the
   *  two most-read parliamentary levels permanently on the legacy body.
   *
   *  Absent, or undefined while the shard is still loading, keeps the fallback — the same
   *  answer a page with no adapter gets. */
  canonicalSurface?: ElectionSurfaceV1;
};

export const ElectionSurfaceBoundary: FC<ElectionSurfaceBoundaryProps> = ({
  children,
  fallback,
  skeleton,
  canonicalSurface,
  ...args
}) => {
  const { t } = useTranslation();
  const state = useElectionSurface(args);

  // ⚠ THE CANONICAL ARM COMES FIRST, before the loading branch, and deliberately: a canonical
  // level issues no request at all, so `useElectionSurface` never reports `loading` for it and
  // the adapter's own input has its own loading state on the screen. Ordering it after would
  // read as defensive and be dead code.
  if (state.status === "canonical" && canonicalSurface)
    return (
      <div data-surface-boundary="canonical">{children(canonicalSurface)}</div>
    );

  if (state.status === "loading")
    return (
      <div
        // ⚠ `aria-busy` AND a live region, because the swap is otherwise silent. The repo
        // already uses this pair; item 5 says explicitly not to invent a third pattern.
        aria-busy="true"
        aria-live="polite"
        aria-label={t("election_surface_loading")}
        data-surface-boundary="loading"
      >
        {skeleton ?? fallback}
      </div>
    );

  // ⚠ THE PREDICATE, NOT A LITERAL. `rendersSurface` is the one definition of which states may
  // render the new body; a `status === "ready"` here would be a second one.
  if (!rendersSurface(state))
    return (
      <div data-surface-boundary={state.status} data-surface-fallback>
        {fallback}
      </div>
    );

  return <div data-surface-boundary="ready">{children(state.surface)}</div>;
};
