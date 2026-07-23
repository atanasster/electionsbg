// "Учебници и помагала" on a school's own /company/:eik page — which publishers
// this particular school buys its textbooks from.
//
// The national picture on /sector/edu is a duopoly (Просвета + Клет take ~75% of
// a €60M market), but that is an average over 646 school buyers. A school's own
// mix is the thing a parent or a head teacher can actually check, and it is not
// derivable from the market blob: that file is aggregate-only, with no per-buyer
// breakdown. So this reads the school's own CPV-22112 contracts and buckets the
// contractors with publisherGroupOf — the SAME rule the market generator uses,
// which is why that rule now lives in src/lib rather than in the generator.
//
// Distributors are a real category, not a publisher: a contract won by С.А.Н.-ПРО
// or Юнивърс resells many publishers' titles, so it says nothing about which
// publisher's books the pupils got. The shared labels already say so.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useSchoolByEik } from "@/data/schools/useSchoolDirectory";
import { publisherGroupLabel } from "@/lib/textbookPublishers";
import { textbookSuppliersOf, type ContractRow } from "./textbookSuppliers";
import { formatEur, formatEurCompact } from "@/lib/currency";

export const SchoolTextbookSuppliersTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = i18n.language;
  const { data: school } = useSchoolByEik(eik);

  // Only fetch the contract rows once the EIK is known to be a school — this
  // tile is dead weight on every other company page.
  const { data } = useQuery({
    queryKey: ["awarder-contracts-textbooks", eik],
    queryFn: async (): Promise<{ contracts: ContractRow[] }> => {
      const r = await fetch(
        `/api/db/awarder-contracts?eik=${encodeURIComponent(eik)}`,
      );
      if (!r.ok) throw new Error("awarder-contracts fetch failed");
      return r.json();
    },
    enabled: !!school,
    staleTime: Infinity,
  });

  const summary = useMemo(
    () => textbookSuppliersOf(data?.contracts ?? []),
    [data],
  );

  if (!school || !summary.contracts) return null;

  const span =
    summary.years.length > 1
      ? `${summary.years[0]}–${summary.years[summary.years.length - 1]}`
      : String(summary.years[0] ?? "");
  const num = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          {bg ? "Учебници и помагала" : "Textbooks and learning materials"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 text-sm md:p-4">
        <p className="text-muted-foreground">
          {bg
            ? `Училището е купило учебници за ${formatEurCompact(summary.totalEur, lang)} по ${num.format(summary.contracts)} договора${span ? ` (${span} г.)` : ""}. От кого:`
            : `This school bought ${formatEurCompact(summary.totalEur, lang)} of textbooks across ${num.format(summary.contracts)} contracts${span ? ` (${span})` : ""}. From whom:`}
        </p>

        <ul className="space-y-1.5">
          {summary.groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {publisherGroupLabel(g.id, lang)}
                <span className="ml-1 text-xs text-muted-foreground">
                  {num.format(g.contracts)}{" "}
                  {bg
                    ? g.contracts === 1
                      ? "договор"
                      : "договора"
                    : g.contracts === 1
                      ? "contract"
                      : "contracts"}
                </span>
              </span>
              <span
                className="h-1.5 w-16 shrink-0 overflow-hidden rounded bg-muted"
                aria-hidden
              >
                <span
                  className="block h-full rounded bg-indigo-500/70"
                  style={{ width: `${Math.max(2, Math.round(g.pct))}%` }}
                />
              </span>
              <span
                className="w-24 shrink-0 text-right tabular-nums"
                title={formatEur(g.eur, lang)}
              >
                {formatEurCompact(g.eur, lang)}
              </span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(g.pct)}%
              </span>
            </li>
          ))}
        </ul>

        <Link
          to="/sector/edu"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {bg
            ? "Сравни с пазара на учебници"
            : "Compare with the textbook market"}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
};
