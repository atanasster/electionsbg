// „Хора, свързани с община X" — the governance dashboard's link into /persons?obshtina=.
//
// THE PRODUCER `?obshtina` NEVER HAD. The param was validated, applied and (since the chips)
// nameable, and nothing in the app emitted it — so the only way to reach a municipality's
// people was to hand-write the URL.
//
// It is NOT the card it sits under. `MyAreaGovernmentCard` shows the CURRENT officeholders from
// the roster: mayor, deputies, chair, councillors. This is the wider set the identity layer
// places here across nine registers and all time — former officials, candidates who never took
// office, magistrates seated at courts in the municipality, everyone with a declaration.
//
// ⚠️ THE CAPTION IS ABOUT THE PLACE, NEVER ABOUT THE MUNICIPAL GOVERNMENT, and Burgas is why:
// 160 politicians and 152 magistrates. A reader who clicked „местната власт" would be looking
// at a bench. That is also why the mix renders beside the count rather than the count alone —
// the composition is visible before the click, not after it.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Users } from "lucide-react";
import { Link } from "@/ux/Link";
import { usePlacePersonMix } from "@/data/persons/usePlacePersonMix";
import { usePersonLabels } from "@/lib/personLabels";
import { canonicalObshtina } from "@/lib/obshtinaPlace";
import { useObshtinaLabel } from "@/data/municipalities/useObshtinaLabel";

/** How many facet buckets the caption names before it stops.
 *
 *  FOUR, because the placed corpus has exactly four and no fifth — measured 2026-08-26:
 *  politician 19,317 · magistrate 3,081 · executive 761 · public_sector 310. A cap of three
 *  would silently drop a real bucket rather than a tail, which on Burgas means hiding one of the
 *  facets the mix exists to disclose. The cap stays because `primary_facet` can grow. */
const MIX_SHOWN = 4;

export const MyAreaPlacePeopleLink: FC<{
  obshtina: string;
}> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { facetLabel } = usePersonLabels();
  // ⚠️ THE SHARED RESOLVER, not the caller's own name. The card above this link renders Sofia
  // as „община София" from municipalities.json; the /persons chip one click later says
  // „Столична община" from SYNTHETIC_OBSHTINA_LABELS. Taking the name from the caller made this
  // link agree with the card and disagree with its own destination, which is the worse of the
  // two — a reader following it sees the place renamed under them.
  const obshtinaLabel = useObshtinaLabel();
  const data = usePlacePersonMix(obshtina);

  // Nothing until the count arrives, and nothing when it is zero. Every one of the 289
  // municipalities in the corpus is populated today (min 4, median 61), so a zero means the
  // corpus moved — and a link promising rows a click cannot show is worse than no link.
  if (!data || data.total === 0) return null;

  const fmt = (n: number) => n.toLocaleString(isBg ? "bg-BG" : "en-GB");
  // ⚠️ CANONICALISED. The caller holds the URL's own segment, and every Sofia governance URL
  // carries `SOF00` while the corpus says `SFO_CITY` — 0 rows against 1,315. `usePlacePersonMix`
  // folds it for the COUNT; this is the same fold for the DESTINATION, and getting one without
  // the other is the half-fix that renders a confident number over an empty table.
  const code = canonicalObshtina(obshtina);
  if (!code) return null;
  const mix = data.mix
    .slice(0, MIX_SHOWN)
    .map((m) => `${fmt(m.count)} ${facetLabel(m.value) || m.value}`)
    .join(" · ");

  return (
    <Link
      to={`/persons?obshtina=${encodeURIComponent(code)}`}
      underline={false}
      className="mt-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent/40"
    >
      <Users aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">
          {/* ⚠️ NO „община" IN THE STRING. Sofia's 24 районa are deliberately not folded
              (obshtinaPlace.ts: a кмет на район holds that район's own office) and they carry
              rows — S2521 = 35, S2323 = 25, S2414 = 12 — so this link serves them, and
              „община Искър" would call a район of Столична община a municipality. It also
              spared the degenerate „община BGS04", which asserts that a code is a name. The
              tier is already named by the card above; this says who, not what kind of place. */}
          {t("my_area_place_people", { name: obshtinaLabel(code) })}
        </span>
        {/* The composition, so „329" cannot be read as „329 в местната власт". */}
        {mix ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {mix}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-sm font-bold tabular-nums">
        {fmt(data.total)}
      </span>
      <ArrowRight aria-hidden className="size-3 shrink-0 text-primary" />
    </Link>
  );
};
