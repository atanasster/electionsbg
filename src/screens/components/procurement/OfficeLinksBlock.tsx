// „Политически връзки" — the REGISTRY basis, beside the procurement one.
//
// WHY IT EXISTS. The existing block reads `company_politicians` (008), which is
// procurement-derived: its arms INNER JOIN contract money, so it is silent about any shared
// company that never won a public contract. `/person/ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ` therefore
// published „Политически връзки (0)" directly beneath a connection check that had just named
// Антон Йорданов Адамов, народен представител в 45 НС, as a co-съдружник in two of his
// companies. The zero was structural. See `200_person_office_links.sql` for the guards.
//
// ⚠️⚠️ THIS BLOCK NAMES A LIVING POLITICIAN AND A PRIVATE INDIVIDUAL IN ONE SENTENCE, so the
// wording carries more weight than the number. Four rules, all load-bearing:
//
//  1. IT SAYS WHAT THE EVIDENCE IS, ALWAYS. Every row states the company and — on the company
//     page — the bridge person, because the whole claim is „these names appear together in
//     the Търговски регистър" and a reader must be able to check it there. A row without its
//     company would be an assertion with no way to verify it.
//  2. IT NAMES THE OFFICE, NEVER JUST „политик". „народен представител в 45 НС" and „общински
//     съветник 2007" are both political links and they are not remotely the same claim. The
//     office list comes from the payload; nothing here invents a label.
//  3. IT IS A LEAD, NOT PROOF. The match is on a folded NAME — the registry publishes no
//     personal id — so the basis line says so in the block, not in a tooltip. The SQL already
//     refuses any fold that is not provably one person (70.7% of candidates), but „we checked
//     it is one person in our data" is not „this is definitely that person".
//  4. IT NEVER RENDERS AS AN ACCUSATION. Co-registration is a fact about a registry, not a
//     finding about conduct. No „риск", no „съмнително", no count in a headline.
//
// Self-suppresses when the payload is null (migration 200 not applied on the serving
// database) or empty. A reader then sees exactly what they saw before this shipped.
//
// Plan: docs/plans/consortium-member-visibility-v1.md §6 → docs/plans/political-links-registry-basis-v1.md

import { FC } from "react";
import { Link } from "react-router-dom";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
// The one party pill on the site — shared so the readable-text contrast fix lives in one
// place, and so this block cannot invent a second look for the same thing.
import { PartyBadge } from "@/screens/components/PartyBadge";
import { decodeEntities } from "@/lib/decodeEntities";
// `в` → `във` before a В-/Ф-initial name. Reused rather than restated: the reference case
// itself is „ВИ 8 СТУДИОС", so „в ВИ 8 СТУДИОС" was the very first row this block rendered.
import { bgIn } from "@/lib/judicialKind";

/** One office a linked person holds, as `person_role` records it. */
export type OfficeRole = {
  source: string;
  role: string;
  party?: string | null;
};

export type OfficeLink = {
  slug: string;
  display_name: string;
  offices: OfficeRole[];
  uic: string;
  registryName?: string;
  roles?: string | null;
  company?: string | null;
  /** Company page only: the person who bridges this company to the office-holder. */
  viaName?: string | null;
  /**
   * Party short name and its brand colour, from `graph_person_node`.
   *
   * ⚠️ NULL MEANS „NOT KNOWN", NEVER „INDEPENDENT". Affiliation is only recorded for people
   * the election corpus lists on a party ticket — 1,521 of 8,238 linkable office-holders
   * (18.5%) — so a missing party must render NOTHING rather than a neutral „независим" pill,
   * which would be a claim the corpus does not support. The 2007 municipal councillor in the
   * reference case is exactly this: a real office-holder with no party on file.
   */
  party?: string | null;
  partyColor?: string | null;
};

export type OfficeLinksPayload = {
  links: OfficeLink[];
  count: number;
  basis: string;
};

/**
 * Bulgarian label per `person_role.source`, because „политик" is not a claim any of these
 * rows supports on its own. `local` is deliberately split by `role`: a mayor and a councillor
 * are different offices and the payload distinguishes them.
 */
const OFFICE_BG: Record<string, string> = {
  mp: "народен представител",
  mep: "евродепутат",
  president: "президент",
  official_exec: "ръководна длъжност в изпълнителната власт",
  official_muni: "ръководна длъжност в община",
  magistrate: "магистрат",
  regulator: "регулаторен орган",
  diplomat: "дипломат",
};

