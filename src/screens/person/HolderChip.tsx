// WHOSE row it is, on every surface that lists declared assets.
//
// The declaration names a holder per row — „Собственик или титуляр на правото" — and the
// parser stores whether that holder is the declarant as `declaration_asset.is_spouse`.
// The column name is a convenience, not a finding: `isSpouseHolder` (src/lib/declarations.ts)
// proves only „NOT the declarant". A minor child's holdings are reported on the same form,
// and so are a cohabiting partner's.
//
// So a chip reading „съпруг/а" states a family relationship the data does not establish,
// about a named public figure. Four surfaces did that. Where the register gives us the
// holder's NAME we print it — the register's own words, no inference — and where it does
// not, we say „друг титуляр", which is exactly and only what the flag supports.
//
// Named `isSpouse` throughout because that is the stored column; renaming it is a schema
// change and a re-parse, not a rendering fix. This component is where the gap is absorbed,
// so no call site has to remember the distinction.

import { FC } from "react";
import { useTranslation } from "react-i18next";

export const HolderChip: FC<{
  /** Any declared asset row. `holderName` is absent on payloads that never selected it —
   *  the chip degrades to the neutral label rather than to a relationship claim. */
  asset: { isSpouse: boolean; holderName?: string | null };
  className?: string;
}> = ({ asset, className }) => {
  const { t } = useTranslation();
  if (!asset.isSpouse) return null;
  const name = asset.holderName?.trim();
  return (
    <span
      className={
        className ??
        "ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground"
      }
    >
      {name || t("pp_decl_holder_other")}
    </span>
  );
};
