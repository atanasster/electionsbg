// „Какво се промени" — the six most recent material events, below the tile grid.
//
// ⚠️ IT TAKES A PREFIX AND NEVER RE-RANKS. The artifact is already ordered and already
// diversified (`diversify` in scripts/db/gen_home/feed.ts caps one category at two of six
// and reaches for a third), so re-sorting here would silently produce a different feed from
// the one the generator's gates checked.
//
// ⚠️ AND IT IS NOT THE WHOLE ANSWER TO „what changed". `/data/updates` is the other one, and
// the two answer DIFFERENT questions: this feed says when something HAPPENED, that page says
// when we last INGESTED a source. Both are linked from each other and both say which they
// are, because two „what changed" pages that do not distinguish themselves read as a
// contradiction.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/ux/infographic";
import { useHomeFeed } from "@/data/home/useHomeFeed";
import { HomeChangeCard } from "./HomeChangeCard";

/** The artifact holds 40; the page shows this many.
 *
 *  ⚠️ IT MUST EQUAL THE GENERATOR'S. `diversify()` caps one category at two of THIS many and
 *  reaches for a third within THIS many — so a component that sliced a different number
 *  would render a prefix whose diversity nobody checked. The two live apart because a
 *  browser module cannot import a Node generator; `HomeChangeFeed.test.tsx` asserts they
 *  agree, reading the generator's constant as source. */
export const RENDERED = 6;

export const HomeChangeFeed: FC = () => {
  const { t } = useTranslation();
  const { feed, settled } = useHomeFeed();

  // A feed outage hides the SECTION rather than blanking the page: the head and the eight
  // destinations are the page's job and neither depends on this. Nothing is claimed while
  // the request is still in flight.
  if (!settled) return null;
  if (!feed?.events?.length) {
    return (
      <section className="mt-10" aria-labelledby="home-changed">
        <SectionHeading
          id="home-changed"
          heading={t("home_changed_heading")}
          description={t("home_changed_unavailable")}
          // ⚠️ THE LINK STAYS IN THE DEGRADED STATE. `/data/updates` is the other half of
          // the „what changed" axis, and it is exactly when this feed has nothing that a
          // reader most needs the page that says when each source was last refreshed.
          action={{ to: "/data/updates", label: t("home_changed_see_all") }}
        />
      </section>
    );
  }

  return (
    <section className="mt-10" aria-labelledby="home-changed">
      <SectionHeading
        id="home-changed"
        heading={t("home_changed_heading")}
        description={t("home_changed_desc")}
        action={{
          // The reciprocal half of §6.7: this feed is „what happened", /data/updates is
          // „when we last refreshed". Each links the other so neither reads as the whole.
          to: "/data/updates",
          label: t("home_changed_see_all"),
        }}
      />
      <ul className="flex flex-col">
        {feed.events.slice(0, RENDERED).map((e) => (
          <HomeChangeCard key={e.id} event={e} />
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {/* The window is „the last N days OF DATA WE HAVE", anchored on the newest source
            rather than on the clock — so the vintage is stated rather than implied. */}
        {t("home_changed_window", {
          days: feed.windowDays,
          date: feed.computedAt.slice(0, 10),
        })}
      </p>
    </section>
  );
};
