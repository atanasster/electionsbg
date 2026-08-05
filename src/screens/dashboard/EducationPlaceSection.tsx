// The education block of a Governance place node — one place code in, the two
// tiles out, or nothing at all.
//
// It exists so the aliasing lives in ONE place: three of the 28 region pages
// (Sofia's МИР trio) and one more (Пловдив-град) read another place's blob,
// because МОН publishes those places as single aggregates. The disclosure that
// they are doing so is not optional — showing Sofia city's numbers on the S24
// page without a word would state МИР-grain data we do not have.
//
// Self-hides for a diaspora МИР, a place with no matura school, and a database
// where the loader has not run yet. That last case is why an error hides too
// rather than rendering a broken card: a cloud database mid-rollout should look
// like a page without an education section, not like a page with a wound.

import { FC, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { useEducationPlace } from "@/data/schools/useEducationPlace";
import type { PlaceAliasReason } from "@/data/schools/educationPlaceKey";
import { DashboardSection } from "./DashboardSection";
import { EducationPlaceTile } from "./EducationPlaceTile";
import { EducationExpectedTile } from "./EducationExpectedTile";

type Props = {
  /** Oblast code (`SML`, `S23`) or obshtina code (`SML10`, `SOF00`). */
  code: string;
  /** Which wrapper the two tiles come in. The wrapper cannot move to the
   *  caller: this component owns the self-hide, and a caller composing
   *  `<DashboardSection><Tiles/></DashboardSection>` would render an empty
   *  header on every place with no matura school — 52 of them today. So the
   *  choice comes in as a prop instead: `"section"` for pages built from
   *  section kickers (the region node), `"none"` for a flat run of cards
   *  (the município node). */
  chrome?: "section" | "none";
};

/** Warned-about codes, so a re-render or a second visit doesn't re-log. */
const warned = new Set<string>();

/** One sentence per reason a place shows a broader aggregate's numbers. A
 *  lookup rather than a ternary ladder: the list grew to four the moment the
 *  Пловдив/Варна районы joined, and each entry is a claim a reader will hold
 *  us to. */
const ALIAS_NOTE_KEY: Record<
  NonNullable<PlaceAliasReason>,
  `education_place_${string}`
> = {
  "sofia-city": "education_place_sofia_note",
  "sofia-city-raion": "education_place_sofia_raion_note",
  "city-raion": "education_place_city_raion_note",
  "plovdiv-province": "education_place_plovdiv_note",
};

export const EducationPlaceSection: FC<Props> = ({
  code,
  chrome = "section",
}) => {
  const { t } = useTranslation();
  const { place, aliasReason, isError } = useEducationPlace(code);

  // An absent blob is a legitimate empty and stays silent; a FAILED read is
  // not. Without this, a cloud database where db:load:schools:pg:cloud never
  // ran serves all 28 region pages at a 200 with the section simply missing —
  // identical to the site before this shipped, and nothing red anywhere. Same
  // discipline as the `psp:` / `pp:` one-shot logs in the db routes.
  useEffect(() => {
    if (isError && !warned.has(code)) {
      warned.add(code);
      console.warn(`education:place-read-failed ${code}`);
    }
  }, [isError, code]);

  if (!place) return null;

  const aliasNote = aliasReason ? t(ALIAS_NOTE_KEY[aliasReason]) : null;

  const tiles = (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*:only-child]:lg:col-span-2">
      <EducationPlaceTile place={place} aliasNote={aliasNote} />
      {/* Renders null when the place has no residual to speak from, and the
          grid then gives the headline the full width. */}
      <EducationExpectedTile place={place} />
    </div>
  );

  // `id` rather than nothing: DashboardSection gives the section-chromed
  // variant an #education anchor, and the bare one is linked to from the same
  // places.
  if (chrome === "none") return <div id="education">{tiles}</div>;

  return (
    <DashboardSection
      id="education"
      title={t("governance_section_education") || "Education"}
      icon={GraduationCap}
    >
      {tiles}
    </DashboardSection>
  );
};
