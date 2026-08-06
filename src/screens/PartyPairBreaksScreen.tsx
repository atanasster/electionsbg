import { FC, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import { usePartyCorrelation } from "@/data/parliament/votes/usePartyCorrelation";
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
    // timeZone: "UTC" is load-bearing. The date above is a plain calendar DAY parsed as
    // UTC midnight; formatting it in the viewer's zone renders it a day early for
    // everyone west of UTC — so the label and the URL it belongs to disagree.
    timeZone: "UTC",
  }).format(d);
};

/** Pick the two groups. Chips rather than two <Select>s: the chamber has six to nine
 *  parliamentary groups, which fits on a line, and a picker you can see the whole of beats
 *  one you have to open twice.
 *
 *  THE PENDING CHOICE IS LOCAL STATE, not the URL, and that is the whole reason this is a
 *  component rather than two rows of links. `/votes/between/:pair` can only express a
 *  COMPLETE pair — `splitPairParam` rejects `ПрБ--`, as it should, since half a pair is not
 *  a comparison — so routing on the first click threw the first choice away and the second
 *  click produced `/votes/between/--ДПС`. Navigation happens once both sides are set. */
const PairPicker: FC<{ parties: string[]; a: string; b: string }> = ({
  parties,
  a,
  b,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  const { labelForPartyShort } = useParliamentGroups();
  const [pending, setPending] = useState<{ a: string; b: string }>({ a, b });

  // The URL is the source of truth once it holds a real pair; the local state only carries
  // a half-made choice. Re-seeding on change keeps the two from drifting when the reader
  // navigates with the back button.
  useEffect(() => setPending({ a, b }), [a, b]);

  const choose = (side: "a" | "b", party: string) => {
    // Picking a group the other side already holds means "swap these", not "compare a group
    // with itself".
    const next =
      side === "a"
        ? { a: party, b: pending.b === party ? pending.a : pending.b }
        : { a: pending.a === party ? pending.b : pending.a, b: party };
    setPending(next);
    if (next.a && next.b && next.a !== next.b) {
      navigate(
        `/votes/between/${encodeURIComponent(next.a)}--${encodeURIComponent(next.b)}${search}`,
      );
    }
  };

  const row = (side: "a" | "b") => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
        {t(side === "a" ? "votes_pair_pick_a" : "votes_pair_pick_b")}
      </span>
      {parties.map((p) => {
        const selected = (side === "a" ? pending.a : pending.b) === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => choose(side, p)}
            aria-pressed={selected}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              selected
                ? "border-foreground/40 bg-muted font-medium"
                : "border-border hover:border-foreground/25"
            }`}
          >
            {labelForPartyShort(p) || p}
          </button>
        );
      })}
    </div>
  );

  if (parties.length < 2) return null;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide">
        {t("votes_pair_pick_title")}
      </h2>
      {row("a")}
      {row("b")}
      {/* Names the half-made state rather than leaving the reader wondering why nothing
          happened when they clicked once. */}
      {!(pending.a && pending.b) ? (
        <p className="text-xs text-muted-foreground">
          {t("votes_pair_pick_prompt")}
        </p>
      ) : null}
    </section>
  );
};

export const PartyPairBreaksScreen: FC = () => {
  const { pair } = useParams<{ pair: string }>();
  const { t, i18n } = useTranslation();
  const { labelForPartyShort, colorForPartyShort } = useParliamentGroups();
  const { slice: correlation } = usePartyCorrelation();

  const parsed = useMemo(() => splitPairParam(pair), [pair]);
  const a = parsed?.a ?? "";
  const b = parsed?.b ?? "";

  const { items, swapped, isLoading } = usePartyPairBreaks(a, b);
  // The groups this parliament actually has, from the correlation slice — the same source
  // the matrix on /parliament/correlation is drawn from, so the picker cannot offer a group
  // the data has no column for.
  const parties = useMemo(() => correlation?.parties ?? [], [correlation]);

  const lang = i18n.language;
  const labelA = labelForPartyShort(a) || a;
  const labelB = labelForPartyShort(b) || b;
  const colorA = colorForPartyShort(a) ?? "#94a3b8";
  const colorB = colorForPartyShort(b) ?? "#94a3b8";

  const pageTitle =
    a && b
      ? t("votes_landing_pair_intro", { partyA: labelA, partyB: labelB })
      : t("votes_pair_pick_title");

  // Dashboard shell: no `px-4 md:px-8` wrapper and no width cap, matching every other page
  // in this module.
  return (
    <>
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

      <div className="mt-4 space-y-4 pb-12">
        <PairPicker parties={parties} a={a} b={b} />

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
    </>
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
