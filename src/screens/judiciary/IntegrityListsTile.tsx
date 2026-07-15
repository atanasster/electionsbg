// The ИВСС's own non-compliance lists, verbatim.
//
// These are the only judgements about individual magistrates on this site, and
// they are not ours: the Inspectorate publishes each list itself, under the ЗСВ
// text it enforces. We reproduce them with the legal reference, the list's own
// year, and a link back to the source, and we say plainly when a list is EMPTY —
// an empty list is a finding too, and hiding it would let a reader assume the
// worst.
//
// The „(1)" footnote matters more than it looks. Its legend reads „лицето е
// подало декларация извън срока" — the person DID file, just late. A name
// WITHOUT the marker never filed at all. Rendering those two identically under a
// header that says "failed to file" would be an accusation the source does not
// make, so the flag is carried through and the legend is reproduced.
//
// Magistrates are not elected officials. Nothing here is inferred; a person
// appears only because the ИВСС named them.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert, ExternalLink, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { IntegrityList } from "@/data/judiciary/useDeclarations";

export const IntegrityListsTile: FC<{ lists: IntegrityList[] }> = ({
  lists,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  if (!lists.length) return null;
  // Any person carrying the footnote, on any list — decides whether the legend
  // is worth printing at all.
  const anyFiledLate = lists.some((l) => l.people.some((p) => p.filedLate));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          {bg
            ? "Списъци на ИВСС за неизрядни декларации"
            : "The Inspectorate's non-compliance lists"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {lists.map((l) => (
          <div key={l.id}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-sm font-medium">{bg ? l.bg : l.en}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  l.people.length === 0
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                }`}
              >
                {l.people.length === 0 ? (
                  <>
                    <Check className="h-3 w-3" />
                    {bg ? "няма" : "none"}
                  </>
                ) : (
                  `${l.people.length} ${bg ? "души" : "people"}`
                )}
              </span>
            </div>
            {/* Each list carries its own year — the ИВСС maintains them
                separately, so one heading must not speak for all four. */}
            <div className="mb-1.5 text-[11px] text-muted-foreground">
              {l.year != null && <span className="mr-1">{l.year} г. ·</span>}
              {l.legalRef}{" "}
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 hover:text-primary hover:underline"
              >
                {bg ? "източник" : "source"}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {l.people.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {l.people.map((p, i) => {
                  // Only one of the four ИВСС pages carries a fifth column, so
                  // the label may be absent even when a person has an `extra`
                  // value — rendering "undefined: Годишна" would be worse than
                  // rendering nothing.
                  const extraLabel = bg ? l.extraBg : l.extraEn;
                  return (
                    <li
                      key={`${p.name}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2 border-t border-border/60 py-1"
                    >
                      <Link
                        to={`/person/${encodeURIComponent(p.name)}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.filedLate && (
                        <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {bg ? "подал извън срока" : "filed late"}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {p.position}
                        {p.court ? ` · ${p.court}` : ""}
                      </span>
                      {p.extra && extraLabel && (
                        <span className="text-muted-foreground/80">
                          {extraLabel}: {p.extra}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground/80">
          {anyFiledLate && (
            <>
              {bg
                ? "„Подал извън срока“ е бележката (1) на самия ИВСС: лицето е подало декларация, но след законовия срок. Липсата на бележка означава, че декларация не е подадена. "
                : "“Filed late” is the Inspectorate's own footnote (1): the person did file the declaration, but after the statutory deadline. The absence of the footnote means no declaration was filed at all. "}
            </>
          )}
          {bg
            ? "Списъците се публикуват от Инспектората към ВСС и се възпроизвеждат тук без промяна. Попадането в списък означава само това, което ИВСС е установил по съответния текст от ЗСВ — не е присъда и не е констатация за незаконно обогатяване. Празен списък означава, че към момента на проверката ИВСС не е посочил никого."
            : "The lists are published by the Inspectorate to the Supreme Judicial Council and reproduced here unchanged. Appearing on a list means only what the Inspectorate established under the cited provision — it is not a conviction, nor a finding of illicit enrichment. An empty list means the Inspectorate named nobody at the time of the check."}
        </p>
      </CardContent>
    </Card>
  );
};
