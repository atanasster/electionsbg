// The ИВСС declaration card on /person/:name. If this person's name matches a magistrate
// in the ИВСС declaration roster (чл. 175а ЗСВ), show their court/position, informational
// financial figures, any declared companies (linking to /company/:eik), a link to the
// declaration the figures were parsed FROM, and the full list of declarations the register
// publishes under that name. Renders nothing when the match carries none of those.
//
// The roster spans YEARS — it retains magistrates who have left the bench — so this is not
// a latest-year snapshot; each record carries its own filing year.
//
// Three framings are load-bearing here, all stated in the copy:
//   - magistrates are NOT elected officials, and the whole match is by NAME, so it is a
//     LEAD, not proof;
//   - the real-estate figure is a FLOW (property acquired in the declared period), not a
//     count of holdings, and sits beside cash figures that ARE a stock;
//   - the filing list belongs to a NAME, not a person. The register publishes no court or
//     id beside the name, so namesakes merge; `filingsNameAmbiguous` marks the cases where
//     that provably happened and the list is headed „подадени под това име".
//
// Every outbound link goes through RegisterLink and is checked against REGISTER_ORIGIN —
// the register is plain HTTP on a bare IP with a documented trust boundary.

import { FC, ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Scale, ExternalLink, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, BGN_PER_EUR } from "@/lib/currency";
import {
  usePersonMagistrateHoldings,
  type MagistrateFiling,
  type MagistrateHolding,
  declaredPropertyCount,
} from "@/data/judiciary/useMagistrateHoldings";
import { MagistrateFilingProperties } from "./MagistrateFilingProperties";

/** How many filings to show before „виж всички" — the top-N + see-all house rule this
 *  tile's /judiciary sibling already follows. A magistrate can have 72. */
const FILINGS_SHOWN = 5;

/** The ИВСС register's origin. Declared here so the render site states what every link on
 *  this card points at: the register is plain HTTP on a bare IP with a documented trust
 *  boundary (scripts/judiciary/sources.ts), and the guarantee that a href cannot be
 *  attacker-controlled otherwise lives three files upstream, in the scraper's href pattern.
 *  A URL that is not on this origin is dropped rather than rendered. */
const REGISTER_ORIGIN = "http://62.176.124.194";
const onRegister = (url: string | null | undefined): url is string =>
  typeof url === "string" && url.startsWith(`${REGISTER_ORIGIN}/`);

/** The one place `target`/`rel` are written for this card's outbound links. Two hand-rolled
 *  anchors meant two independent chances to omit `noopener`. */
