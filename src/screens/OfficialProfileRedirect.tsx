// /officials/:slug → /person/:slug (T1.3). OfficialProfileScreen is retired — the person
// profile is the single surface (Decision 1). A hard hit is 301'd by the `db` Cloud
// Function before the SPA loads (T1.1), but an in-app <Link to="/officials/x"> is a
// client-side React Router navigation with no server round-trip, so ~15 call sites
// (connections, procurement, my-area) would 404 without a client redirect.
//
// It resolves through the SAME officials_person_slug() the 301 uses (via /api/db/
// officials-person), so both a current officials ref AND a re-slug-retired one land
// correctly — a naive `/person/${slug}` rewrite would silently send the 10.4% of slugs
// that no longer equal their person slug to a wrong or nonexistent page.

import { FC } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { NotFound } from "@/screens/NotFound";

const fetchPersonSlug = async (slug: string): Promise<string | null> => {
  const r = await fetch(
    `/api/db/officials-person?slug=${encodeURIComponent(slug)}`,
  );
  // THROW on a transient failure (5xx / network); return null ONLY for the genuine
  // "resolves to nobody" (HTTP 200 + personSlug: null). Collapsing the two — as an
  // `if (!r.ok) return null` would — turns a momentary API blip into a hard 404 for a URL
  // a real person exists behind. useQuery retries the throw; the null is final.
  if (!r.ok) throw new Error(`officials-person: ${r.status}`);
  const body = (await r.json()) as { personSlug: string | null };
  return body.personSlug;
};

export const OfficialProfileRedirect: FC = () => {
  const { slug } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["officials_person", slug] as [string, string | undefined],
    queryFn: () => fetchPersonSlug(slug as string),
    enabled: !!slug,
    staleTime: Infinity,
    retry: 2,
  });

  if (!slug) return <NotFound />;
  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Resolved to a live person → replace history so the retired /officials URL leaves no
  // back-button trap. A genuine null (resolves to nobody, after a 200) OR a persistent
  // lookup failure (isError, after retries) → the app's own 404, never a bounce to a
  // plausible-looking wrong page.
  if (data && !isError) return <Navigate to={`/person/${data}`} replace />;
  return <NotFound />;
};
