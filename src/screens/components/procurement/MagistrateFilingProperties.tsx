// The property rows declared in ONE ИВСС filing, shown when a reader expands that filing on
// the magistrate tile.
//
// ⚠️ WHAT TABLE 1 MEANS DEPENDS ON THE FILING, and this component is where that becomes
// visible to a reader. On an ANNUAL declaration Таблица 1 lists property ACQUIRED during the
// declared period; on an ENTRY declaration it is the WHOLE estate at the date of taking
// office. The two are the same table with the same columns and are distinguished only by the
// declaration's `kind`, so the heading is written from that and never generically.
//
// ⚠️ AND AN EMPTY RESULT IS NOT „declared nothing". It is also what a filing the operator
// crawl has not reached returns, and what a document the parser REFUSED returns — the
// parser accepts form v3.0 ONLY, and refuses in both directions — the register's older years
// are largely pre-v3.0, and the ИВСС began issuing v4.0 in 2026. So nothing renders on an empty
// answer: a reader is shown property or shown nothing, never „no property" as a claim.
//
// Prices are shown only on rows the parser placed POSITIONALLY (`exact`). A sparse row is
// assigned by nearest column header and can merge two cells — measured, a year and an owner
// arriving together in one — so its money is exactly the figure not to publish against a
// named judge.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  useMagistrateFilingAssets,
  type MagistrateFilingAsset,
} from "@/data/judiciary/useMagistrateHoldings";

/** лв → a plain grouped figure. Deliberately NOT converted to EUR: the form's column is
 *  „Цена на сделката /лева/" and a converted number is no longer the one printed on the
 *  document the row links to. */
const lv = (n: number, lang: string): string =>
  `${new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB").format(n)} лв`;

const Row: FC<{ a: MagistrateFilingAsset; bg: boolean; lang: string }> = ({
  a,
  bg,
  lang,
}) => {
  const where = [a.location, a.municipality]
    .filter((s) => s && s !== "…" && s !== ":")
    .join(" · ");
  const size = a.builtArea ?? a.area;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="font-medium text-foreground">
        {a.kind ?? (bg ? "имот" : "property")}
      </span>
      {where && <span className="text-muted-foreground">{where}</span>}
      {size && <span className="text-muted-foreground">{size} кв.м.</span>}
      {a.acquiredYear != null && (
        <span className="tabular-nums text-muted-foreground">
          {a.acquiredYear}
        </span>
      )}
      {a.share && <span className="text-muted-foreground">{a.share}</span>}
      {/* Money only from a positionally-exact row — see the module header. */}
      {a.priceLv != null && a.exact && (
        <span className="font-semibold tabular-nums">
          {lv(a.priceLv, lang)}
        </span>
      )}
      {a.legalBasis && (
        <span className="text-muted-foreground/80">{a.legalBasis}</span>
      )}
    </li>
  );
};

export const MagistrateFilingProperties: FC<{
  sourceUrl: string;
  /** The declaration's own kind, from the document — decides what Таблица 1 MEANS here. */
  kind?: string | null;
  expanded: boolean;
}> = ({ sourceUrl, kind, expanded }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const assets = useMagistrateFilingAssets(sourceUrl, expanded);
  if (!expanded || !assets?.length) return null;

  const acquired = assets.filter((a) => a.tableNum === "1");
  const transferred = assets.filter((a) => a.tableNum === "2");
  // An entry (or exit) filing's Таблица 1 is a snapshot of the whole estate, not a year's
  // movements. Naming it „придобити" there would turn a career's holdings into one year's
  // purchases.
  const snapshot = kind === "entry" || kind === "exit";

  return (
    <div className="mt-1 space-y-2 border-l-2 border-border pl-2.5">
      {acquired.length > 0 && (
        <div>
          <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
            {snapshot
              ? bg
                ? "Имущество към встъпване в длъжност"
                : "Property held on taking office"
              : bg
                ? "Придобито през периода"
                : "Acquired during the period"}
          </div>
          <ul className="space-y-0.5">
            {acquired.map((a) => (
              <Row key={`1-${a.ord}`} a={a} bg={bg} lang={lang} />
            ))}
          </ul>
        </div>
      )}
      {transferred.length > 0 && (
        <div>
          <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
            {bg ? "Прехвърлено през периода" : "Transferred during the period"}
          </div>
          <ul className="space-y-0.5">
            {transferred.map((a) => (
              <Row key={`2-${a.ord}`} a={a} bg={bg} lang={lang} />
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/80">
        {bg
          ? "Извлечено от самата декларация. Сумите са цената на сделката в лева, както е записана в документа."
          : "Extracted from the declaration itself. Amounts are the transaction price in лв, as written in the document."}
      </p>
    </div>
  );
};
