// „Криптоактиви" — the declared crypto holdings on a person's latest asset-bearing
// filing, with the coin and the size of the holding, which the filing list alone cannot
// show. Plan: docs/plans/declared-crypto-v1.md (T1).
//
// WHY IT IS A BLOCK AND NOT JUST BETTER ROWS. The row fix (assetRowText) makes each coin
// legible where it sits, but a crypto position is the one asset class a reader arrives
// looking for by name, and it is buried: it lives inside a COLLAPSED per-filing expander,
// interleaved with bank accounts and flats. Мария Недина's four coins were four
// indistinguishable „Инвестиции €66 030" lines two clicks down.
//
// IT COSTS NOTHING FOR THE PEOPLE WHO HOLD NONE. The mount decision reads `cryptoCount`
// off the filing LIST, which the section has already fetched, so ~56.8k people make no
// extra request — that field exists on the list payload for this reason. The 10 who do
// hold crypto pay one declaration_detail() call.
//
// That call IS shared with the expander and with the property card: useDeclarationDetail
// keeps one promise per filing id (see `detailCache` in usePersonDeclarations.ts), so the
// three components that ask for the same id issue one request between them. It was not
// always so — this comment used to warn that expanding the same filing fetched it a second
// time, which was true and is the reason the cache exists.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatEur } from "@/lib/currency";
import { assetRowParts } from "./assetRowText";
import {
  useDeclarationDetail,
  type DeclarationListItem,
} from "./usePersonDeclarations";

export const PersonCryptoHoldings: FC<{
  /** The filing the block describes — the SAME representative filing the stat cards
   *  above headline, passed in rather than re-derived. Re-deriving „latest" is what made
   *  two surfaces quote different net worths for one person once already (see the
   *  comparator note in PersonDeclarations), and a crypto block naming a different filing
   *  from the € above it would be that bug in a new place. */
  filing: DeclarationListItem;
}> = ({ filing }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  // null when there is nothing to show, so the hook makes no request at all.
  const detail = useDeclarationDetail(
    filing.cryptoCount > 0 ? filing.id : null,
  );

  if (filing.cryptoCount === 0) return null;
  const rows = (detail?.assets ?? []).filter((a) => a.isCrypto);
  // While the detail is in flight, and on the (impossible-by-construction, but not
  // impossible-by-deploy) case of a payload without isCrypto, render nothing rather than
  // an empty „Криптоактиви" heading asserting the holdings are gone.
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("pp_crypto_title")}
        </h3>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {formatEur(filing.cryptoEur, locale)}
        </span>
      </div>
      <div className="mb-2 text-xs text-muted-foreground">
        {t("pp_crypto_basis", {
          year: filing.periodYear,
          type: t(
            {
              Annualy: "pp_decl_type_annual",
              Entry: "pp_decl_type_entry",
              Vacate: "pp_decl_type_vacate",
            }[filing.type] ?? "pp_decl_type_other",
          ).toLocaleLowerCase(locale),
        })}
      </div>
      <ul>
        {rows.map((a, i) => (
          <li
            key={i}
            className="flex items-baseline justify-between gap-2 border-t border-border py-1 text-sm"
          >
            <span className="min-w-0 truncate">
              {/* The SAME sentence the filing row builds, minus the category label the
                  heading above already supplies. Not just coin + quantity: on a table-9
                  row the identifying text is the `description` („криптографски ключове за
                  контрол на криптоактиви") while `detail` is the issuer, which is
                  sometimes a placeholder („няма", „Е") — dropping description there left
                  this block reading „няма · 10 000 бр.". */}
              {assetRowParts(a, locale, t("pp_decl_units") || "бр.")}
              {a.isSpouse && (
                <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {t("pp_decl_spouse")}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {a.valueEur != null ? formatEur(a.valueEur, locale) : "—"}
            </span>
          </li>
        ))}
      </ul>
      {/* The one caveat this block has to carry itself: marking 30 ETH to today's price
          would publish a number the declarant never filed, and crypto is the asset class a
          reader is most likely to assume is live. „Декларирано, не одитирано" is NOT
          repeated here — FilingList renders pp_wealth_caveat directly below, on both mount
          paths, so saying it again put three sentences of near-identical hedging on one
          card. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("pp_crypto_note")}
      </p>
    </div>
  );
};
