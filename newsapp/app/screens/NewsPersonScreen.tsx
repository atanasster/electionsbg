// One person's page on the NEWS origin (`/person/:id`): how the published
// corpus frames them (news-person-sentiment-v1 §6.1).
//
// ⚠️ THIS IS NOT A PROFILE OF A PERSON. It is an archive of how articles
// present them; what is assessed is the outlet's text, never the person,
// their conduct or their guilt. The deck says so, and so does every figure's
// basis line.
//
// ⚠️ EVERY FIGURE STATES ITS BASIS. The default counts one unit per (outlet,
// story); the reader can switch to same-headline or raw and watch the n move.
// The accounting beneath adds up: N assessed of M eligible, with each
// unassessed kind beside it.
//
// Two id namespaces reach this route — main-site slugs and reviewed `np_*`
// identities — and a retired slug redirects to its live page.

import { useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNewsPerson,
  useNewsPersons,
  useParties,
  usePersonAllRows,
  usePersonsIndex,
  type PersonArticleRow,
  type PersonBasis,
  type ToneBucket,
} from "../data";
import { isNewsPersonId } from "../newsPersonId";
import { formatDate, toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { correctionIssueUrl } from "../corrections";
import { mainPersonUrl } from "../site";
import {
  BUCKETS,
  displayName,
  filterActive,
  filterRows,
  officeLine,
  primaryShare,
  type RowFilter,
} from "../personPage";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import {
  PersonOutlets,
  PersonPosition,
  PersonSeries,
  ToneBuckets,
} from "../components/PersonCharts";
import { FreezeBanner } from "../components/FreezeBanner";

export const POLICY_HREF = "/methodology#person-pages";

export const NEWS_PERSON_POLICY_VERSION = "news-person-policy-v1";

const BASIS_LABEL: Record<PersonBasis, [string, string]> = {
  story: ["по (издание, история)", "per (outlet, story)"],
  same_headline: ["по заглавие", "per headline"],
  raw: ["по материал", "per article"],
};

const STATUS_LABEL: Record<PersonArticleRow["status"], [string, string]> = {
  assessed: ["", ""],
  insufficient_text: ["прочетен частично", "read in part"],
  pending: ["не е оценен", "not rated"],
  unplaceable: ["без стойност", "no value"],
  conflict: ["разминаващи се прочитания", "conflicting readings"],
  incidental: ["споменат мимоходом", "mentioned in passing"],
};

const ROLES = ["primary", "secondary", "incidental"] as const;

const Kpi = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="mt-1">{children}</div>
  </div>
);

