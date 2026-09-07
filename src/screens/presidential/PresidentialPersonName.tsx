// A candidate's name, linked to their `/person` page where the corpus can name exactly one.
//
// ⚠ NOT A COMPONENT THAT DECIDES — the decision was made at build time by
// `build_ticket_persons.ts`, which REFUSES a shared name rather than scoring candidates. All
// this does is render the refusal as plain text, and say WHY when the reason is ambiguity:
// „no link" and „several people have this name" are different facts, and only the second is
// worth a reader's attention.
//
// ⚠ EXTRACTED SO THE TWO RANKINGS CANNOT DISAGREE. `/presidential/:cycle` now renders the same
// candidate twice — once in the canvas's concise list beside the map, once in the full table
// below it — and a second copy of this rule would be a page that links a name in one place and
// refuses it in the other, about the same person, in the same document.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  namesakeCountForTicket,
  personHrefForTicket,
} from "@/data/presidential/ticketPersons";

export const PresidentialPersonName: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation();
  const href = personHrefForTicket(name);
  if (href)
    return (
      <Link className="underline" to={href}>
        {name}
      </Link>
    );
  const namesakes = namesakeCountForTicket(name);
  return (
    <>
      {name}
      {/* ⚠ THE EXPLANATION IS NOT IN A `title`. A tooltip reaches a mouse and nothing else —
          not touch, not a keyboard, and a screen reader only sometimes — so the mark carries
          the reason as its accessible name instead, and the visible text stays short. */}
      {namesakes > 1 ? (
        <span className="ml-1 text-xs text-muted-foreground">
          <span aria-hidden="true">{t("presidential_namesake_mark")}</span>
          <span className="sr-only">
            {t("presidential_namesake_hint", { count: namesakes })}
          </span>
        </span>
      ) : null}
    </>
  );
};
