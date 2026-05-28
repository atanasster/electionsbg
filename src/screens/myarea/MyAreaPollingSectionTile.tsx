// "Where do I vote?" — lists every polling section assigned to this
// settlement's ekatte for the currently-selected election. One row per
// section: section number, address, machine count, and "mobile" /
// "ship" flags when set. Settlement-only — município views see no tile.
//
// Reuses the per-oblast section bundle React Query cache that drives
// the existing useSectionsVotes hook, so opening this tile doesn't add
// a network hop on top of whatever the canonical pages already fetched.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote, Truck, Ship, Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import type { SectionInfo } from "@/data/dataTypes";
import { usePollingSectionsForEkatte } from "@/data/myarea/usePollingSectionsForEkatte";

type Props = {
  oblast: string;
  ekatte: string;
};

const formatSectionNum = (section: string): string => {
  // 9-digit "260600007" → "26 06 00 007" — canonical visual grouping
  // (oblast / obshtina / район / sequence). Falls back to the raw
  // value when the input doesn't match.
  if (!/^\d{9}$/.test(section)) return section;
  return `${section.slice(0, 2)} ${section.slice(2, 4)} ${section.slice(4, 6)} ${section.slice(6)}`;
};

const renderRow = (s: SectionInfo, lang: "bg" | "en") => {
  return (
    <Link
      key={s.section}
      to={`/section/${s.section}`}
      underline={false}
      className="block rounded-md border px-3 py-2 hover:bg-accent/40 transition-colors"
      aria-label={`${lang === "bg" ? "Секция" : "Section"} ${s.section} — ${s.address ?? ""}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tabular-nums">
          {lang === "bg" ? "Секция" : "Section"} {formatSectionNum(s.section)}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {s.num_machines && s.num_machines > 0 ? (
            <span
              className="flex items-center gap-1"
              title={
                lang === "bg"
                  ? `${s.num_machines} машини за гласуване`
                  : `${s.num_machines} voting machines`
              }
            >
              <Monitor className="size-3" />
              {s.num_machines}
            </span>
          ) : null}
          {s.is_mobile ? (
            <span
              className="flex items-center gap-1 text-amber-600"
              title={lang === "bg" ? "Подвижна секция" : "Mobile section"}
            >
              <Truck className="size-3" />
              {lang === "bg" ? "подвижна" : "mobile"}
            </span>
          ) : null}
          {s.is_ship ? (
            <span
              className="flex items-center gap-1 text-sky-600"
              title={lang === "bg" ? "На кораб" : "On a ship"}
            >
              <Ship className="size-3" />
              {lang === "bg" ? "кораб" : "ship"}
            </span>
          ) : null}
        </div>
      </div>
      {s.address ? (
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          {s.address}
        </p>
      ) : null}
    </Link>
  );
};

export const MyAreaPollingSectionTile: FC<Props> = ({ oblast, ekatte }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const sections = usePollingSectionsForEkatte(oblast, ekatte);

  if (sections.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Vote className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {lang === "bg" ? "Къде гласувам?" : "Where do I vote?"}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {sections.length}{" "}
          {lang === "bg"
            ? sections.length === 1
              ? "секция"
              : "секции"
            : sections.length === 1
              ? "section"
              : "sections"}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {sections.map((s) => renderRow(s, lang))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {lang === "bg"
          ? "Адресите идват от ЦИК за избраната избирателна дата."
          : "Addresses sourced from CIK for the selected election date."}
      </p>
    </Card>
  );
};