const LOCAL_BG: Record<string, string> = {
  councillor: "общински съветник",
  mayor: "кмет",
  rayon_mayor: "кмет на район",
  village_mayor: "кметски наместник",
};

const officeLabel = (o: OfficeRole): string =>
  o.source === "local"
    ? (LOCAL_BG[o.role] ?? "изборна местна длъжност")
    : (OFFICE_BG[o.source] ?? o.role);

/** Deduped, stable office list for one person. */
const officeLabels = (offices: OfficeRole[]): string[] => [
  ...new Set((offices ?? []).map(officeLabel)),
];

const num = new Intl.NumberFormat("bg-BG");

/** Rows drawn before the list is cut. The payload itself caps at 100. */
const SHOWN = 10;

export const OfficeLinksBlock: FC<{
  data: OfficeLinksPayload | null;
  /** Company page: rows carry a bridge person and the basis is one hop wider. */
  indirect?: boolean;
  id?: string;
}> = ({ data, indirect = false, id }) => {
  const links = data?.links ?? [];
  if (!data || links.length === 0) return null;
  const rows = links.slice(0, SHOWN);
  const hidden = Math.max(0, (data.count ?? links.length) - rows.length);

  return (
    <Card
      id={id}
      className={id ? "scroll-mt-20" : undefined}
      tabIndex={id ? -1 : undefined}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4" />
          {indirect
            ? "Политически връзки през общите фирми"
            : "Съвместно вписани с лица на публична длъжност"}{" "}
          ({num.format(data.count ?? links.length)})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Rule 3: the basis is in the body. The match is on a folded name and the reader
            must know that before they read a politician's name next to this company. */}
        <p className="text-xs text-muted-foreground">
          {indirect
            ? "Лица на публична длъжност, вписани в друга фирма заедно с някой от вписаните за тази фирма. "
            : "Лица на публична длъжност, вписани в Търговския регистър заедно с това лице. "}
          Основата е <strong>самото вписване</strong>, а не обществени поръчки —
          затова тук се виждат и фирми, които никога не са печелили договор с
          държавата.{" "}
          <strong>
            Свързването е по име: регистърът не публикува личен идентификатор
          </strong>
          , затова приемайте всеки ред като повод за проверка, не като
          доказателство. Съвместно вписване само по себе си не е нарушение.
        </p>

        <ul className="space-y-2 border-t border-border pt-3">
          {rows.map((l, i) => {
            const offices = officeLabels(l.offices);
            return (
              <li key={`${l.slug}-${l.uic}-${i}`} className="text-sm">
                <Link
                  to={`/person/${encodeURIComponent(l.slug)}`}
                  className="font-medium text-accent hover:underline"
                >
                  {decodeEntities(l.display_name)}
                </Link>
                {/* The party, when it is known. Rendered before the office because it is the
                    shorter, more scannable fact — and absent entirely when unknown, per the
                    type's note: no pill is not „независим". */}
                {l.party ? (
                  <>
                    {" "}
                    <PartyBadge
                      label={l.party}
                      color={l.partyColor}
                      className="align-middle text-[10px]"
                    />
                  </>
                ) : null}
                {/* Rule 2: the office, never a bare „политик". */}
                {offices.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {offices.join(" · ")}
                  </span>
                )}
                {/* Rule 1: the evidence — the company, and the bridge on the company page. */}
                <div className="text-xs text-muted-foreground">
                  {indirect && l.viaName ? (
                    <>
                      {"чрез "}
                      <span className="font-medium">
                        {decodeEntities(l.viaName)}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  {`${bgIn(decodeEntities(l.company || "") || l.uic)} `}
                  <CompanyLink eik={l.uic} className="hover:underline">
                    {decodeEntities(l.company || "") || l.uic}
                  </CompanyLink>
                  {/* The registry's own spelling of the name, so a reader checking the
                      Търговски регистър searches for what is actually written there — the
                      „show the registry name, never attribute it" rule. */}
                  {l.registryName &&
                  l.registryName.toLowerCase() !==
                    l.display_name.toLowerCase() ? (
                    <span>
                      {" "}
                      · в регистъра: „{decodeEntities(l.registryName)}"
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            и още {num.format(hidden)} {hidden === 1 ? "връзка" : "връзки"}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