const RegisterLink: FC<{
  href: string;
  className: string;
  children: ReactNode;
}> = ({ href, className, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={className}
  >
    {children}
  </a>
);

export const PersonMagistrateHoldingsTile: FC<{ name: string }> = ({
  name,
}) => {
  // `t` for the входящ номер only: the house string `pp_decl_cite_entry` is already used by
  // the Сметна палата filing list on this same page, so the two blocks cite a filing the
  // same way in both languages instead of this one hard-coding „вх. №" into /en.
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [allFilings, setAllFilings] = useState(false);
  // ONE filing open at a time — an accordion rather than independent toggles. Several open at
  // once turns the card into a wall of property rows with no indication which document each
  // belongs to, which is the opposite of what the per-filing grouping is for.
  const [openFiling, setOpenFiling] = useState<string | null>(null);
  // The tile sits at a fixed position in PersonProfileScreen with no `key`, so navigating
  // magistrate → magistrate re-renders this instance with a new `name`. Without the reset an
  // expanded 72-row list stays expanded for the next person, applying one reader's "show me
  // less" to a page they never set it on. React's documented reset-on-prop-change.
  const [shownFor, setShownFor] = useState(name);
  if (shownFor !== name) {
    setShownFor(name);
    setAllFilings(false);
    setOpenFiling(null);
  }
  const { holding, year } = usePersonMagistrateHoldings(name);
  if (!holding) return null;
  // The table now holds the FULL magistrate roster, so a matched record may carry
  // nothing displayable (no company, no non-zero financial, no recoverable court).
  // Don't render an all-but-empty card in that case.
  const f = holding.financials;
  const hasFinancials =
    !!f &&
    (f.bankCashLv > 0 ||
      f.securitiesLv > 0 ||
      // ⚠️ The READ count, not the heuristic one. 450 records have a heuristic 0 against real
      // declared property; guarding on the raw field suppresses the whole financials row for
      // every one of them, so the card silently loses the figure it just learned. `?? 0`
      // because an unknown count is not a reason to show the row.
      (declaredPropertyCount(f) ?? 0) > 0);
  // Drop anything not on the register's own origin rather than rendering it — see
  // REGISTER_ORIGIN. Measured over the committed artifact all 37,023 are on it, so this
  // removes nothing today; it is the assertion at the render site.
  const filings: MagistrateFiling[] = (holding.filings ?? []).filter((row) =>
    onRegister(row.sourceUrl),
  );
  // The TS type declares this non-optional, but dev's `/api/db` proxies to the deployed
  // backend (vite.config.ts) — so a frontend built against a newer payload shape can run
  // against an older-deployed `magistrate_by_name()` that has not shipped `companies` yet.
  // Same defensive fallback as `filings` above.
  const companies: MagistrateHolding["companies"] = holding.companies ?? [];
  // A filing list is displayable content in its own right: a magistrate with no parsed
  // figures and no company still has declarations a reader can open, and that is the whole
  // point of the history.
  const hasContent =
    !!holding.court ||
    hasFinancials ||
    companies.length > 0 ||
    filings.length > 0;
  if (!hasContent) return null;
  const shown = allFilings ? filings : filings.slice(0, FILINGS_SHOWN);
  // ⚠️ The register is indexed by NAME with no court or id beside it, so namesakes fold
  // together — 26.6% of names provably cover more than one human. When that is so the list
  // is headed „подадени под това име" and never attributed to this person.
  const ambiguous = holding.filingsNameAmbiguous === true;
  // A card can now render with NOTHING but links — no court, no figures, no company. The
  // title and the caption both describe declaration DATA, so on that card they would
  // describe nothing present. Say what is actually there instead.
  const filingsOnly = !hasFinancials && companies.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {filingsOnly
            ? bg
              ? "Магистрат — декларации (ИВСС)"
              : "Magistrate — declarations (ИВСС)"
            : bg
              ? "Магистрат — данни от декларацията (ИВСС)"
              : "Magistrate — declaration data (ИВСС)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {holding.court && (
          <div className="mb-2 text-xs text-muted-foreground">
            {[holding.position, holding.court].filter(Boolean).join(" · ")}
          </div>
        )}

        {(() => {
          if (!hasFinancials) return null;
          const eur = (lv: number) => formatEurCompact(lv / BGN_PER_EUR, lang);
          return (
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
              {f.bankCashLv > 0 && (
                <span>
                  {bg ? "Парични средства" : "Cash & deposits"}:{" "}
                  <span className="font-semibold tabular-nums">
                    {eur(f.bankCashLv)}
                  </span>
                </span>
              )}
              {f.securitiesLv > 0 && (
                <span>
                  {bg ? "Ценни книжа/дялове" : "Securities/shares"}:{" "}
                  <span className="font-semibold tabular-nums">
                    {eur(f.securitiesLv)}
                  </span>
                </span>
              )}
              {/* The count of the very rows this card lists when a reader expands the
                filing — two numbers about one document, inches apart, must not disagree.
                ⚠️ NULL renders NOTHING rather than falling back to the heuristic, which
                fabricates property against magistrates who declared none. See
                declaredPropertyCount(). */}
              {(() => {
                const n = declaredPropertyCount(f);
                if (n == null || n <= 0) return null;
                return (
                  <span>
                    <span className="font-semibold tabular-nums">{n}</span>{" "}
                    {/* Bulgarian counts singular at 1 („1 имот") and takes the count form
                      from 2 up („2 имота"). „1 имота" is simply ungrammatical. */}
                    {bg
                      ? n === 1
                        ? "имот в декларацията"
                        : "имота в декларацията"
                      : n === 1
                        ? "property in this filing"
                        : "properties in this filing"}
                  </span>
                );
              })()}
            </div>
          );
        })()}

        {/* Provenance for the figures above — the one declaration that was actually
          parsed, so a reader can check them against the document. */}
        {onRegister(holding.sourceUrl) && (
          <RegisterLink
            href={holding.sourceUrl}
            className="mb-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            {bg ? "Виж декларацията" : "View the declaration"}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </RegisterLink>
        )}

        <div className="flex flex-wrap gap-1.5">
          {companies.map((c, i) => {
            const pct = c.stakePct != null ? ` · ${c.stakePct}%` : "";
            return c.eik ? (
              <Link
                key={`${c.name}-${i}`}
                to={`/company/${c.eik}`}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-foreground hover:bg-primary/20"
              >
                {c.name}
                {pct}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Link>
            ) : (
              <span
                key={`${c.name}-${i}`}
                className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {c.name}
                {pct}
              </span>
            );
          })}
        </div>
        {filings.length > 0 && (
          <div className="mt-3 border-t border-border pt-2.5">
            <div className="mb-1.5 text-xs font-semibold">
              {ambiguous
                ? bg
                  ? `Декларации, подадени под това име (${filings.length})`
                  : `Declarations filed under this name (${filings.length})`
                : bg
                  ? `Декларации в регистъра на ИВСС (${filings.length})`
                  : `Declarations in the ИВСС register (${filings.length})`}
            </div>
            {ambiguous && (
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                {/* The flag is set by EITHER of two shapes — two annuals filed on the same
                  day, or four-plus in one year — so the wording names what both have in
                  common. Hard-coding the same-day sentence made it false for the 5 names
                  flagged only by the second arm. */}
                {bg
                  ? "Тук има повече годишни декларации в една и съща година, отколкото един магистрат подава — знак, че под това име се събират двама души. Регистърът на ИВСС се води само по име, без съд или идентификатор, затова съименниците се сливат в един списък. Проверете в самия документ чия е всяка декларация."
                  : "There are more annual declarations here in a single year than one magistrate files — a sign that two people share this name. The ИВСС register is indexed by name alone, with no court or identifier, so namesakes merge into one list. Check each document to see whose it is."}
              </p>
            )}
            <ul id="magistrate-filings" className="space-y-0.5">
              {shown.map((f) => (
                <li key={f.sourceUrl}>
                  <RegisterLink
                    href={f.sourceUrl}
                    className="inline-flex items-center gap-1.5 text-xs text-primary/90 hover:text-primary hover:underline"
                  >
                    <span className="tabular-nums font-medium">{f.year}</span>
                    {/* NB `registerDir` is deliberately NOT rendered — it is the
                      register's directory, not the declaration type. */}
                    {f.ref && (
                      <span className="text-muted-foreground">
                        {t("pp_decl_cite_entry", { entry: f.ref })}
                      </span>
                    )}
                    {/* Which row the card's figures actually came from. It is NOT always
                      the newest: on 421 of 3,594 records the parsed filing is further down,
                      because a magistrate off the current bench keeps a parse the pipeline
                      does not refresh. Without this the reader cannot tell which document
                      backs the numbers above. */}
                    {f.sourceUrl === holding.sourceUrl && (
                      <span className="rounded bg-primary/10 px-1 text-[10px] text-foreground">
                        {bg ? "данните тук" : "figures shown"}
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </RegisterLink>
                  {/* The properties declared IN this filing, fetched only on expand — a
                    magistrate can have 72 filings and most readers open none. The toggle
                    self-hides when the filing has nothing to show, so it never advertises
                    detail that turns out to be absent (a filing the crawl has not reached,
                    or a pre-v3.0 form the parser refuses, both return nothing). */}
                  <button
                    type="button"
                    onClick={() =>
                      setOpenFiling((v) =>
                        v === f.sourceUrl ? null : f.sourceUrl,
                      )
                    }
                    aria-expanded={openFiling === f.sourceUrl}
                    className="ml-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {openFiling === f.sourceUrl
                      ? bg
                        ? "скрий имотите"
                        : "hide property"
                      : bg
                        ? "имоти"
                        : "property"}
                  </button>
                  <MagistrateFilingProperties
                    sourceUrl={f.sourceUrl}
                    kind={f.kind}
                    expanded={openFiling === f.sourceUrl}
                  />
                </li>
              ))}
            </ul>
            {filings.length > FILINGS_SHOWN && (
              <button
                type="button"
                onClick={() => setAllFilings((v) => !v)}
                aria-expanded={allFilings}
                aria-controls="magistrate-filings"
                className="mt-1 text-xs text-primary hover:underline"
              >
                {allFilings
                  ? bg
                    ? "Покажи по-малко"
                    : "Show fewer"
                  : bg
                    ? `Виж всички (${filings.length})`
                    : `View all (${filings.length})`}
              </button>
            )}
          </div>
        )}

        {/* Full opacity, not the house `/80`: this caption is the mechanism that keeps
          the real-estate count honest, and `text-muted-foreground/80` measures 3.16:1
          on the light theme — below AA for 11px text. The base token clears it at
          4.55:1. The terminator sits OUTSIDE the year conditional in both languages,
          so a null year leaves a well-formed sentence rather than fusing two. */}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {filingsOnly
            ? bg
              ? "Декларации по чл. 175а ЗСВ, публикувани от ИВСС. Регистърът се води по име, без съд или идентификатор, така че съименници не се различават в него. Следа, не доказателство; магистратите не са изборни лица."
              : "Art. 175a ЗСВ declarations as published by the ИВСС. The register is indexed by name, with no court or identifier, so namesakes are indistinguishable in it. A lead, not proof; magistrates are not elected officials."
            : bg
              ? `Данни от декларация по чл. 175а ЗСВ${year ? `, подадена през ${year} г` : ""}. Таблица 1 на годишната декларация изброява имотите, ПРИДОБИТИ през декларирания период — това не е броят на притежаваните имоти. Финансовите суми са ориентировъчни (извлечени автоматично от декларацията), а дружествата — разпознати по име. Регистърът на ИВСС се води по име, без съд или идентификатор, така че съименници не се различават в него. Следа, не доказателство; магистратите не са изборни лица.`
              : `From the person's art. 175a ЗСВ declaration${year ? `, filed in ${year}` : ""}. Table 1 of the annual declaration lists property ACQUIRED during the declared period — it is not a count of what they own. The financial amounts are approximate (auto-extracted from the declaration) and companies are name-matched. The ИВСС register is indexed by name, with no court or identifier, so namesakes are indistinguishable in it. A lead, not proof; magistrates are not elected officials.`}
        </p>
      </CardContent>
    </Card>
  );
};
