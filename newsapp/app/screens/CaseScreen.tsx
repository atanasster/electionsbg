// A named affair (казус) — plan T3.3.
//
// ⚠️⚠️ A CASE IS AN EDITORIAL SELECTION, NOT A FINDING, and the page says so
// before it shows anything. Membership is attached by the registry's fixed
// rule (the affair's terms plus investigative context, at least twice), the
// evidence for every inclusion is rendered beside it, every claim in the
// description carries a dated source, and every contested claim carries its
// speaker, date and the available response. When the rule has not earned
// auto-attach against its fixtures the timeline is EMPTY and the page says
// „not published for review", never „no coverage".

import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCase, useOutlets, useTaxonomy } from "../data";
import { LeanSpectrum, StanceSpectrum } from "../components/SpectrumBar";
import {
  articles as articlesLabel,
  formatDate,
  stories as storiesLabel,
  topicLabel,
} from "../labels";
import type { CaseEvidence, CasePayload } from "../data";

/** The verification enum, in words — the code stays in `title` for reviewers. */
const REVIEW_REASON: Record<
  NonNullable<CasePayload["verification"]["reason"]>,
  { bg: string; en: string }
> = {
  no_fixtures: {
    bg: "няма проверени примери за това правило",
    en: "no reviewed fixtures for this rule",
  },
  fixtures_failed: {
    bg: "правилото не класифицира правилно всички проверени примери",
    en: "the rule misclassifies some reviewed fixtures",
  },
};

/** The evidence line for one story: the terms that matched, or the fact
 *  that a human included it by hand — never an empty „основание:". */
const evidenceLine = (
  evidence: CaseEvidence[],
  tr: (bg: string, en: string) => string,
): string => {
  if (evidence.some((e) => e.basis === "override")) {
    return tr("ръчно включване", "included by hand");
  }
  return [
    ...new Set(
      evidence.flatMap((e) => [...e.terms, ...(e.anchors ?? []), ...e.context]),
    ),
  ].join(", ");
};
import { useNewsLocale } from "../i18n";

