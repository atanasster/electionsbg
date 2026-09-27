// „Хора в материала" — one row per person the article is substantially about,
// with how THIS article frames them (news-person-sentiment-v1 §5).
//
// ⚠️ THE ASSESSMENT IS OF THE ARTICLE, NEVER OF THE PERSON. Every row says so
// in its accessible name and the card says so in its caption; neutral
// reporting of an indictment is neutral here.
//
// ⚠️ THE REGISTER'S NAME IS SHOWN, and the article's own spelling beside it
// when they differ. A name match is an identity claim the reader must be able
// to check; showing only our canonical name would hide what we matched.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { JevArticleSentiment, ToneBucket } from "../data";
import { usePersonBaselines } from "../data";
import { bucketOf } from "../jevBucket";
import { toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { isNewsPersonId } from "../newsPersonId";
import {
  baselineFor,
  groupPeople,
  hasPage,
  officeText,
  type RailRow,
} from "../personRail";
import { mainPersonUrl } from "../site";
import { TONE_BUCKET_ORDER } from "../sentimentScale";
import { ScaleTrack } from "./JevScales";
import { ReportIssueLink } from "./ReportIssueLink";
import { Card } from "@/components/ui/card";

const ROLE_IN_ARTICLE: Record<string, [string, string]> = {
  primary: ["основен субект", "main subject"],
  secondary: ["съществен участник", "significant participant"],
};

const BASIS_NOTE: Record<PersonIdentity["basis"], [string, string]> = {
  exact: [
    "Името съвпада с точно един публичен профил.",
    "The name matches exactly one public profile.",
  ],
  context: [
    "Името се споделя от няколко души; свързано по длъжността или партията, посочени до него в текста.",
    "Several people share the name; linked by the office or party named beside it in the text.",
  ],
  surname_alias: [
    "Само фамилия — свързана от редактор за този период.",
    "Surname only — linked by an editor for this period.",
  ],
  registry: [
    "Самоличност, потвърдена от редактор.",
    "Identity confirmed by an editor.",
  ],
};

// First and last name: a Bulgarian three-part name's middle part is the
// patronymic, which nobody recognises a person by.
const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return pick
    .map((w) => w[0])
    .join("")
    .toUpperCase();
};

/**
 * Initials only. ⚠️ No portrait: the news app renders a photograph ONLY
 * through `ArticleImage`, the component that attaches a credit
 * (`imageCredit.test.ts`), and a main-site MP photo carries none here.
 */
const Avatar = ({ name }: { name: string }) => (
  <span
    aria-hidden
    data-testid="person-avatar"
    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
  >
    {initials(name)}
  </span>
);

