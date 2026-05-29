// Municipal council resolutions tile — AI-summarised digest of what the
// общински съвет is voting on. MyTownView-style civic engagement. Auto-
// hides until update-council-minutes populates the data file.
//
// Each resolution renders as: date + title + 2-sentence AI summary +
// tag chips + link to official PDF. AI disclosure pinned at the bottom
// of the tile.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useCouncilMinutes,
  type CouncilTag,
} from "@/data/council/useCouncilMinutes";

type Props = {
  obshtina: string;
};

const PREVIEW_CAP = 5;

const TAG_COLOR: Record<CouncilTag, string> = {
  financial: "#E0A22C",
  personnel: "#C97AAA",
  urban_planning: "#5E8AC7",
  procurement: "#A6792F",
  social: "#56A86F",
  other: "#888",
};

const formatDate = (iso: string, lang: "bg" | "en"): string => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};

export const MyAreaCouncilMinutesTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, resolutions } = useCouncilMinutes(obshtina);

  if (!data || resolutions.length === 0) return null;

  const visible = resolutions.slice(0, PREVIEW_CAP);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Vote className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_council_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {resolutions.length}
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {visible.map((r) => {
          // summary + tags only exist on records that went through the
          // Phase-4 Gemini-digest pass. Sofia's OCR-recovered records
          // ship without them today, so guard before .map / lang-dispatch
          // — without this the tile crashes the moment SOF resolutions
          // start surfacing through the councilObshtinaMap bridge.
          const summary = lang === "bg" ? r.summary_bg : r.summary_en;
          const tags = r.tags ?? [];
          return (
            <li key={r.id} className="border-b last:border-b-0 pb-3 last:pb-0">
              <div className="text-[10px] tabular-nums text-muted-foreground mb-0.5">
                {formatDate(r.date, lang)}
              </div>
              <div className="font-medium text-sm mb-1">{r.title}</div>
              {summary ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {summary}
                </p>
              ) : null}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `${TAG_COLOR[tag] ?? "#888"}22`,
                      color: TAG_COLOR[tag] ?? "#888",
                    }}
                  >
                    {data.tags[tag]?.[lang] ?? tag}
                  </span>
                ))}
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-primary underline ml-auto"
                >
                  {t("my_area_council_source_link")}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-muted-foreground mt-3 italic">
        {t("my_area_council_ai_disclaimer")}
      </p>
    </Card>
  );
};
