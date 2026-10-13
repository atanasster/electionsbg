import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useNoindex } from "@/lib/useNoindex";
import type { CandidateRoute } from "@/data/candidates/useCandidateRoute";
import { ErrorSection } from "../ErrorSection";

/** Placeholder while a /candidate/:id URL resolves or probes other elections.
 * Reserves height so the swap to the real page doesn't shift the layout. */
export const CandidateResolving: FC<{ minHeight?: string }> = ({
  minHeight = "min-h-[1200px]",
}) => {
  const { t } = useTranslation();
  return (
    <div className="w-full py-6">
      <div className="text-sm text-muted-foreground text-center">
        {t("loading") || "Loading…"}
      </div>
      <div aria-hidden className={minHeight} />
    </div>
  );
};

/** A slug URL (`mp-`/`c-`) that resolves in no election. Says so explicitly
 * — the alternative is an empty body under the homepage's head — and keeps the
 * page out of the index. */
export const CandidateNotFound: FC = () => {
  const { t } = useTranslation();
  useNoindex();
  return (
    <ErrorSection
      title={t("candidate_not_found_title") || "Candidate not found"}
      description={t("candidate_not_found_desc") || ""}
    />
  );
};

/** A fetch failed before we could tell whether the candidate exists. Not a
 * not-found: no noindex, since the page may be perfectly real. */
export const CandidateLoadError: FC = () => {
  const { t } = useTranslation();
  return <ErrorSection title={t("data_load_failed")} />;
};

/** What a /candidate/:id sub-route renders while it has no name to render
 * from: a placeholder while resolving, else an error or a not-found. */
export const CandidateRouteFallback: FC<{
  route: Pick<CandidateRoute, "isResolving" | "isError">;
}> = ({ route }) => {
  if (route.isResolving)
    return <CandidateResolving minHeight="min-h-[800px]" />;
  return route.isError ? <CandidateLoadError /> : <CandidateNotFound />;
};
