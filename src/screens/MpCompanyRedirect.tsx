// /mp/company/:slug — retired. This is the tombstone that keeps its inbound links alive.
//
// The route was keyed on the company name a declarant typed, which is not an identity: the
// declaration form carries no EIK, and the page attached one on a name-uniqueness check alone
// (tr/integrate.ts). Migration 096 declines 1,751 of the 2,120 links that method made. Its
// content now lives on /company/:eik, gated, and covering every declarant tier rather than MPs
// alone. Plan: docs/plans/company-page-consolidation-v1.md (Tier 2).
//
// WHY A REDIRECT AT ALL, when the route has no sitemap <loc>, no prerender entry and no
// og:image: two published articles linked it in both languages and rode into llms-full.txt,
// and bookmarks outlive artifacts. Those article links are repointed, but the corpus is
// crawled and the old URLs are in the wild.
//
// ⚠️ THREE DESTINATIONS, AND THE ORDER IS THE POINT.
//
//   1. The EIK, when the index carries one — the real page, with the real content.
//   2. Otherwise the DECLARANT, when exactly one declared it. 808 of the 816 EIK-less entries
//      have exactly one, and their whole content is that person's declaration, which their own
//      profile renders with 096's reason attached. Sending a reader there is not a
//      consolation: it is strictly more than the retired page told them.
//   3. Otherwise the list. Never a 404, and never an invented company page.
//
// ⚠️ IT RESOLVES THROUGH companies-index.json, WHICH TIER 5 DELETES. When that lands this
// component loses arms 1 and 2 and silently degrades to arm 3 for every slug — which is not a
// broken page, but it is a worse answer, and it will not announce itself. Tier 5 must either
// re-point the resolution at Postgres or drop this route deliberately. Do not let it rot into
// "everything goes to the list" by default.

import { FC } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useCompanyIndex } from "@/data/parliament/useCompanyIndex";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";

/** Where /mp/companies lives. One constant so the Tier 3 rename has a single site here. */
const COMPANIES_LIST = "/mp/companies";

export const MpCompanyRedirect: FC = () => {
  // ⚠️ NO decodeURIComponent HERE. React Router has already decoded the param, and on a
  // malformed escape it hands back the RAW segment — so a second decode throws URIError
  // during render. There is no ErrorBoundary anywhere in src/, which turns `/mp/company/%zz`
  // into a blank app, on the one route whose entire contract is "never dead-end". The
  // retired screen carried the same line; it was survivable there because the page could
  // afford to fail, and it is not survivable here.
  const { slug = "" } = useParams();
  const { bySlug, isLoading } = useCompanyIndex();

  // The index is a single eagerly-fetched file. Redirecting before it lands would send every
  // visitor to the list, so the resolution waits — and renders nothing rather than a spinner,
  // because this page is a hop, not a destination.
  if (isLoading) return null;

  const entry = slug ? bySlug.get(slug) : undefined;

  const uic = entry?.tr?.uic;
  if (uic)
    return <Navigate to={`/company/${encodeURIComponent(uic)}`} replace />;

  // ⚠️ A PARTY IS NOT A COMPANY, and this arm must precede the declarant one. All five
  // entries carrying a Court-of-Audit financing slug are political parties, none has an EIK
  // (parties register with the Sofia City Court, not the Commerce Registry), and three of
  // them have exactly ONE declarant — so without this they would redirect to a single MP's
  // profile, publishing „ГЕРБ" as one member's affair. The annual-report register is the
  // page that was actually reachable from here before, via PartyAnnualReportPanel.
  const financing = entry?.financing?.slug;
  if (financing)
    return (
      <Navigate
        to={`/financing/annual-reports/${encodeURIComponent(financing)}`}
        replace
      />
    );

  // EXACTLY one declarant, never "the first of several". Two MPs declaring one company is a
  // finding about the company, and picking one of them to redirect to would publish half of
  // it as the whole.
  const declarants = new Set((entry?.stakes ?? []).map((s) => s.mpId));
  if (declarants.size === 1) {
    const [mpId] = [...declarants];
    if (mpId != null) return <Navigate to={candidateUrlForMp(mpId)} replace />;
  }

  return <Navigate to={COMPANIES_LIST} replace />;
};
