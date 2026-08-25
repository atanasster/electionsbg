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

/**
 * The declared price, in the unit the DOCUMENT states.
 *
 * ⚠️ NOT CONVERTED, IN EITHER DIRECTION. The figure a row shows must be the figure printed on
 * the declaration it links to, so a лева price stays лева and a евро price stays евро — even
 * though the two now sit side by side in the same year. Bulgaria adopted the euro on
 * 2026-01-01 and the ИВСС reissued the form as v4.0 („Цена на сделката /евро/"); 2026 carries
 * 3,483 filings still on v3.0 in лева beside 201 on v4.0.
 *
 * ⚠️ A NULL UNIT PRINTS NO UNIT. Defaulting it to „лв" is a 1.95583× misstatement waiting for
 * a euro-denominated row whose unit was never recorded — against a named judge, in a number
 * that looks entirely ordinary. Bare is worse-looking and honest.
 */
const price = (
  n: number,
  currency: "BGN" | "EUR" | null | undefined,
  lang: string,
): string => {
  const num = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB").format(
    n,
  );
  if (currency === "EUR") return `${num} €`;
  if (currency === "BGN") return `${num} лв`;
  return num;
};

/** The register's own placeholder for a cell it does not publish. Kept when it TRAILS a real
 *  place — „Балчик - …" is the document saying „somewhere in Балчик, street not published",
 *  which is a fact worth showing — and dropped when it is the whole cell, where it would
 *  print as a place the magistrate declared. */
const PLACEHOLDER = /^[\s.,;:–—-]*(?:…|\.\.\.)?[\s.,;:–—-]*$/;
/** The trailing elision, for comparison only — never stripped from what is rendered. */
const stripElision = (s: string): string =>
  s.replace(/[\s.,;:–—-]*(?:…|\.\.\.)[\s.]*$/, "").trim();

/**
 * Where the property is, as one line.
 *
 * ⚠️ The two source columns frequently say the SAME thing — measured, 2,552 of 11,584 rows —
 * because the settlement cell and the municipality cell both read „Балчик". Joining them
 * blindly prints „Балчик - … · Балчик", which reads as two places. When they agree the
 * location wins, since it is the one carrying the elision marker.
 *
 * Module-private on purpose: exporting a non-component from a component file breaks React
 * fast refresh. It is covered through the rendered output instead.
 */
const placeOf = (
  a: Pick<MagistrateFilingAsset, "location" | "municipality">,
): string => {
  const parts = [a.location, a.municipality]
    .map((s) => (s ?? "").trim())
    .filter((s) => s !== "" && !PLACEHOLDER.test(s));
  if (
    parts.length === 2 &&
    stripElision(parts[0]).toLowerCase() === parts[1].toLowerCase()
  )
    return parts[0];
  return parts.join(" · ");
};

const Row: FC<{ a: MagistrateFilingAsset; bg: boolean; lang: string }> = ({
  a,
  bg,
  lang,
}) => {
  const where = placeOf(a);
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
          {price(a.priceLv, a.priceCurrency, lang)}
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
  // What Таблица 1 MEANS is a property of the filing's kind, and there are THREE answers, not
  // two:
  //   entry/exit → a snapshot of the whole estate at that date
  //   annual     → property acquired during the declared period
  //   unknown    → ⚠️ WE DO NOT KNOW, and it is 34.6% of filings. The ИВСС does not print the
  //                marker row on the older layouts, so the kind is genuinely absent.
  //
  // ⚠️ `unknown` MUST NOT BE ROUNDED TO `annual` — a binary snapshot/not-snapshot test does
  // exactly that, and it publishes a false sentence about a named judge. Measured: Дияна
  // Пенчовска's filing is `unknown` and lists five properties acquired between 1991 and 2021;
  // headed „Придобито през периода" it states she acquired a 1991 apartment during 2025.
  // 330 filings carry a table-1 span of more than five years.
  //
  // So an unknown kind gets a heading that asserts neither: the rows are what the declaration
  // lists, which is true whichever kind it turns out to be.
  const snapshot = kind === "entry" || kind === "exit";
  const acquiredHeading = snapshot
    ? bg
      ? "Имущество към встъпване в длъжност"
      : "Property held on taking office"
    : kind === "annual"
      ? bg
        ? "Придобито през периода"
        : "Acquired during the period"
      : bg
        ? "Имоти, описани в декларацията"
        : "Property listed in this filing";

  return (
    <div className="mt-1 space-y-2 border-l-2 border-border pl-2.5">
      {acquired.length > 0 && (
        <div>
          <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
            {acquiredHeading}
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
      {/* ⚠️ THE CAPTION MUST NOT NAME A UNIT. It sits under rows that can be лева, евро or —
        where the corpus predates the unit being read — bare, and a fixed „в лева" re-asserts
        for the whole block exactly what price() refuses to assert per row. It said „в лева"
        for one commit while the euro rows rendered „€" directly above it. */}
      <p className="text-[10px] text-muted-foreground/80">
        {bg
          ? "Извлечено от самата декларация. Сумите са цената на сделката, както е записана в документа — в валутата, посочена в самия формуляр."
          : "Extracted from the declaration itself. Amounts are the transaction price as written in the document, in the currency the form itself states."}
      </p>
    </div>
  );
};
