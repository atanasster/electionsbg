// The home dashboard's loading skeleton, lifted out of DashboardCards so it can
// also serve as the route-level Suspense fallback for the index route.
//
// Why it lives in its own module: DashboardScreen is lazy (see routes.tsx), and
// its chunk carries the whole map stack (react-leaflet + d3). The fallback has
// to render at wave 1, from the entry chunk, so it must NOT reach into
// DashboardCards — importing that would drag vendor-leaflet and vendor-charts
// back onto the critical path and trip the entry-static-import gate in
// tests/perf.spec.ts. Hence: no data hooks, no i18n, no UI primitives beyond
// plain divs. DashboardCards imports the two pieces back from here, so there is
// one definition of the shape.

import { FC } from "react";

export const SkeletonCard: FC<{ className?: string }> = ({
  className = "h-[160px]",
}) => (
  <div
    className={`rounded-xl border bg-card p-4 shadow-sm animate-pulse ${className}`}
  >
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

export const SkeletonSection: FC<{ rows?: number }> = ({ rows = 1 }) => (
  <section className="mt-8 first:mt-2">
    <div className="h-3 w-32 bg-muted rounded mb-4 animate-pulse" />
    <div className="flex flex-col gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </section>
);

// Route-level fallback. DashboardCards gates two of its skeleton sections on
// electionStats; that state is not available before the screen chunk loads, so
// this renders the unconditional shape — the four KPI cards plus the four
// always-present sections. It reserves real vertical space, which the shared
// RouteFallback (an empty min-h-[40vh] div) does not: the landing page used to
// paint this grid straight from the entry chunk, and a blank interval here
// would be both a perceived-performance regression and a layout-shift source
// on the site's highest-traffic route.
export const DashboardSkeleton: FC = () => (
  <section className="my-4">
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
    <SkeletonSection rows={2} />
    <SkeletonSection rows={2} />
    <SkeletonSection rows={2} />
    <SkeletonSection rows={2} />
  </section>
);
