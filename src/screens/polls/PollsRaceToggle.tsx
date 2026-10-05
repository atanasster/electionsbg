// The parliamentary ↔ presidential switch at the top of `/polls` and of every agency page.
//
// ⚠ THE RACE IS A PATH SEGMENT, NOT A QUERY PARAMETER: `/polls` ↔ `/polls/presidential` and
// `/polls/:agencyId` ↔ `/polls/:agencyId/presidential`. Each side is its own prerendered page
// with its own `<title>`, canonical and sitemap `<loc>` — a `?race=` toggle would put the
// presidential view behind a URL a crawler indexes as the parliamentary page. The two corpora
// also stay on separate screens, which is what `consumer_race_isolation.test.ts` requires.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PillToggle } from "@/components/ui/PillToggle";
import { usePreserveParams } from "@/ux/usePreserveParams";

export type PollsRace = "parliamentary" | "presidential";

const pollsRacePath = (race: PollsRace, agencyId?: string): string => {
  const base = agencyId ? `/polls/${encodeURIComponent(agencyId)}` : "/polls";
  return race === "presidential" ? `${base}/presidential` : base;
};

export const PollsRaceToggle: FC<{ race: PollsRace; agencyId?: string }> = ({
  race,
  agencyId,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const preserveParams = usePreserveParams();
  return (
    <div className="mt-2 mb-3">
      <PillToggle<PollsRace>
        ariaLabel={t("polls_race_label")}
        value={race}
        onChange={(next) => {
          if (next === race) return;
          const query = preserveParams().toString();
          navigate(pollsRacePath(next, agencyId) + (query ? `?${query}` : ""));
        }}
        options={[
          { value: "parliamentary", label: t("polls_race_parliamentary") },
          { value: "presidential", label: t("polls_race_presidential") },
        ]}
      />
    </div>
  );
};
