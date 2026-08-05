// The school finder on /education, ported onto the shared sector search.
//
// This page already HAD a finder (searchSchools.ts) — it is the one sector that
// got this right first, and the shared component was generalised from it. The
// port buys three things the hand-rolled version lacked: the pre-folded index
// (the old one re-folded every school name on every keystroke), the two-tier
// prefix/contains ranking, and the combobox/listbox ARIA the shell owns.
//
// It also widens the criteria by ONE key: `address`. The old finder matched
// name + obshtina, which already covers a town that IS its municipality
// (Банско) — the win is the 221 of 994 schools whose settlement differs from
// their obshtina, e.g. Окорш inside Дулово, which were findable only by a name
// the reader may not know.
//
// The НЕИСПУО id is deliberately NOT a key. It looks like an obvious addition —
// it is the number on every school form — but Bulgarian school names routinely
// START with a number ("130. средно училище „Стефан Караджа“"), and folding the
// id in made `130` return eight unrelated schools whose id merely contains
// those digits, with the school actually called 130 pushed to rank 29. A key
// that displaces the exact match it was meant to help is worse than no key.

import { FC, useMemo } from "react";
import { GraduationCap } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { useSchoolDirectory } from "@/data/schools/useSchoolDirectory";

export const EducationSearchBox: FC = () => {
  const dir = useSchoolDirectory();

  const index = useMemo(() => {
    if (!dir) return null;
    return buildEntityIndex(
      dir.schools,
      (s) => ({
        id: s.id,
        label: s.name,
        sub: s.obshtinaName,
        href: `/school/${s.id}`,
      }),
      // NOT s.id — see the header. `address` carries the settlement, which for
      // 221 schools is not their obshtina.
      (s) => [s.name, s.obshtinaName, s.address],
      // Rank by the latest matura score, as the old finder sorted. A school with
      // no score sorts last rather than being dropped: it is still findable.
      (s) => s.latestScore ?? 0,
    );
  }, [dir]);

  const groups = useMemo(
    () => [
      // 8 rows, the shared default — the old finder listed 30, but it rendered
      // into a full-width card whereas this is a dropdown. Deliberate change,
      // not an oversight: `гимназия` matches 464 schools and `средно` 449, so
      // neither 8 nor 30 is a browse list. Narrowing the query is the answer.
      entityGroup("school", "Училища", "Schools", index, {
        loading: !dir,
        icon: GraduationCap,
      }),
    ],
    [index, dir],
  );

  return (
    <SectorEntitySearch
      idPrefix="school-search"
      groups={groups}
      title={{ bg: "Намери своето училище", en: "Find your school" }}
      placeholder={{
        bg: "училище, община или населено място…",
        en: "school, municipality or town…",
      }}
      hint={{
        bg: "Търси по име, община или населено място — приема и изписване на латиница.",
        en: "Search by name, municipality or town — Latin-typed queries work too.",
      }}
    />
  );
};
