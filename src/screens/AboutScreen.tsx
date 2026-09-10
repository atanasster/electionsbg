import { Card, CardContent } from "@/ux/Card";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Anchor } from "@/ux/Anchor";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const linkClass =
  "text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-colors";

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-foreground">
    {children}
  </h2>
);

/**
 * The nine modules, in the order a reader is most likely to want them: the
 * thing the site is known for first, then the money, then the people, then the
 * context.
 *
 * ⚠️ Every key is a LITERAL rather than a `` t(`about_area_${id}_title`) ``
 * template. `scripts/i18n/key_usage.test.ts` can resolve a built template, but
 * `prune_translations.ts` deletes what the scan cannot reach — and a pruned
 * key here renders as its own identifier on the About page at a 200. Literals
 * cost two lines each and cannot go wrong.
 *
 * ⚠️ No counts in the copy. "410,000 contracts" is true on the day it is
 * written and quietly false a month later, on the one page whose whole claim
 * is that our numbers are checkable.
 */
const AREAS: { to: string; title: string; body: string }[] = [
  {
    to: "/elections",
    title: "about_area_elections_title",
    body: "about_area_elections_body",
  },
  {
    to: "/parliament",
    title: "about_area_parliament_title",
    body: "about_area_parliament_body",
  },
  {
    to: "/budget",
    title: "about_area_budget_title",
    body: "about_area_budget_body",
  },
  {
    to: "/procurement",
    title: "about_area_procurement_title",
    body: "about_area_procurement_body",
  },
  {
    to: "/funds",
    title: "about_area_funds_title",
    body: "about_area_funds_body",
  },
  {
    to: "/persons",
    title: "about_area_people_title",
    body: "about_area_people_body",
  },
  {
    to: "/governance",
    title: "about_area_local_title",
    body: "about_area_local_body",
  },
  {
    to: "/consumption",
    title: "about_area_prices_title",
    body: "about_area_prices_body",
  },
  {
    to: "/indicators/economy",
    title: "about_area_context_title",
    body: "about_area_context_body",
  },
];

