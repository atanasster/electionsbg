import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { usePartyPairBreaks } from "@/data/parliament/votes/usePartyPairBreaks";
import { TopicChip } from "@/screens/components/votes/TopicChip";
import type {
  PartyPairBreakItem,
  VoteValue,
} from "@/data/parliament/votes/types";

// Pair param shape: "PARTYA-PARTYB" (single hyphen separator) where the two
// party shortnames may themselves contain Cyrillic characters. To keep the
// URL recognisable we accept whatever the caller sent and split on the FIRST
// hyphen — this is fragile for party names that contain hyphens (ГЕРБ-СДС),
// so the heatmap-cell click uses a double-hyphen separator internally and we
// normalize here.
const splitPairParam = (
  raw: string | undefined,
): { a: string; b: string } | null => {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  // Prefer double-hyphen split to support hyphenated party names.
  if (decoded.includes("--")) {
    const [a, b] = decoded.split("--", 2);
    return a && b ? { a, b } : null;
  }
  const ix = decoded.indexOf("-");
  if (ix < 0) return null;
  return { a: decoded.slice(0, ix), b: decoded.slice(ix + 1) };
};

const VOTE_COLOR: Record<Exclude<VoteValue, "absent">, string> = {
  yes: "text-emerald-600",
  no: "text-red-600",
  abstain: "text-amber-600",
};

const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};

export const PartyPairBreaksScreen: FC = () => {
  const { pair } = useParams<{ pair: string }>();
  const { t, i18n } = useTranslation();
  const { labelForPartyShort, colorForPartyShort } = useParliamentGroups();

  const parsed = useMemo(() => splitPairParam(pair), [pair]);
  const a = parsed?.a ?? "";
  const b = parsed?.b ?? "";

  const { items, swapped, isLoading } = usePartyPairBreaks(a, b);

  const lang = i18n.language;
  const labelA = labelForPartyShort(a) || a;
  const labelB = labelForPartyShort(b) || b;
  const colorA = colorForPartyShort(a) ?? "#94a3b8";
  const colorB = colorForPartyShort(b) ?? "#94a3b8";

  const pageTitle =
    t("votes_landing_pair_intro", { partyA: labelA, partyB: labelB }) ||
    `Items where ${labelA} and ${labelB} voted opposite ways`;

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={pageTitle}>{pageTitle}</Title>
      <Breadcrumbs
        className="mt-5"
        items={[
          { label: t("nav_governance"), to: "/governance" },
          { label: t("gov_hub_parliament_title"), to: "/parliament" },
          { label: t("sessions_index_title"), to: "/votes" },
          { label: `${labelA} ↔ ${labelB}` },
        ]}
      />

      <div className="pb-12 space-y-4 mt-4">
        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3 text-base">
            <span className="font-semibold" style={{ color: colorA }}>
              {labelA}
            </span>
            <span className="text-muted-foreground">↔</span>
            <span className="font-semibold" style={{ color: colorB }}>
              {labelB}
            </span>
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {items.length}{" "}
              {t("votes_landing_pair_count", { count: items.length }) ||
                "items"}
            </span>
          </div>
        </section>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("votes_landing_pair_empty") ||
              "No breaks found between these groups in the current parliament."}
          </div>
        ) : (
          <ul className="divide-y border rounded-xl bg-card">
            {items.map((it) => (
              <PairBreakRow
                key={`${it.date}-${it.item}`}
                item={it}
                swapped={swapped}
                lang={lang}
                labelA={labelA}
                labelB={labelB}
                colorA={colorA}
                colorB={colorB}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const PairBreakRow: FC<{
  item: PartyPairBreakItem;
  swapped: boolean;
  lang: string;
  labelA: string;
  labelB: string;
  colorA: string;
  colorB: string;
}> = ({ item, swapped, lang, labelA, labelB, colorA, colorB }) => {
  const { t } = useTranslation();
  // Flip the (voteA, voteB) tuple when the URL pair was in reverse order from
  // the canonical (alphabetical) pair key.
  const left = swapped ? item.voteB : item.voteA;
  const right = swapped ? item.voteA : item.voteB;
  const itemUrl = `/votes/${item.date}/item-${item.slug}`;

  return (
    <li className="p-4">
      <Link to={itemUrl} underline={false} className="block hover:text-primary">
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums mb-1 flex-wrap">
          <span>{formatDate(item.date, lang)}</span>
          {item.topic && <TopicChip topic={item.topic} linkable={false} />}
        </div>
        <div className="text-sm font-medium line-clamp-2 mb-2">
          {item.title ?? `#${item.item}`}
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold" style={{ color: colorA }}>
              {labelA}
            </span>
            <span className={`font-semibold ${VOTE_COLOR[left]}`}>
              {t(`vote_${left}`) || left}
            </span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold" style={{ color: colorB }}>
              {labelB}
            </span>
            <span className={`font-semibold ${VOTE_COLOR[right]}`}>
              {t(`vote_${right}`) || right}
            </span>
          </span>
        </div>
      </Link>
    </li>
  );
};
