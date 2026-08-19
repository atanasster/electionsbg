// „Пари в чужбина" — the money on this filing the declarant says is held outside Bulgaria.
//
// The register asks it PER ACCOUNT: tables 5 („Банкови влогове") and 8 („Вложения в …
// фондове") carry a „В страната" / „В чужбина" cell pair. We ingested none of it until
// 2026-08-19, so a Belgian account and a Bulgarian one were byte-identical in every column
// we stored. `heldScope` is that answer, classified at parse time by classifyHeldPlace
// (scripts/declarations/held_abroad.ts) and stored — this component reads it and decides
// nothing.
//
// Its own component rather than another branch inside PersonDeclarations because that file
// is already ~600 lines of one expanded filing, and because this block has a caveat of its
// own that has to travel with it (below).
//
// ── THE TWO THINGS A READER CAN GET WRONG HERE, AND WHAT THE COPY DOES ABOUT THEM ───────
//
//  1. A MISSING COUNTRY IS NOT „SOMEWHERE UNSPECIFIED BUT SMALL". „да" in the „В чужбина"
//     column says abroad and names nowhere — corpus-wide a country is named on 521 of 3,288
//     abroad rows, 11.6% of the money. So the block is keyed on `heldScope`, the country is
//     rendered only as the extra it is, and the note says the register often takes a tick.
//     Keying on `heldCountry != null` instead would hide 88% of the money this block exists
//     to show.
//  2. „NOT LISTED HERE" IS NOT „IN BULGARIA". A row whose two cells contradict each other
//     is `'unknown'`, and it is counted here rather than dropped — a filing whose only
//     foreign-looking row was unreadable must not render as a clean domestic sheet. Same
//     principle as `excludedAssetRows` on the totals: no silent caps.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatEur } from "@/lib/currency";
import { assetRowParts, type DeclaredAsset } from "./assetRowText";

export const PersonHeldAbroad: FC<{ assets: DeclaredAsset[] }> = ({
  assets,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const abroad = assets.filter((a) => a.heldScope === "abroad");
  // Counted, not dropped — see (2) above. Deliberately NOT merged into `abroad`: we do not
  // know that these are foreign, only that the filing did not say.
  const unresolved = assets.filter((a) => a.heldScope === "unknown").length;
  if (abroad.length === 0 && unresolved === 0) return null;

  const totalEur = abroad.reduce((sum, a) => sum + (a.valueEur ?? 0), 0);
  // The named-country subset, in the order the rows appear. Deduped so two accounts in
  // Belgium read „Белгия" once.
  const countries = [
    ...new Set(
      abroad.map((a) => a.heldCountry).filter((c): c is string => !!c),
    ),
  ];

  return (
    <div className="border-t border-border pt-1">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {t("pp_decl_abroad") || "Пари в чужбина"}
        </span>
        {abroad.length > 0 && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatEur(totalEur, locale)}
          </span>
        )}
      </div>
      {/* Not optional chrome. Without it a filing showing one „Пари в чужбина" row with no
          country reads as though we failed to look it up, rather than as the register
          accepting a tick — which is what actually happened on 88% of these rows. */}
      {abroad.length > 0 && (
        <div className="mb-1 text-[11px] leading-snug text-muted-foreground">
          {countries.length > 0
            ? t("pp_decl_abroad_note_where", {
                countries: countries.join(", "),
              })
            : t("pp_decl_abroad_note")}
        </div>
      )}
      {abroad.map((a, i) => (
        <div
          key={i}
          className="flex items-baseline justify-between gap-2 py-0.5"
        >
          <span className="truncate">
            <span className="text-muted-foreground">
              {t(`asset_category_${a.category}`)}
            </span>{" "}
            {assetRowParts(a, locale, t("pp_decl_units") || "бр.")}
            {/* The country when the filing named one. A chip rather than „ · Белгия" so it
                does not read as part of the declared description. */}
            {a.heldCountry && (
              <span className="ml-1 rounded bg-muted px-1 text-[10px]">
                {a.heldCountry}
              </span>
            )}
            {a.isSpouse && (
              <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {t("pp_decl_spouse") || "съпруг/а"}
              </span>
            )}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {a.valueEur != null ? formatEur(a.valueEur, locale) : "—"}
          </span>
        </div>
      ))}
      {unresolved > 0 && (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("pp_decl_abroad_unresolved", { count: unresolved })}
        </div>
      )}
    </div>
  );
};
