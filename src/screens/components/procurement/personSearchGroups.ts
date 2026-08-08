// Pure builder for the three ranked people tiers in the combined-search dropdown, split out of
// ProcurementSearchTile so the encoding split, the name-match label, the position-type label
// fallback and the empty-tier guard are unit-tested (like fundSearchGroup). Consumes the shape
// /api/db/person-search (S1) returns.

import { Landmark, Users, Coins } from "lucide-react";
import type { To } from "react-router-dom";
import type { SearchGroup } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";

/** One ranked person row — snake_case, as the route returns raw columns.
 *  tier P = public figure, V = money-linked private owner, N = other owner. */
export interface PersonHit {
  key: string;
  name: string;
  tier: "P" | "V" | "N";
  position_type: string | null;
  primary_role: string | null;
  party: string | null;
  place_label: string | null;
  firms_count: number;
  public_money_eur: number;
  identity_confidence: string;
  href: string;
}
export interface PersonSearchResult {
  power: PersonHit[];
  money: PersonHit[];
  others: PersonHit[];
  /** The shliokavitsa-rewritten needle these rows came from, or null. /persons runs its own
   *  search and does not carry the rewrite, so a "see all" must use this when present. */
  altQuery: string | null;
}
export const EMPTY_PEOPLE: PersonSearchResult = {
  power: [],
  money: [],
  others: [],
  altQuery: null,
};

// position_type CODE → display label (the route stores codes; the UI maps them). Covers the FULL
// person_source.facet vocabulary so an unmapped code can never leak raw English to a BG user; a
// value outside this map falls back to itself.
const POSITION_LABEL: Record<"bg" | "en", Record<string, string>> = {
  bg: {
    politician: "Политик",
    executive: "Изпълнителна власт",
    public_sector: "Публичен сектор",
    magistrate: "Магистрат",
    regulator: "Регулатор",
    private_sector: "Частен сектор",
    ngo: "НПО",
    donor: "Дарител",
    ds: "Досие ДС",
    sanctions: "Санкции",
    media: "Медии",
    professional: "Нотариус/ЧСИ",
    other: "Друго",
  },
  en: {
    politician: "Politician",
    executive: "Executive",
    public_sector: "Public sector",
    magistrate: "Magistrate",
    regulator: "Regulator",
    private_sector: "Private sector",
    ngo: "NGO",
    donor: "Donor",
    ds: "State Security file",
    sanctions: "Sanctions",
    media: "Media",
    professional: "Notary/bailiff",
    other: "Other",
  },
};

const positionLabel = (code: string | null, bg: boolean): string =>
  (code && POSITION_LABEL[bg ? "bg" : "en"][code]) || code || "";

// href from the route is '/person/<slug>' (P, url-safe) or '/person/<raw name>' (V/N) — re-encode
// the name segment for V/N so a name with spaces/punctuation is a valid URL.
const personTo = (h: PersonHit): string =>
  h.tier === "P" ? h.href : `/person/${encodeURIComponent(h.name)}`;

const firmsText = (h: PersonHit, bg: boolean): string => {
  const n = Number(h.firms_count) || 0;
  const cos = bg ? `${n} фирми` : `${n} ${n === 1 ? "company" : "companies"}`;
  // name_fold identities are a NAME match, not a verified person — say so.
  return h.identity_confidence === "name_fold"
    ? `${cos} · ${bg ? "съвпадение по име" : "name match"}`
    : cos;
};

/** The three people groups, in tier order. An empty tier yields no group (no stray header).
 *  `seeAllPersons` is the "виж всички хора" target appended to the others (N) tier. */
export const buildPersonGroups = (
  people: PersonSearchResult,
  bg: boolean,
  seeAllPersons: To,
): SearchGroup[] => {
  const g: SearchGroup[] = [];
  if (people.power.length > 0)
    g.push({
      key: "power",
      label: bg ? "Хора във властта" : "People in power",
      items: people.power.map((h) => ({
        id: `pw-${h.key}`,
        to: personTo(h),
        primary: decodeEntities(h.name),
        // position_type + place; party_primary is an internal canonicalId (e.g. "p_97"),
        // not a display name, so it is deliberately not shown here.
        secondary: [positionLabel(h.position_type, bg), h.place_label]
          .filter(Boolean)
          .join(" · "),
        amountEur: h.public_money_eur,
        icon: Landmark,
      })),
    });
  if (people.money.length > 0)
    g.push({
      key: "money",
      label: bg ? "Свързани с обществени пари" : "Linked to public money",
      items: people.money.map((h) => ({
        id: `mn-${h.key}`,
        to: personTo(h),
        primary: decodeEntities(h.name),
        secondary: firmsText(h, bg),
        amountEur: h.public_money_eur,
        icon: Coins,
      })),
    });
  if (people.others.length > 0)
    g.push({
      key: "others",
      label: bg ? "Други собственици" : "Other owners",
      seeAll: {
        label: bg ? "Виж всички хора" : "See all people",
        to: seeAllPersons,
      },
      items: people.others.map((h) => ({
        id: `ot-${h.key}`,
        to: personTo(h),
        primary: decodeEntities(h.name),
        secondary: firmsText(h, bg),
        icon: Users,
      })),
    });
  return g;
};
