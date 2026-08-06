// /parliament/similarity — whose voting record is closest to whose.
//
// TWO ROUTES, ONE SCREEN. `/parliament/similarity` is the browsable entry point and
// `/parliament/similarity/:mpId` is one member's ranking. Before this, only the second
// existed, so the hub tile had to carry a SEED — a member picked by the generator — and a
// reader arriving from it landed on a stranger's page with no way to reach their own MP
// except by leaving. The seeded destination is gone: the tile now points at the picker.
//
// The picker STAYS ON SCREEN once a member is chosen, rather than being a separate
// index page that hands off. The whole point of this view is comparison, and comparison
// means switching subjects repeatedly; a picker you have to navigate back to is a picker
// you use once.
//
// LAYOUT is the module's dashboard shell — no `px-4 md:px-8` wrapper and no
// `max-w-5xl mx-auto` cap. It had both, which is double horizontal padding around a
// column narrower than every sibling page in the module (/parliament/cohesion,
// /parliament/attendance and /parliament/embedding all use the bare shell).

import { FC, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { Input } from "@/components/ui/input";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useMps, type MpIndexEntry } from "@/data/parliament/useMps";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { MpSimilarityBrowser } from "@/screens/components/votes/MpSimilarityBrowser";

/** Enough to scan, few enough not to bury the comparison under a roster. The full list is
 *  240 members; anyone looking for a specific one types instead of scrolling. */
const PICKER_LIMIT = 24;

const MpPicker: FC<{
  mps: MpIndexEntry[];
  selectedId: number | null;
}> = ({ mps, selectedId }) => {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const bg = i18n.language === "bg";

  const matches = useMemo(() => {
    const needle = q.trim().toUpperCase();
    // Both name forms, so „Пехливанова" and "Pehlivanova" both find her — the roster
    // carries a normalized Bulgarian and a normalized English form for exactly this.
    const pool = needle
      ? mps.filter(
          (mp) =>
            mp.normalizedName.includes(needle) ||
            mp.normalizedName_en.includes(needle),
        )
      : mps;
    return pool.slice(0, PICKER_LIMIT);
  }, [mps, q]);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide">
        {t("mp_similarity_pick_title")}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("mp_similarity_pick_lead")}
      </p>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("mp_similarity_pick_placeholder")}
        className="mt-3"
        aria-label={t("mp_similarity_pick_placeholder")}
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {matches.map((mp) => (
          <Link
            key={mp.id}
            to={`/parliament/similarity/${mp.id}`}
            underline={false}
            aria-current={mp.id === selectedId ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
              mp.id === selectedId
                ? "border-foreground/40 bg-muted font-medium"
                : "border-border hover:border-foreground/25"
            }`}
          >
            <MpAvatar
              mpId={mp.id}
              name={mp.name}
              className="h-[18px] w-[18px]"
            />
            {bg ? mp.name : mp.name_en}
            {mp.currentPartyGroupShort ? (
              <PartyTag partyShort={mp.currentPartyGroupShort} />
            ) : null}
          </Link>
        ))}
        {matches.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("mp_similarity_pick_none")}
          </span>
        ) : null}
      </div>
      {/* Says the list is capped rather than letting a reader conclude their MP is absent
          from the roster. */}
      {!q && mps.length > PICKER_LIMIT ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("mp_similarity_pick_more", {
            shown: PICKER_LIMIT,
            total: mps.length,
          })}
        </p>
      ) : null}
    </section>
  );
};

export const MpSimilarityScreen: FC = () => {
  const { mpId: mpIdParam } = useParams<{ mpId: string }>();
  const { t } = useTranslation();
  const { mps, findMpById, isLoading } = useMps();

  const mpId = mpIdParam ? Number(mpIdParam) : null;
  const mp = mpId != null ? findMpById(mpId) : null;
  const name = mp?.name ?? "";

  // Current members only, and sorted — the roster carries every MP since the 44th, and a
  // picker offering members who left three parliaments ago is a worse list, not a fuller one.
  const roster = useMemo(
    () =>
      (mps ?? [])
        .filter((m) => m.isCurrent)
        .sort((a, b) => a.name.localeCompare(b.name, "bg")),
    [mps],
  );

  const base = t("mp_similarity_title") || "Voting peers";
  const pageTitle = name ? `${base} · ${name}` : base;

  return (
    <>
      <Title description={t("mp_similarity_description") || pageTitle}>
        {pageTitle}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        className="mt-5"
      />

      <div className="mt-4 space-y-4 pb-12">
        <MpPicker mps={roster} selectedId={mpId} />

        {mp ? (
          <MpSimilarityBrowser
            mpId={mp.id}
            name={mp.name}
            perSide={20}
            showFullLink={false}
          />
        ) : mpId != null && !isLoading ? (
          // A URL naming a member the roster does not hold. Distinct from "pick someone",
          // because the reader did pick — the id simply resolves to nobody.
          <p className="text-sm text-muted-foreground">
            {t("mp_similarity_unknown", { id: mpId })}
          </p>
        ) : mpId == null ? (
          <p className="text-sm text-muted-foreground">
            {t("mp_similarity_pick_prompt")}
          </p>
        ) : null}
      </div>
    </>
  );
};
