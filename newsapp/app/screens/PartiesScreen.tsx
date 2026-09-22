// T4.2 — the party archive index. ⚠️ AN ARCHIVE FILTER, NOT A LEADERBOARD:
// the rows are ordered by how much coverage the corpus holds, never by how
// favourable it is, and no party carries a score. The number beside each
// party is the denominator — (party, article) pairs the distribution is made
// of — because a distribution without one says nothing.
//
// The two omissions are printed rather than implied: pairs on a surface the
// registry could not resolve to one party (a name is not an identity), and
// pairs on articles the model did not read in full (T4.1c).

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useParties } from "../data";
import { isPartyId } from "../partyId";
import {
  articles as articlesLabel,
  assessments as assessmentsLabel,
  formatDate,
  media as mediaLabel,
} from "../labels";
import { useNewsLocale } from "../i18n";
import { ToneBar } from "../components/ToneBar";

export const PartiesScreen = () => {
  const { language, tr, isEnglish } = useNewsLocale();
  const parties = useParties();
  return (
    <div className="space-y-5">
      <section className="border-b pb-4">
        <p className="app-eyebrow mb-2">{tr("Архив", "Archive")}</p>
        <h1 className="app-page-title">
          {tr("Партии в отразяването", "Parties in the coverage")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {tr(
            "Как материалите представят всяка партия — разпределение на оценките с видим знаменател. Това е архив: партиите са подредени по обем отразяване, не по благоприятност, и никоя не получава оценка. Оценява се СТАТИЯТА, не партията.",
            "How articles present each party — a distribution of assessments with a visible denominator. This is an archive: parties are ordered by how much coverage there is, not by how favourable it is, and none carries a score. What is assessed is the ARTICLE, not the party.",
          )}
        </p>
      </section>
      {parties.error && !parties.data ? (
        <Card className="p-4 text-sm text-destructive">
          {isEnglish
            ? "The archive could not be loaded."
            : `Архивът не се зареди: ${parties.error.message}`}
        </Card>
      ) : !parties.data ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : parties.data.parties.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {tr(
            "Няма публикувани оценки за партии.",
            "No published party assessments.",
          )}
        </Card>
      ) : (
        <>
          <Card className="divide-y p-0">
            {parties.data.parties.map((p) => (
              <div key={p.party_id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {/* ⚠️ A link is a promise of a page. The writer refuses an
                      unsafe id at source, so this should never fire — it is
                      the belt to that braces, and it renders text, not a
                      link the router cannot serve. */}
                  {isPartyId(p.party_id) ? (
                    <Link
                      to={`/party/${p.party_id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {p.name ?? p.party_id}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">
                      {p.name ?? p.party_id}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {assessmentsLabel(p.assessed, language)} ·{" "}
                    {articlesLabel(p.article_count, language)} ·{" "}
                    {mediaLabel(p.outlet_count, language)}
                  </span>
                </div>
                <ToneBar counts={p.counts} total={p.assessed} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.first_published ? (
                    <>
                      {formatDate(p.first_published, language)} –{" "}
                      {formatDate(p.last_published, language)}
                    </>
                  ) : (
                    tr("без дати на публикуване", "no publication dates")
                  )}
                  {p.undated
                    ? tr(` · ${p.undated} без дата`, ` · ${p.undated} undated`)
                    : null}
                </p>
              </div>
            ))}
          </Card>
          <Card className="p-4 text-xs leading-relaxed text-muted-foreground">
            <p>
              {tr(
                `Рубрика: ${parties.data.rubric_version}. Броят е по двойки (партия, материал), не по партии.`,
                `Rubric: ${parties.data.rubric_version}. The count is of (party, article) pairs, not of parties.`,
              )}
            </p>
            {parties.data.unresolved_pairs > 0 ? (
              <p className="mt-1" data-testid="parties-unresolved">
                {tr(
                  `${parties.data.unresolved_pairs} оценки са за имена без самоличност в регистъра и не влизат в нито едно разпределение: ${parties.data.unresolved_refused_pairs} за имена, които регистърът знае, но отказва да свърже еднозначно (споделени или двусмислени), и ${parties.data.unresolved_unknown_pairs} за партии извън обхвата му — предимно чужди. Името не е самоличност.`,
                  `${parties.data.unresolved_pairs} assessments name a party with no identity in the registry and enter no distribution: ${parties.data.unresolved_refused_pairs} name a party the registry knows but refuses to resolve (shared or ambiguous), and ${parties.data.unresolved_unknown_pairs} name a party outside its scope — mostly foreign ones. A name is not an identity.`,
                )}
              </p>
            ) : null}
            {parties.data.duplicate_pairs > 0 ? (
              <p className="mt-1">
                {tr(
                  `${parties.data.duplicate_pairs} оценки са втори изписвания на партия в същия материал и се броят веднъж — знаменателят е по двойки (партия, материал).`,
                  `${parties.data.duplicate_pairs} assessments are a second spelling of a party in the same article and are counted once — the denominator is (party, article) pairs.`,
                )}
              </p>
            ) : null}
            {parties.data.scoped_out_pairs > 0 ? (
              <p className="mt-1">
                {tr(
                  `${parties.data.scoped_out_pairs} оценки са от материали, които моделът не е прочел изцяло, и също не влизат.`,
                  `${parties.data.scoped_out_pairs} assessments come from articles the model did not read in full and are also excluded.`,
                )}
              </p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
};