const Row = ({
  row,
  jev,
  articlePath,
  baselines,
}: {
  row: RailRow;
  jev: Extract<JevArticleSentiment, { withheld?: undefined }>;
  articlePath: string;
  baselines: ReturnType<typeof usePersonBaselines>["data"];
}) => {
  const { isEnglish, language, tr } = useNewsLocale();
  const { subject, identity, tone, bucket } = row;
  const name = identity?.canonical || subject.name;
  const meta = bucket ? toneMeta(bucket, language) : null;
  const inArticle = subject.subject_role
    ? ROLE_IN_ARTICLE[subject.subject_role]
    : null;
  const office = identity?.role_label?.[isEnglish ? "en" : "bg"] ?? null;
  const baseline = baselineFor(row, jev, baselines);
  const page = hasPage(identity, baselines) && isNewsPersonId(identity?.id);
  const spelled =
    identity && identity.canonical && identity.canonical !== subject.name
      ? subject.name
      : null;
  const basis = identity ? BASIS_NOTE[identity.basis] : null;
  const label = [
    name,
    inArticle ? tr(inArticle[0], inArticle[1]) : null,
    meta
      ? tr(
          `представяне в материала: ${meta.label}`,
          `the article frames them: ${meta.label}`,
        )
      : null,
    office ? officeText(office, identity, tr) : null,
    basis ? tr(basis[0], basis[1]) : tr("без профил", "no profile"),
  ]
    .filter(Boolean)
    .join(" · ");
  // §5 — no avatar for a person with no profile (a foreigner, an unlinked
  // name): initials would suggest an identity the rail does not claim.
  const avatar = !!identity && identity.scope !== "foreign";
  return (
    <li
      className="scroll-mt-20 py-3"
      id={identity ? `person-${identity.id}` : undefined}
      aria-label={label}
      data-testid="person-rail-row"
    >
      <div className="flex items-start gap-3">
        {avatar ? <Avatar name={name} /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            {page ? (
              <Link
                to={`/person/${identity!.id}`}
                className="font-medium underline-offset-4 hover:underline"
                title={basis ? tr(basis[0], basis[1]) : undefined}
              >
                {name}
              </Link>
            ) : (
              <span
                className="font-medium"
                title={basis ? tr(basis[0], basis[1]) : undefined}
              >
                {name}
              </span>
            )}
            {inArticle ? (
              <span className="text-xs text-muted-foreground">
                {tr(inArticle[0], inArticle[1])}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {[
              office ? officeText(office, identity, tr) : null,
              spelled
                ? tr(`в текста: „${spelled}“`, `in the text: “${spelled}”`)
                : null,
              identity ? null : tr("без профил", "no profile"),
            ]
              .filter(Boolean)
              .join(" · ")}
            {identity?.kind === "person" ? (
              <>
                {" · "}
                <a
                  href={mainPersonUrl(identity.id, isEnglish)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {tr("профил в Наясно", "profile on Naiasno")} ↗
                </a>
              </>
            ) : null}
          </p>
        </div>
      </div>
      {tone && meta ? (
        <div className="mt-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className={meta.className}>{meta.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {tone.value.toFixed(1)}
            </span>
          </div>
          {/* The row's label already says it in words (§5). */}
          <div aria-hidden="true">
            <ScaleTrack
              score={tone}
              lowLabel={toneMeta("strongly_unfavorable", language).label}
              highLabel={toneMeta("strongly_favorable", language).label}
              summary={tr(`${name}: ${meta.label}`, `${name}: ${meta.label}`)}
              compact
            />
          </div>
        </div>
      ) : null}
      {subject.conflict ? (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="person-rail-conflict"
        >
          {tr(
            "Две прочитания на това лице в материала се разминават — показано е, но не влиза в обобщенията.",
            "Two readings of this person in the article disagree — shown, but left out of every summary.",
          )}
        </p>
      ) : null}
      {baseline ? (
        // ⚠️ IN WORDS, never a second marker on the same bar: two dots on
        // one scale read as two measurements of one thing.
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="person-rail-baseline"
        >
          {tr(
            `в други материали: обикновено ${toneMeta(baseline.bucket, language).label} · ${baseline.n}`,
            `in other articles: usually ${toneMeta(baseline.bucket, language).label} · ${baseline.n}`,
          )}
          {page ? (
            <>
              {" · "}
              <Link
                to={`/person/${identity!.id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {tr("виж всички", "see all")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="mt-1">
        <ReportIssueLink
          path={articlePath}
          person={identity ? { id: identity.id, name } : undefined}
          compact
        />
      </div>
    </li>
  );
};

/** The rail. Renders nothing when the article names no person. */
export const PersonRail = ({
  jev,
  articlePath,
}: {
  jev: Extract<JevArticleSentiment, { withheld?: undefined }>;
  articlePath: string;
}) => {
  const { language, tr } = useNewsLocale();
  const groups = groupPeople(jev.subjects ?? []);
  // A person page's article rows link to `#person-<id>`; the rail renders
  // after the article loads, so the browser's own jump has already missed it.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash.startsWith("person-"))
      document.getElementById(hash)?.scrollIntoView?.({ block: "center" });
  }, [groups.rows.length]);
  const { data: baselines } = usePersonBaselines(
    groups.rows.length > 0 && jev.person_baselines === true,
  );
  if (
    !groups.rows.length &&
    !groups.unresolved.length &&
    !groups.passing.length &&
    !groups.unrated.length
  )
    return null;
  return (
    <Card className="p-4" data-testid="person-rail">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tr("Хора в материала", "People in the article")}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {tr("как ги представя текстът", "how the text frames them")}
        </span>
      </div>
      {groups.rows.length ? (
        <ul className="divide-y">
          {groups.rows.map((row) => (
            <Row
              key={
                row.identity
                  ? `${row.identity.kind}:${row.identity.id}`
                  : `name:${row.subject.name}`
              }
              row={row}
              jev={jev}
              articlePath={articlePath}
              baselines={baselines}
            />
          ))}
        </ul>
      ) : null}
      {groups.unrated.length ? (
        <p
          className="mt-2 text-sm text-muted-foreground"
          data-testid="person-rail-unrated"
        >
          {tr("Не са оценени", "Not rated")}:{" "}
          {groups.unrated
            .map((s) => s.identity?.canonical || s.name)
            .join(", ")}
        </p>
      ) : null}
      {groups.unresolved.length ? (
        <p
          className="mt-2 text-sm text-muted-foreground"
          data-testid="person-rail-unresolved"
        >
          {tr("Неразпознати", "Unresolved")}:{" "}
          {groups.unresolved
            .map((s) => {
              // §2.3 — an unresolved name keeps its tone, by name.
              const b = bucketOf(s.tone, TONE_BUCKET_ORDER);
              return b
                ? `${s.name}* (${toneMeta(b as ToneBucket, language).label})`
                : `${s.name}*`;
            })
            .join(", ")}
        </p>
      ) : null}
      {groups.passing.length ? (
        <p
          className="mt-1 text-sm text-muted-foreground"
          data-testid="person-rail-passing"
        >
          {tr("Споменати мимоходом", "Mentioned in passing")}:{" "}
          {groups.passing
            .map((s) => s.identity?.canonical || s.name)
            .join(", ")}
        </p>
      ) : null}
      {groups.unresolved.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr(
            "* името съвпада с повече от един човек — не свързваме, за да не сгрешим.",
            "* the name matches more than one person — we do not link rather than guess.",
          )}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        {tr(
          "Оценката е за материала, не за човека: как текстът представя лицето, без присъда за самото лице.",
          "The rating is of the article, not the person: how the text frames them, with no verdict on the person.",
        )}
      </p>
    </Card>
  );
};