export const CaseScreen = () => {
  const { language, tr, isEnglish } = useNewsLocale();
  const { slug } = useParams<{ slug: string }>();
  const detail = useCase(slug);
  const outlets = useOutlets();
  const taxonomy = useTaxonomy();
  const outletName = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of outlets.data?.outlets ?? []) map.set(o.domain, o.outlet);
    return (domain: string) => map.get(domain) ?? domain;
  }, [outlets.data]);

  if (detail.loading && !detail.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (!detail.data) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Казусът не е намерен", "Case not found")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {detail.error
            ? isEnglish
              ? "The case could not be loaded."
              : `Казусът не се зареди: ${detail.error.message}`
            : tr(
                "Този адрес не отговаря на казус от регистъра.",
                "This address does not correspond to a registered case.",
              )}{" "}
          <Link
            to="/cases"
            className="text-primary underline-offset-4 hover:underline"
          >
            {tr("Към всички казуси", "All cases")}
          </Link>
        </p>
      </Card>
    );
  }

  const c = detail.data;
  const name = c.name[language];
  const attached = c.membership === "attached";

  return (
    <div className="space-y-6">
      <section className="border-b pb-4">
        <p className="app-eyebrow mb-2">
          {tr("Казус", "Case")} ·{" "}
          {tr("в регистъра от", "in the register since")}{" "}
          {formatDate(c.opened_on, language)}
        </p>
        <h1 className="app-story-title max-w-3xl">{name}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed">
          {c.description[language]}
        </p>
        {/* ⚠️ THE STATEMENT, above the fold, every time. */}
        <p
          className="mt-3 max-w-3xl rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          role="note"
        >
          {c.editorial_note[language]}
        </p>
      </section>

      <section aria-labelledby="case-sources" className="space-y-2">
        <h2 id="case-sources" className="app-section-title">
          {tr("Източници на описанието", "Sources of the description")}
        </h2>
        <ul className="space-y-1 text-sm">
          {c.sources.map((s) => (
            <li key={s.url} className="flex flex-wrap items-baseline gap-x-2">
              <span>{s.claim[language]}</span>
              <a
                href={s.url}
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {s.domain}
              </a>
              <span className="text-xs text-muted-foreground">
                {formatDate(s.published, language)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {c.contested.length ? (
        <section aria-labelledby="case-contested" className="space-y-2">
          <h2 id="case-contested" className="app-section-title">
            {tr("Оспорвани твърдения", "Contested claims")}
          </h2>
          <ul className="space-y-3 text-sm">
            {c.contested.map((k, i) => (
              <li key={i} className="rounded-md border p-3">
                <p>
                  <span className="font-medium">{k.speaker[language]}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    ({formatDate(k.date, language)})
                  </span>
                  : {k.claim[language]}{" "}
                  <a
                    href={k.source_url}
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {tr("източник", "source")}
                  </a>
                </p>
                <p className="mt-1 text-muted-foreground">
                  {tr("Отговор", "Response")}:{" "}
                  {k.response?.[language] ??
                    tr("няма записан отговор", "no response recorded")}
                  {k.response_source_url ? (
                    <>
                      {" "}
                      <a
                        href={k.response_source_url}
                        rel="noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {tr("източник", "source")}
                      </a>
                    </>
                  ) : null}
                </p>
                {k.note ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {k.note[language]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="case-timeline" className="space-y-2">
        <h2 id="case-timeline" className="app-section-title">
          {tr("Хронология", "Timeline")}
          {attached
            ? ` · ${storiesLabel(c.story_count, language)} · ${articlesLabel(c.article_count, language)}`
            : ""}
        </h2>
        {!attached ? (
          <Card className="p-4 text-sm text-muted-foreground" role="status">
            {tr(
              "Правилото на този казус още не е потвърдено спрямо проверените примери, затова хронологията не се публикува — това не означава, че няма отразяване.",
              "This case's rule has not yet been confirmed against its reviewed fixtures, so the timeline is not published — that does not mean there is no coverage.",
            )}{" "}
            {c.verification.reason ? (
              <span className="text-xs" title={c.verification.reason}>
                ({REVIEW_REASON[c.verification.reason][language]})
              </span>
            ) : null}
          </Card>
        ) : c.timeline.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            {tr(
              "Правилото не е намерило истории в текущия корпус.",
              "The rule matched no stories in the current corpus.",
            )}
          </Card>
        ) : (
          <Card className="divide-y p-0">
            {c.timeline.map((s) => (
              <div key={s.story_id} className="px-4 py-3">
                <Link
                  to={`/story/${s.story_id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {(language === "bg" ? s.title_bg : s.title_en) ??
                    s.title_bg ??
                    s.story_id}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {s.first_published
                      ? formatDate(s.first_published, language)
                      : "—"}
                  </span>
                  {s.topics[0] ? (
                    <Badge variant="secondary" className="font-normal">
                      {topicLabel(
                        taxonomy.data?.categories ?? null,
                        s.topics[0].category,
                        s.topics[0].subcategory,
                        language,
                      ) ?? s.topics[0].category}
                    </Badge>
                  ) : null}
                  <span>{s.outlets.map(outletName).join(", ")}</span>
                  {/* How much of the story the case explains. */}
                  <span>
                    {tr(
                      `${s.supporting.length} от ${s.member_count} материала`,
                      `${s.supporting.length} of ${s.member_count} articles`,
                    )}
                  </span>
                  {/* The evidence, per inclusion: which terms matched. */}
                  <span>
                    {tr("основание", "basis")}:{" "}
                    {evidenceLine(
                      s.supporting.map((a) => a.evidence),
                      tr,
                    )}
                  </span>
                </p>
              </div>
            ))}
          </Card>
        )}
      </section>

      {attached && c.timeline.length ? (
        <section
          aria-labelledby="case-coverage"
          className="grid gap-4 sm:grid-cols-2"
        >
          <div>
            <h2 id="case-coverage" className="app-section-title mb-2">
              {tr("Кой отразява", "Who covers it")}
            </h2>
            <ul className="text-sm">
              {Object.entries(c.outlets)
                .sort((a, b) => b[1] - a[1])
                .map(([domain, n]) => (
                  <li
                    key={domain}
                    className="flex justify-between border-b py-1"
                  >
                    <Link to={`/outlet/${domain}`} className="hover:underline">
                      {outletName(domain)}
                    </Link>
                    <span className="text-muted-foreground">
                      {articlesLabel(n, language)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
          <div className="space-y-3">
            <h2 className="app-section-title">{tr("Рамкиране", "Framing")}</h2>
            {/* ⚠️ DENOMINATORS BESIDE THE BARS: „N оценени от M материала". */}
            <p className="text-xs text-muted-foreground">
              {tr(
                `${c.framing.rated} оценени от ${articlesLabel(c.framing.articles, language)} в казуса`,
                `${c.framing.rated} rated of ${articlesLabel(c.framing.articles, language)} in the case`,
              )}
              {c.framing.prefix_scope_count
                ? tr(
                    `; ${c.framing.prefix_scope_count} не ${c.framing.prefix_scope_count === 1 ? "е оценен" : "са оценени"} върху целия текст и не ${c.framing.prefix_scope_count === 1 ? "се брои" : "се броят"}`,
                    `; ${c.framing.prefix_scope_count} ${c.framing.prefix_scope_count === 1 ? "was" : "were"} not assessed on the full text and ${c.framing.prefix_scope_count === 1 ? "is" : "are"} not counted`,
                  )
                : null}
            </p>
            <LeanSpectrum counts={c.framing.by_leaning} />
            <StanceSpectrum counts={c.framing.by_russia_stance} />
          </div>
        </section>
      ) : null}

      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">
          {tr("Правилото за включване", "The inclusion rule")} (v
          {c.rule_version})
        </summary>
        <p className="mt-2 text-muted-foreground">{c.rule.basis[language]}</p>
        {c.namesakes.map((n) => (
          <p key={n.name} className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium">{n.name}</span>: {n.note[language]}
          </p>
        ))}
        {/* ⚠️ THE TERM LIST IS RETRIEVAL VOCABULARY, NOT A CHARACTERISATION.
            It is one more click down and carries its own caveat, because a
            surname printed on the same line as the stems the rule searches
            for reads as a claim about that person. */}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs">
            {tr("Термините на правилото", "The rule's terms")}
          </summary>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "Термините служат за откриване на материали, не са характеристика на лицата, които назовават.",
              "The terms are for finding articles; they are not a characterisation of the people they name.",
            )}
          </p>
          <p className="mt-1 text-xs">
            {tr("Термини", "Terms")}: {c.rule.required_terms.join(", ")}
            {c.rule.anchor_terms?.length
              ? ` · ${tr("участници", "participants")}: ${c.rule.anchor_terms.join(", ")}`
              : ""}{" "}
            · {tr("контекст", "context")}: {c.rule.context_terms.join(", ")}
            {c.rule.excluded_terms.length
              ? ` · ${tr("изключващи", "excluding")}: ${c.rule.excluded_terms.join(", ")}`
              : ""}
          </p>
        </details>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr("Прегледано от", "Reviewed by")} {c.reviewer},{" "}
          {formatDate(c.reviewed_on, language)}.
        </p>
      </details>
    </div>
  );
};
