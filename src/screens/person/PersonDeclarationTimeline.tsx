// One career, one timeline — the two declaration registers interleaved chronologically.
//
// WHY THIS EXISTS. A person who has been both a magistrate and an MP, minister, governor or
// councillor files with TWO different bodies: the Сметна палата (чл. 35 ЗПКОНПИ, served by
// `person_declarations`) and the ИВСС (чл. 175а ЗСВ, served by `magistrate_by_name`). The
// /person page renders a block for each, and until now nothing connected them — a reader saw
// a rich Court-of-Audit filing list for 2020-2022 and, further down, a separate ИВСС card for
// 2026, with no signal that these are one continuous public career.
//
// It is not a rare shape. Measured 2026-08-24: 339 people hold a magistrate role plus another,
// and 59 have filings in BOTH registers — 178 filings between them. Дани Каназирева
// (/person/mp-3631) was областен управител, then an MP in the 47th National Assembly, and is
// now a judge at Административен съд Пловдив; Десислава Ахладова was Minister of Justice.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not merge, reconcile or total the two registers.
// They are not commensurable: the ИВСС annual's Таблица 1 is a FLOW (property acquired in the
// period) while the Сметна палата corpus is a stock-basis estate, and 090 already picks ONE
// declaration per (person, period_year) — so folding them would create a silent arbitration
// between two bodies over the same year. This is a chronology with each row labelled by the
// register that published it, and nothing more. See
// docs/plans/magistrate-declaration-detail-v1.md, Findings 0/0b and 3.
//
// Self-hides unless the person actually filed in both, so the ordinary single-register
// profile is untouched.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Landmark, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePersonDeclarations } from "./usePersonDeclarations";
import { usePersonMagistrateHoldings } from "@/data/judiciary/useMagistrateHoldings";

/** The ИВСС register's origin — links are checked against it at the render site, as on the
 *  magistrate tile. The register is plain HTTP on a bare IP with a documented trust
 *  boundary (scripts/judiciary/sources.ts). */
const IVSS_ORIGIN = "http://62.176.124.194";

type Entry = {
  key: string;
  /** The year the row is filed under. Both registers are labelled by the year the filing was
   *  LODGED, because that is the only year the ИВСС half can state for every filing — its
   *  covered period is printed on barely two thirds of documents. Mixing a lodged year with
   *  a covered year would order the two registers on different axes. */
  year: number;
  register: "ivss" | "cac";
  label: string | null;
  sourceUrl: string | null;
};

export const PersonDeclarationTimeline: FC<{ slug: string; name: string }> = ({
  slug,
  name,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const cac = usePersonDeclarations(slug);
  const { holding } = usePersonMagistrateHoldings(name);

  const ivssFilings = (holding?.filings ?? []).filter((f) =>
    f.sourceUrl.startsWith(`${IVSS_ORIGIN}/`),
  );
  const cacFilings = cac ?? [];
  // ⚠️ THE ИВСС HALF IS KEYED ON A NAME, THE OTHER HALF ON A person_id, AND THIS BLOCK MAKES
  // A STRONGER CLAIM THAN EITHER SOURCE DOES ON ITS OWN. „Това лице е декларирало пред два
  // различни органа" asserts one person behind both columns — but the register publishes no
  // court or id beside a name, so where `filingsNameAmbiguous` is set some of those ИВСС rows
  // provably belong to somebody else. Measured: 10 of the 59 people who see this block,
  // including Десислава Ахладова-Атанасова, a former Minister of Justice. The sibling tile
  // ~200px up says so; without this the page would contradict itself.
  const ivssNameAmbiguous = holding?.filingsNameAmbiguous === true;

  // ONLY when both registers actually hold something. A person with one register already has
  // a block that says everything this would, and a "timeline" of one source is just a second
  // copy of it.
  if (!ivssFilings.length || !cacFilings.length) return null;

  const entries: Entry[] = [
    ...cacFilings.map((d) => ({
      key: `cac-${d.id}`,
      year: d.year,
      register: "cac" as const,
      label: d.institution ?? d.positionTitle,
      sourceUrl: d.sourceUrl,
    })),
    ...ivssFilings.map((f) => ({
      key: `ivss-${f.sourceUrl}`,
      year: f.year,
      register: "ivss" as const,
      label: f.ref,
      sourceUrl: f.sourceUrl,
    })),
  ].sort((a, b) => b.year - a.year || a.register.localeCompare(b.register));

  const years = [...new Set(entries.map((e) => e.year))];
  const span = `${years[years.length - 1]}–${years[0]}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg
            ? "Декларации през цялата кариера"
            : "Declarations across the whole career"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {bg
            ? `${cacFilings.length} декларации пред Сметната палата и ${ivssFilings.length} пред ИВСС, ${span} г. Подредени по година на подаване; двата регистъра НЕ се сумират — водят се на различна основа.`
            : `${cacFilings.length} declarations to the Court of Audit and ${ivssFilings.length} to the ИВСС, ${span}. Ordered by the year filed; the two registers are NOT summed, as they are kept on different bases.`}
        </p>
        {ivssNameAmbiguous && (
          <p className="mb-3 text-xs text-muted-foreground">
            {bg
              ? "⚠️ Редовете от ИВСС са подбрани по ИМЕ: регистърът не публикува съд или идентификатор, а под това име се събират повече годишни декларации в една година, отколкото един магистрат подава. Част от тях може да са на друг магистрат със същото име — това не е непременно една биография."
              : "⚠️ The ИВСС rows are matched by NAME: that register publishes no court or identifier, and this name carries more annual declarations in a single year than one magistrate files. Some may belong to a different magistrate with the same name — this is not necessarily one person's record."}
          </p>
        )}
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.key} className="flex items-baseline gap-2 text-xs">
              <span className="w-10 shrink-0 tabular-nums font-medium">
                {e.year}
              </span>
              <span
                className={
                  "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] " +
                  (e.register === "ivss"
                    ? "bg-primary/10 text-foreground"
                    : "bg-muted text-muted-foreground")
                }
              >
                {e.register === "ivss" ? (
                  <Scale className="h-3 w-3" />
                ) : (
                  <Landmark className="h-3 w-3" />
                )}
                {e.register === "ivss"
                  ? "ИВСС"
                  : bg
                    ? "Сметна палата"
                    : "Court of Audit"}
              </span>
              {e.sourceUrl ? (
                <a
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-baseline gap-1 truncate text-primary/90 hover:text-primary hover:underline"
                >
                  <span className="truncate">{e.label ?? ""}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 self-center opacity-50" />
                </a>
              ) : (
                <span className="truncate text-muted-foreground">
                  {e.label ?? ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
