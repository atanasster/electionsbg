import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useNoindex } from "@/lib/useNoindex";
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
