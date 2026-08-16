// How one declared asset row reads as a line of text.
//
// It exists because the row used to render `{category} {description}` and nothing else,
// which threw away everything that identifies a holding whose description is blank. Four
// of Мария Недина's 2026 crypto rows came out as four identical „Инвестиции €66 030"
// lines — same label, four different coins.
//
// The two rules below are deliberately GENERIC rather than crypto-specific: the same edit
// that surfaces a coin name also surfaces a car make and a share issuer, which were
// dropped for exactly the same reason.
//
// Nothing here classifies anything. `isCrypto`, `quantity` and `quantityUnit` all arrive
// decided by 090 (`is_crypto_asset`), so this module and /declarations/crypto cannot
// disagree about a row — see the "no TypeScript twin" note in that migration.

import type { DeclarationDetail } from "./usePersonDeclarations";

export type DeclaredAsset = NonNullable<DeclarationDetail>["assets"][number];

/** The declared `detail` when it ADDS something — the coin, the car make, the share
 *  issuer — and null when it merely restates the row's own money unit.
 *
 *  Table 4/5 rows (bank, cash) carry `detail = currency`, so an unconditional render puts
 *  „Банкови сметки EUR — €18 016" on every bank line in the corpus: noise that says
 *  nothing the € sign has not. A CRYPTO row is the case that looks identical and is not —
 *  there `detail` and the declared unit are both the coin, and it is the only thing on the
 *  row a reader can use. Hence the isCrypto exemption rather than a blanket suppression. */
export const assetDetailText = (a: DeclaredAsset): string | null => {
  const detail = a.detail?.trim();
  if (!detail) return null;
  if (!a.isCrypto && detail === a.currency?.trim()) return null;
  // On a table-8 crypto row the coin is BOTH the detail and the declared unit, so the
  // quantity text below already names it — „Етериум · 30 Етериум" says it twice.
  if (detail === a.quantityUnit?.trim()) return null;
  return detail;
};

/** „30 Етериум", „518 000 бр." — the size of the holding in its own unit.
 *
 *  `unitsLabel` is passed in rather than imported so the caller supplies the translated
 *  „бр." / "units" for the bare-count case (090 sends a null unit there on purpose).
 *
 *  Formatted with up to 8 decimals: 0.017 BTC is a real declared holding, and the default
 *  3-decimal grouping would render Атанас Пеканов's bitcoin as „0,017" but his 16.28
 *  Solana as „16,28" — the point is that neither may be rounded to zero. */
export const assetQuantityText = (
  a: DeclaredAsset,
  locale: string,
  unitsLabel: string,
): string | null => {
  if (a.quantity == null || !Number.isFinite(a.quantity)) return null;
  const n = a.quantity.toLocaleString(locale, { maximumFractionDigits: 8 });
  return `${n} ${a.quantityUnit?.trim() || unitsLabel}`;
};

/** The whole left-hand side of an asset row after its category label, as one „ · "-joined
 *  sentence. Assembled here rather than in JSX so a null part cannot leave a dangling
 *  separator — a crypto row has no `description` at all, and the first draft of this
 *  rendered „Инвестиции  · Етериум". */
export const assetRowParts = (
  a: DeclaredAsset,
  locale: string,
  unitsLabel: string,
): string =>
  [
    a.description?.trim() || null,
    assetDetailText(a),
    assetQuantityText(a, locale, unitsLabel),
    a.location?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");
