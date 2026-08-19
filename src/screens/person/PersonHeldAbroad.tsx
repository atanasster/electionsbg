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
import { HolderChip } from "./HolderChip";

// `locale` is a PROP, not `i18n.language`. FilingDetail computes the region-coded form once
// („bg-BG" / „en-US") and threads it through every child that formats money; reading the bare
// language here made this the one block in the panel that would diverge if that mapping ever
// changed, or if a region-coded language were added. Intl gives identical output for both
// forms today — the divergence, not a visible bug, is what this closes.
export const PersonHeldAbroad: FC<{
  assets: DeclaredAsset[];
  locale: string;
}> = ({ assets, locale }) => {
  const { t } = useTranslation();

  const abroad = assets.filter((a) => a.heldScope === "abroad");
  // Counted, not dropped — see (2) above. Deliberately NOT merged into `abroad`: we do not
  // know that these are foreign, only that the filing did not say.
  //
  // Written as an EXCLUSION rather than `=== "unknown"` because the vocabulary is open on
  // the SQL side by design — 089 carries no CHECK on held_scope so that a value a future
  // parser adds lands as data instead of aborting the COPY. Enumerating would let such a
  // value render nowhere and be counted nowhere, leaving the filing looking like a clean
  // domestic sheet: exactly the silent cap rule (2) above forbids.
  const unresolved = assets.filter(
    (a) =>
      a.heldScope != null &&
      a.heldScope !== "domestic" &&
      a.heldScope !== "abroad",
  ).length;
  if (abroad.length === 0 && unresolved === 0) return null;

  // ⚠️ ONLY THE VALUED ROWS. `valueEur ?? 0` would publish „€0" for a filing whose abroad
  // rows carry no euro figure — a number the filing does not state, while the row beneath
  // it correctly shows „—". One filing is that shape today (Маргарита Димова Бурлакова,
  // 2024) and the class is permanent: 8 rows corpus-wide remain unvalued as declared
  // residue, and every ingest can add more. Same principle as excludedAssetRows on the
  // totals — count what is missing, never coerce it to zero.
  const valued = abroad.filter((a) => a.valueEur != null);
  const totalEur = valued.reduce((sum, a) => sum + (a.valueEur as number), 0);
  const unvalued = abroad.length - valued.length;
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
        {valued.length > 0 && (
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
          {/* NOT `truncate`. overflow:hidden clips from the END, and the country chip —
              the one payload this block exists to surface — is the last child. The stakes
              block two files over carries the same note for the same reason. Latent today
              (these descriptions are empty and the longest country is 20 chars), and a
              longer description or a spouse chip on the same row would make it live. */}
          <span className="min-w-0 flex-1">
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
            <HolderChip asset={a} />
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {a.valueEur != null ? formatEur(a.valueEur, locale) : "—"}
          </span>
        </div>
      ))}
      {unvalued > 0 && (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t("pp_decl_abroad_unvalued", { count: unvalued })}
        </div>
      )}
      {unresolved > 0 && (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {/* „Още N записа" presupposes a list above it, and 208 of the 217 filings that
              carry an unresolved row carry NO abroad row at all — so the standalone case is
              the DOMINANT rendering of this branch, not an edge of it, and it needs copy
              that stands on its own. */}
          {abroad.length > 0
            ? t("pp_decl_abroad_unresolved", { count: unresolved })
            : t("pp_decl_abroad_unresolved_only", { count: unresolved })}
        </div>
      )}
    </div>
  );
};