export const AboutScreen = () => {
  const { t } = useTranslation();
  return (
    <div className="text-foreground w-full">
      <SEO title={t("about")} description={t("about_seo_description")} />
      <article className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 md:py-16">
        {/* Hero */}
        <header className="mb-12 md:mb-16">
          <H1 className="text-4xl md:text-5xl lg:text-6xl text-left py-0 mb-8 md:mb-10 text-foreground">
            {t("about")}
          </H1>
          <p className="text-lg md:text-xl leading-relaxed text-muted-foreground">
            {t("about_p_1")}
          </p>
          <div className="mt-8 space-y-6">
            <blockquote className="border-l-4 border-accent pl-5 md:pl-6 text-lg md:text-xl italic font-medium leading-relaxed text-foreground">
              {t("about_p_2")}
            </blockquote>
            <blockquote className="border-l-4 border-accent pl-5 md:pl-6 text-lg md:text-xl italic font-medium leading-relaxed text-foreground">
              {t("about_p_3")}
            </blockquote>
          </div>
          <p className="mt-8 text-lg md:text-xl leading-relaxed text-muted-foreground">
            {t("about_p_4")}
          </p>
          {/* My-Area feature mention — sits at the bottom of the hero so
              visitors who scan only the top of the page still learn it
              exists. The "сниперът" sniper icon and pill in the header are
              both wired to /my-area; this paragraph explains the input
              affordances (search vs geolocation) in plain language. */}
          <p className="mt-8 text-base md:text-lg leading-relaxed text-muted-foreground">
            {t("about_my_area")}
          </p>
        </header>

        {/* What the platform actually covers. The hero says "it started with
            elections and grew"; without this a reader has to take that on
            trust, and the nine modules are the whole answer to "what is
            Наясно". Each card links to that module's hub, so the About page
            doubles as the site map it never had. */}
        <section className="mb-12 md:mb-16">
          <SectionHeading>{t("about_inside_title")}</SectionHeading>
          <p className="mt-4 text-base md:text-lg leading-relaxed text-muted-foreground">
            {t("about_inside_intro")}
          </p>
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((a) => (
              <li key={a.to}>
                <Link
                  to={a.to}
                  className="group flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-accent"
                >
                  <h3 className="font-display text-lg font-bold text-foreground group-hover:text-accent">
                    {t(a.title)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(a.body)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* AI chat — the "Наясно AI" assistant. Its selling point is honesty:
            every figure it returns is computed from this platform's data, not
            generated by the language model.

            ⚠️ It used to live on a SEPARATE hosting target and this was an
            external link to ai.electionsbg.com. It is an in-site route now, so
            the link is a <Link> and carries no origin at all — which is also
            what makes it survive the domain flip and pick up the /en prefix
            from the router basename. */}
        <section className="mb-12 md:mb-16">
          <SectionHeading>{t("about_ai_title")}</SectionHeading>
          <p className="mt-4 text-base md:text-lg leading-relaxed text-muted-foreground">
            {t("about_ai")}
          </p>
          <p className="mt-6 text-base md:text-lg leading-relaxed text-muted-foreground">
            <Link to="/chat" className={linkClass}>
              {t("about_ai_link")}
            </Link>
          </p>
        </section>

        {/* Team */}
        <section className="mb-12 md:mb-16">
          <SectionHeading>{t("whos_behind_the_project")}</SectionHeading>
          <p className="mt-4 text-base md:text-lg leading-relaxed text-muted-foreground">
            {t("project_about")}
          </p>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <ProfileCard
              name={t("martin_stoyanov")}
              location={t("martin_location")}
              image="/images/IMG_2272.png"
              bio={t("martin_about")}
              experienceLabel={t("experience")}
              experience={t("martin_experience")}
              hobbiesLabel={t("hobbies")}
              hobbies={t("martin_hobbies")}
            />
            <ProfileCard
              name={t("atanas_stoyanov")}
              location={t("atanas_location")}
              image="/images/IMG_4016.png"
              bio={
                <>
                  {t("atanas_about")}{" "}
                  <Anchor
                    target="_blank"
                    rel="noreferrer"
                    href="https://smartbear.com"
                    className={linkClass}
                  >
                    AutomatedQA.
                  </Anchor>
                </>
              }
              experienceLabel={t("experience")}
              experience={t("atanas_experience")}
              hobbiesLabel={t("hobbies")}
              hobbies={t("atanas_hobbies")}
            />
          </div>
        </section>

        {/* Data sources — the full source registry + download links now live
            on the dedicated sources page (/data/sources). */}
        <section>
          <SectionHeading>{t("the_data")}</SectionHeading>
          <p className="mt-4 text-base md:text-lg leading-relaxed text-muted-foreground">
            {t("about_data")}
          </p>
          <p className="mt-6 text-base md:text-lg leading-relaxed text-muted-foreground">
            <Link to="/data/sources" className={linkClass}>
              {t("about_data_sources_link")}
            </Link>
          </p>
        </section>
      </article>
    </div>
  );
};

const ProfileCard: React.FC<{
  name: string;
  location: string;
  image: string;
  bio: React.ReactNode;
  experienceLabel: string;
  experience: string;
  hobbiesLabel: string;
  hobbies: string;
}> = ({
  name,
  location,
  image,
  bio,
  experienceLabel,
  experience,
  hobbiesLabel,
  hobbies,
}) => (
  <Card className="overflow-hidden">
    <CardContent className="p-6 pt-6">
      <div className="flex flex-col items-center text-center">
        <img
          className="h-32 w-32 rounded-full object-cover ring-2 ring-border"
          src={image}
          alt={name}
        />
        <h3 className="mt-4 font-display text-xl md:text-2xl font-bold text-foreground">
          {name}
        </h3>
        <p className="text-sm font-medium text-muted-foreground">{location}</p>
      </div>
      <div className="mt-6 space-y-4 text-sm md:text-base leading-relaxed text-muted-foreground">
        <p>{bio}</p>
        <div>
          <h4 className="text-xs uppercase tracking-wider font-semibold text-foreground/70">
            {experienceLabel}
          </h4>
          <p className="mt-1">{experience}</p>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-wider font-semibold text-foreground/70">
            {hobbiesLabel}
          </h4>
          <p className="mt-1">{hobbies}</p>
        </div>
      </div>
    </CardContent>
  </Card>
);
