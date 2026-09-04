// Rendered when /candidate/{bare name} names more than one PUBLIC person — the answer to a
// URL whose name really is two different humans.
//
// It exists because the alternative is worse than a dead end. Without it the page falls
// through to the legacy candidate body, which reads the NAME-folder shards
// (data/{election}/candidates/{NAME}/) — one folder per name, so two people's preference
// history is merged into one chart and published under one heading at a 200, with nothing
// saying so. Measured 2026-09-03: 1,478 name folds cover 4,092 people, and the prerendered
// indexed candidate family is exactly this bare-name form.
//
// Distinct from `CandidateNamesakeChooser`, which picks between candidacies WITHIN the
// selected election and links to `/candidate/{slug}`. This one picks between PEOPLE across
// every cycle and links to `/person/{slug}`, because the thing being disambiguated is an
// identity, not a ballot line.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { Namesake } from "@/data/candidates/useCandidatePerson";
import { useRegions } from "@/data/regions/useRegions";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { dottedDate } from "@/data/utils";

/** One line per person: the cycles they ran, on whose ballot, where. Every field here is a
 *  discriminator — two namesakes routinely share a party, so the МИР is often the only
 *  thing that separates them.
 *
 *  There is deliberately NO avatar. These rows are people who share a name fold, so
 *  `initials(displayName)` is identical on every row by construction — 40px of column
 *  carrying no information, while the fields that DO discriminate sat at text-[10px] in the
 *  muted colour. The МИР is promoted onto the person's own line for the same reason. */
const Candidacies: FC<{ rows: Namesake["candidacies"] }> = ({ rows }) => {
  const { findRegion } = useRegions();
  const { i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  // Newest first, and already capped at 4 by `candidate_person_namesakes` — the chooser
  // only has to make the person recognisable, not print their record, so the cap lives in
  // SQL rather than shipping rows the UI drops.
  return (
    <div className="mt-1 flex flex-col gap-1">
      {rows.map((c) => {
        const region = findRegion(c.oblast ?? undefined);
        const regionName = region
          ? isBg
            ? region.name
            : region.name_en || region.name
          : c.oblast;
        return (
          <div
            key={`${c.election}:${c.candidateSlug}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <span className="tabular-nums">{dottedDate(c.election)}</span>
            {c.partyNick && (
              <PartyBadge
                label={c.partyNick}
                color={c.partyColor}
                className="text-[10px]"
              />
            )}
            {regionName && (
              <span className="font-medium text-foreground">{regionName}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const PersonNamesakeChooser: FC<{
  name: string;
  people: Namesake[];
}> = ({ name, people }) => {
  const { t } = useTranslation();
  const { nameForBg } = useCandidateName();
  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Users className="h-5 w-5" />
        {nameForBg(name)}
      </h1>
      {/* Says what the page cannot do and why — not "pick one", which reads as a UI
          preference rather than as a statement about the data. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {t("person_namesake_intro")}
      </p>
      <ul className="mt-4 flex flex-col divide-y overflow-hidden rounded-md border">
        {people.map((p) => (
          <li key={p.personSlug}>
            <Link
              to={`/person/${p.personSlug}`}
              className="block px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="font-medium">{p.displayName}</span>
              <Candidacies rows={p.candidacies} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
