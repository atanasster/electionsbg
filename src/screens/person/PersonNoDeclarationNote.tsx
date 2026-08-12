// "No declaration" and "not required to file" are different facts, and the page used to
// render them identically — as nothing at all.
//
// Every declarations block on /person self-hides when it finds no filing. For a кмет на
// кметство that is not an absence of data, it is the law: ЗПК чл. 6 lists кметовете и
// зам.-кметовете на общини и на райони, председателите на общинските съвети, общинските
// съветници и гл. архитекти — village mayors are not among them. Confirmed against the
// register rather than assumed: `register.cacbg.bg/2025/list.xml` (95 categories, 15,935
// positions) contains the substring "кметств" ZERO times, and our own corpus mirrors it —
// the `muni` tier holds exactly five position titles, none of them this one.
//
// They do file, under чл. 49, with their own общински съвет's standing commission, and each
// municipality publishes its own register. We do not hold those (docs/plans/
// village-mayor-attribution-v1.md §T4b sizes that ingest), so the honest statement is
// "outside the central register", not "did not declare".
//
// DRIVEN OFF THE ROLE, not off the missing row. A missing row has two causes — never
// required, or required and absent — and only the office can tell them apart.
//
// AN ALLOWLIST OF EXEMPT OFFICES, not a denylist of filing ones, and the difference is the
// whole correctness of this component. The obvious form — "hide if they hold an
// official_muni / official_exec / mp / magistrate role" — is CIRCULAR: every one of those
// sources is minted from `official_roster`, which is built from the register scrape, so such
// a role exists only BECAUSE a filing exists. A person whose чл. 6 office is known solely
// from the local-election results and who filed nothing therefore has no suppressing role,
// and the note fires on precisely the people it must never excuse. Measured on the live
// database at the time of writing: 191 such people — 187 общински съветници and 4 КМЕТОВЕ НА
// ОБЩИНИ, all with zero declaration rows, each of whom would have been told their office
// carries no filing duty.
//
// Inverted, an unclassified or newly-added office defaults to NOT exempt, so the failure
// mode is a missing explanation rather than a false excuse.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import { DeclarationsSection } from "./DeclarationsSection";
import { Card, CardContent } from "@/ux/Card";

/** The offices that genuinely fall outside the central register. `local`/`village_mayor` is
 *  the whole list today: ЗПК чл. 6 names кметове и зам.-кметове на общини и райони,
 *  председатели на общински съвети, общински съветници and главни архитекти — every other
 *  local office is IN, and a candidacy (`candidate`) confers no office at all. */
const isExemptOffice = (r: { source: string; role: string }): boolean =>
  r.source === "local" && r.role === "village_mayor";

/** Roles that are not an OFFICE at all — a company directorship, an NGO board seat, a
 *  candidacy, a donation. They neither create nor excuse a filing duty, so they must not
 *  count against the "every office is exempt" test. */
const isOffice = (r: { source: string; role: string }): boolean =>
  !["tr", "ngo", "candidate", "donor"].includes(r.source);

export const PersonNoDeclarationNote: FC<{
  roles: { source: string; role: string }[];
}> = ({ roles }) => {
  const { t } = useTranslation();
  const offices = roles.filter(isOffice);
  // Every office they hold must be exempt. One чл. 6 office anywhere in the list and their
  // blank declarations block is a gap, not an exemption — so say nothing rather than excuse it.
  if (!offices.length || !offices.every(isExemptOffice)) return null;
  // Rendered as the declarations SECTION, with the same id and heading PersonDeclarations
  // would have used. Every declarations-adjacent block above self-hides, so for exactly this
  // population the page has no assets heading at all — a bare paragraph would land between
  // the electoral block and "Длъжности" with nothing to attach it to. The absence should
  // occupy the slot the presence would have.
  return (
    <DeclarationsSection>
      <Card>
        <CardContent className="flex items-start gap-2 pt-6 text-sm text-muted-foreground">
          <FileQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("pp_no_central_declaration", {
              defaultValue:
                "Кметовете на кметства не са задължени да подават декларации в централния регистър на Сметната палата — длъжността не е сред изброените в чл. 6 от ЗПК. Те декларират пред постоянната комисия на своя общински съвет, която води отделен регистър на сайта на съвета; той не е включен тук.",
            })}
          </span>
        </CardContent>
      </Card>
    </DeclarationsSection>
  );
};