export const NewsPersonScreen = () => {
  const { newsPersonId: personId } = useParams<{ newsPersonId: string }>();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const { isEnglish, language, tr } = useNewsLocale();
  const person = useNewsPerson(personId, page);
  const [basis, setBasis] = useState<PersonBasis | null>(null);
  // ⚠️ VALIDATED ON READ: a hand-edited `?tone=` would otherwise empty the
  // list and leave the picker blank, reading as „no such articles".
  const toneParam = params.get("tone");
  const roleParam = params.get("role");
  const filter: RowFilter = {
    outlet: params.get("outlet"),
    bucket: (BUCKETS as readonly string[]).includes(toneParam ?? "")
      ? (toneParam as ToneBucket)
      : null,
    role: (ROLES as readonly string[]).includes(roleParam ?? "")
      ? (roleParam as RowFilter["role"])
      : null,
  };
  const filtering = filterActive(filter);
  const all = usePersonAllRows(personId, filtering);
  // A retired id keeps working: both indexes carry a retirement map.
  const newsIndex = useNewsPersons();
  const personsIndex = usePersonsIndex();
  const parties = useParties();
  const missing = !isNewsPersonId(personId) || (person.error && !person.data);
  const redirect =
    missing && personId
      ? (personsIndex.data?.retired_ids?.[personId] ??
        newsIndex.data?.retired_ids?.[personId])
      : undefined;
  const rows = filtering
    ? filterRows(all.data?.articles ?? [], filter)
    : (person.data?.articles ?? []);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  };

  if (redirect && isNewsPersonId(redirect))
    return <Navigate replace to={`/person/${redirect}`} />;
  if (missing && !((newsIndex.loading || personsIndex.loading) && personId)) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Няма страница за това лице", "No page for this person")}
        </h1>
        <FreezeBanner stamps={personsIndex.data} className="mt-2" />
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "Страница има човек с достатъчно оценено отразяване и проверена самоличност. Споменаването само по себе си не създава страница.",
            "A page exists for a person with enough assessed coverage and a checked identity. A mention alone does not create one.",
          )}{" "}
          <Link
            to="/persons"
            className="text-primary underline-offset-4 hover:underline"
          >
            {tr("Всички хора", "All people")}
          </Link>
        </p>
      </Card>
    );
  }
  if (!person.data) return <Skeleton className="h-40 rounded-xl" />;
  const p = person.data;
  const name = displayName(p, isEnglish) ?? p.id;
  const partyName = p.party
    ? (parties.data?.parties.find((x) => x.party_id === p.party)?.name ?? null)
    : null;
  const disambiguation = isEnglish ? p.disambiguation_en : p.disambiguation_bg;
  const shown = basis ?? p.default_basis;
  const summary = p.bases[shown];
  const office = officeLine(p.roles, p.role_labels, isEnglish);
  const share = primaryShare(p);
  const a = p.accounting;
  const personOf = (id: string) =>
    personsIndex.data?.persons.find((row) => row.id === id);

  return (
    <div className="space-y-5">
      <FreezeBanner stamps={p} />
      <header className="border-b pb-4">
        <p className="app-eyebrow mb-2">
          {tr("Как медиите представят човека", "How the media frame them")}
        </p>
        <h1 className="app-page-title">{name}</h1>
        {office || partyName ? (
          <p
            className="mt-1 text-sm text-muted-foreground"
            data-testid="person-office"
          >
            {[
              office
                ? office.former
                  ? tr(`бивш: ${office.text}`, `former: ${office.text}`)
                  : office.text
                : null,
              partyName,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {disambiguation ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {disambiguation}
          </p>
        ) : null}
        <p className="mt-2 max-w-2xl text-sm leading-relaxed">
          {tr(
            `Как ${a.assessed} материала от ${p.outlet_count} издания представят ${name} — оценка на текста, не на човека.`,
            `How ${a.assessed} articles from ${p.outlet_count} outlets frame ${name} — an assessment of the text, not of the person.`,
          )}
        </p>
        {p.main_site_slug ? (
          <a
            href={mainPersonUrl(p.main_site_slug, isEnglish)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            {tr("профил в Наясно", "profile on Naiasno")} ↗
          </a>
        ) : null}
      </header>

      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        role="group"
        aria-label={tr("Основа на броенето", "Counting basis")}
      >
        <span className="text-muted-foreground">
          {tr("Броене:", "Counting:")}
        </span>
        {(Object.keys(BASIS_LABEL) as PersonBasis[]).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={shown === b}
            onClick={() => setBasis(b)}
            className={`rounded-full border px-2.5 py-1 ${shown === b ? "border-foreground bg-foreground text-background" : ""}`}
          >
            {tr(BASIS_LABEL[b][0], BASIS_LABEL[b][1])} · {p.bases[b].n}
          </button>
        ))}
        {shown !== p.default_basis ? (
          // ⚠️ Said, not left to be inferred: only part of the page moves.
          <span className="text-muted-foreground" data-testid="basis-scope">
            {tr(
              "Броят, позицията и разпределението следват избраното броене; развитието във времето, изданията и ролите остават по история.",
              "The count, the position and the distribution follow the chosen basis; the series, the outlets and the roles stay on the story basis.",
            )}
          </span>
        ) : null}
      </div>

      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="person-kpis"
      >
        <Kpi label={tr("Оценени", "Assessed")}>
          <p className="font-title text-2xl tabular-nums">{summary.n}</p>
          <p className="text-xs text-muted-foreground">
            {tr(
              `${BASIS_LABEL[shown][0]} · ${a.assessed} от ${a.eligible} двойки`,
              `${BASIS_LABEL[shown][1]} · ${a.assessed} of ${a.eligible} pairs`,
            )}
          </p>
        </Kpi>
        <Kpi label={tr("Издания", "Outlets")}>
          <p className="font-title text-2xl tabular-nums">{p.outlet_count}</p>
          <p className="text-xs text-muted-foreground">
            {p.first_published
              ? `${formatDate(p.first_published, language)} – ${formatDate(p.last_published, language)}`
              : tr("без дати", "undated")}
          </p>
        </Kpi>
        <Kpi label={tr("Позиция", "Position")}>
          <PersonPosition s={summary} />
        </Kpi>
        <Kpi label={tr("Основен субект", "Main subject")}>
          <p className="font-title text-2xl tabular-nums">
            {share === null ? "—" : `${share}%`}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr(
              "от материалите са за него/нея, а не само го споменават",
              "of the articles are about them, not merely naming them",
            )}
          </p>
        </Kpi>
      </div>

      <Card className="space-y-5 p-4">
        <section aria-labelledby="person-distribution">
          <h2 id="person-distribution" className="text-sm font-medium">
            {tr("Разпределение", "Distribution")}
          </h2>
          <div className="mt-2">
            <ToneBuckets counts={summary.counts} total={summary.n} />
          </div>
        </section>
        <PersonSeries p={p} subject={name} />
        <PersonOutlets
          rows={p.by_outlet}
          selected={filter.outlet}
          onSelect={(d) => setParam("outlet", d)}
        />
        <section aria-labelledby="person-roles">
          <h2 id="person-roles" className="text-sm font-medium">
            {tr(
              "Като основен субект и като участник",
              "As main subject and as participant",
            )}
          </h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(["primary", "secondary"] as const).map((r) => (
              <div key={r}>
                <p className="text-xs text-muted-foreground">
                  {r === "primary"
                    ? tr("основен субект", "main subject")
                    : tr("съществен участник", "significant participant")}{" "}
                  · {p.by_role[r].n}
                </p>
                <ToneBuckets
                  counts={p.by_role[r].counts}
                  total={p.by_role[r].n}
                  compact
                />
              </div>
            ))}
          </div>
        </section>
        {p.co_subjects.length ? (
          <section aria-labelledby="person-co">
            <h2 id="person-co" className="text-sm font-medium">
              {tr("Появява се заедно с", "Appears with")}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {p.co_subjects.map((c) => {
                const other = c.kind !== "party" ? personOf(c.id) : undefined;
                const label =
                  c.kind === "party"
                    ? c.id
                    : ((other ? displayName(other, isEnglish) : null) ?? c.id);
                return (
                  <li
                    key={`${c.kind}:${c.id}`}
                    className="rounded-full border px-2 py-0.5"
                  >
                    {other && isNewsPersonId(c.id) ? (
                      <Link
                        to={`/person/${c.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}{" "}
                    <span className="text-muted-foreground">{c.count}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </Card>

      <section aria-labelledby="person-articles" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="person-articles" className="text-sm font-medium">
            {tr("Материали", "Articles")}
          </h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <PackSelect
              ariaLabel={tr("Тон", "Tone")}
              value={filter.bucket ?? "any"}
              onChange={(v) => setParam("tone", v === "any" ? null : v)}
              options={[
                { value: "any", label: tr("всеки тон", "any tone") },
                ...BUCKETS.map((b) => ({
                  value: b,
                  label: toneMeta(b, language).label,
                })),
              ]}
            />
            <PackSelect
              ariaLabel={tr("Роля", "Role")}
              value={filter.role ?? "any"}
              onChange={(v) => setParam("role", v === "any" ? null : v)}
              options={[
                { value: "any", label: tr("всяка роля", "any role") },
                {
                  value: "primary",
                  label: tr("основен субект", "main subject"),
                },
                {
                  value: "secondary",
                  label: tr("съществен участник", "significant participant"),
                },
                { value: "incidental", label: tr("мимоходом", "in passing") },
              ]}
            />
            {filtering ? (
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setParams({}, { replace: true })}
              >
                {tr("изчисти", "clear")}
              </button>
            ) : null}
          </div>
        </div>
        {filtering ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="person-filter-count"
          >
            {all.error && !all.data
              ? tr(
                  "Всички материали не можаха да се заредят — филтърът не е приложен.",
                  "Every article could not be loaded — the filter was not applied.",
                )
              : all.data
                ? tr(
                    `${rows.length} материала отговарят на филтъра — от всички, не само от тази страница.`,
                    `${rows.length} articles match — from all of them, not only this page.`,
                  )
                : tr(
                    "Зареждане на всички материали…",
                    "Loading every article…",
                  )}
          </p>
        ) : null}
        <Card className="divide-y p-0">
          {rows.map((row) => (
            <article
              key={`${row.domain}/${row.article_id ?? row.url}/${row.published ?? ""}`}
              className="px-4 py-3"
              id={row.article_id ? `a-${row.article_id}` : undefined}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                {row.bucket ? (
                  <span
                    className={`font-medium ${toneMeta(row.bucket, language).className}`}
                  >
                    {toneMeta(row.bucket, language).label}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {tr(
                      STATUS_LABEL[row.status][0],
                      STATUS_LABEL[row.status][1],
                    )}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {row.domain} · {formatDate(row.published, language)}
                </span>
              </div>
              {row.article_id ? (
                <Link
                  to={`/article/${row.domain}/${row.article_id}#person-${p.id}`}
                  className="mt-0.5 block font-medium leading-snug underline-offset-4 hover:underline"
                >
                  {row.title ?? tr("Без заглавие", "Untitled")}
                </Link>
              ) : (
                <p className="mt-0.5 font-medium leading-snug">
                  {row.title ?? tr("Без заглавие", "Untitled")}
                </p>
              )}
              {row.surface && row.surface !== p.name_bg ? (
                <p className="text-xs text-muted-foreground">
                  {tr(
                    `в текста: „${row.surface}“`,
                    `in the text: “${row.surface}”`,
                  )}
                </p>
              ) : null}
            </article>
          ))}
          {!rows.length && !(filtering && !all.data) ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {tr("Няма материали.", "No articles.")}
            </p>
          ) : null}
        </Card>
        {!filtering && p.total_pages > 1 ? (
          <nav
            className="flex items-center justify-between text-sm"
            data-testid="person-pages"
            aria-label={tr("Страници", "Pages")}
          >
            <button
              type="button"
              className="underline-offset-4 hover:underline disabled:opacity-40"
              disabled={p.page <= 1}
              onClick={() => setParams({ page: String(p.page - 1) })}
            >
              {tr("По-нови", "Newer")}
            </button>
            <span className="text-xs text-muted-foreground">
              {tr(
                `Страница ${p.page} от ${p.total_pages}`,
                `Page ${p.page} of ${p.total_pages}`,
              )}
            </span>
            <button
              type="button"
              className="underline-offset-4 hover:underline disabled:opacity-40"
              disabled={p.page >= p.total_pages}
              onClick={() => setParams({ page: String(p.page + 1) })}
            >
              {tr("По-стари", "Older")}
            </button>
          </nav>
        ) : null}
      </section>

      <Card
        className="p-4 text-xs leading-relaxed text-muted-foreground"
        data-testid="person-accounting"
      >
        <p>
          {tr(
            `Отчет: ${a.eligible} двойки (материал, лице), в които лицето е основен субект или съществен участник; ${a.assessed} оценени върху целия текст. Неоценени: ${a.insufficient_text} прочетени частично, ${a.pending} без оценка, ${a.unplaceable} без стойност, ${a.conflict} с разминаващи се прочитания. Извън отчета: ${a.incidental} споменавания мимоходом, ${a.unscored_mentions} в още неоценени статии, ${a.undated} без дата.`,
            `Accounting: ${a.eligible} (article, person) pairs where the person is the main subject or a significant participant; ${a.assessed} assessed on the full text. Unassessed: ${a.insufficient_text} read in part, ${a.pending} not rated, ${a.unplaceable} without a value, ${a.conflict} with conflicting readings. Outside the accounting: ${a.incidental} passing mentions, ${a.unscored_mentions} in articles not scored yet, ${a.undated} undated.`,
          )}
        </p>
        <p className="mt-1">
          {tr("Рубрика", "Rubric")}: {p.rubric_version}
          {p.identity_version
            ? ` · ${tr("самоличност", "identity")}: ${p.identity_version}`
            : ""}{" "}
          · {tr("политика", "policy")}:{" "}
          <Link to={POLICY_HREF} className="underline underline-offset-4">
            {NEWS_PERSON_POLICY_VERSION}
          </Link>{" "}
          · {tr("обобщено", "aggregated")}{" "}
          {formatDate(p.generated_at, language)}
        </p>
        <p className="mt-1">
          <a
            href={correctionIssueUrl(`/person/${p.id}`, { id: p.id, name })}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-4"
          >
            {tr(
              "Сигнал за погрешна самоличност или възражение",
              "Report a wrong identity or object",
            )}{" "}
            ↗
          </a>
        </p>
      </Card>
    </div>
  );
};
