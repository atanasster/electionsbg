import { Card, CardContent } from "@/ux/Card";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Anchor } from "@/ux/Anchor";
import { useTranslation } from "react-i18next";

const linkClass =
  "text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-colors";

const ElectionDateLink: React.FC<{ href: string; date: string }> = ({
  href,
  date,
}) => (
  <Anchor
    href={href}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center justify-center rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors"
  >
    {date}
  </Anchor>
);

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-foreground">
    {children}
  </h2>
);

const SubHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-lg md:text-xl font-semibold tracking-tight text-foreground">
    {children}
  </h3>
);

const electionResults: { date: string; href: string }[] = [
  {
    date: "19.04.2026",
    href: "https://results.cik.bg/pe202604/opendata/index.html",
  },
  {
    date: "27.10.2024",
    href: "https://results.cik.bg/pe202410/opendata/index.html",
  },
  {
    date: "09.06.2024",
    href: "https://results.cik.bg/europe2024/opendata/index.html",
  },
  { date: "02.04.2023", href: "https://results.cik.bg/ns2023/csv.html" },
  { date: "02.10.2022", href: "https://results.cik.bg/ns2022/csv.html" },
  {
    date: "14.11.2021",
    href: "https://results.cik.bg/pvrns2021/tur1/csv.html",
  },
  { date: "11.07.2021", href: "https://results.cik.bg/pi2021_07/csv.html" },
  { date: "04.04.2021", href: "https://results.cik.bg/pi2021/csv.html" },
  { date: "26.03.2017", href: "https://results.cik.bg/pi2017/csv.html" },
  { date: "05.10.2014", href: "https://results.cik.bg/pi2014/csv.html" },
  { date: "12.05.2013", href: "https://results.cik.bg/pi2013/csv.html" },
  {
    date: "05.07.2009",
    href: "https://pi2009.cik.bg/results/proportional/index.html",
  },
  { date: "25.06.2005", href: "https://pi2005.cik.bg/results/" },
];

const campaignFinancing: { date: string; href: string }[] = [
  {
    date: "27.10.2024",
    href: "https://erik.bulnao.government.bg/Reports/Index/83",
  },
  {
    date: "09.06.2024",
    href: "https://erik.bulnao.government.bg/Reports/Index/80",
  },
];

export const AboutScreen = () => {
  const { t } = useTranslation();
  return (
    <div className="text-foreground w-full">
      <SEO title={t("about")} description="About page" />
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
        </header>

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

        {/* Data sources */}
        <section>
          <SectionHeading>{t("the_data")}</SectionHeading>
          <p className="mt-4 text-base md:text-lg leading-relaxed text-muted-foreground">
            {t("about_data")}
          </p>

          <div className="mt-8 space-y-6">
            <DataGroup title={t("geojson_maps")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://github.com/yurukov/Bulgaria-geocoding/tree/master"
                  label={t("regions_muni_settlements")}
                />
                <SourceItem
                  href="https://sofiaplan.bg/api/"
                  label={t("sofia_districts")}
                />
                <SourceItem
                  href="https://github.com/johan/world.geo.json"
                  label={t("world_countries")}
                />
                <SourceItem
                  href="https://github.com/rapomon/geojson-places/tree/master"
                  label={t("continents")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("settlements")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.nsi.bg/nrnm/ekatte/regions"
                  label={t("settlements_from_EKATTE")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("settlement_locations")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://github.com/yurukov/Bulgaria-geocoding/blob/master/settlements_loc.csv"
                  label={t("settlement_locations_bulgaria")}
                />
                <SourceItem
                  href="https://gist.github.com/ofou/df09a6834a8421b4f376c875194915c9"
                  label={t("country_capitals_locations")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("mp_profiles")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.parliament.bg/"
                  label={t("mp_profiles_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("mp_business_interests")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://register.cacbg.bg/"
                  label={t("mp_declarations_source")}
                />
                <SourceItem
                  href="https://data.egov.bg/"
                  label={t("commerce_registry_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("census_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://census2021.bg/"
                  label={t("census_2021_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("eurostat_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://ec.europa.eu/eurostat/databrowser/"
                  label={t("eurostat_macro_source")}
                />
                <SourceItem
                  href="https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3gdp/default/table"
                  label={t("eurostat_regional_source")}
                />
                <SourceItem
                  href="https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table"
                  label={t("eurostat_cofog_source")}
                />
                <SourceItem
                  href="https://ec.europa.eu/eurostat/web/income-and-living-conditions/database"
                  label={t("eurostat_silc_source")}
                />
                <SourceItem
                  href="https://ec.europa.eu/eurostat/databrowser/view/demo_mlexpec/default/table"
                  label={t("eurostat_life_expectancy_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("sovereign_debt_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm"
                  label={t("sovereign_debt_bnb_source")}
                />
                <SourceItem
                  href="https://www.luxse.com/issuer/Bulgaria"
                  label={t("sovereign_debt_luxse_source")}
                />
                <SourceItem
                  href="https://www.minfin.bg/bg/statistics/20"
                  label={t("sovereign_debt_minfin_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("governance_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.transparency.org/en/countries/bulgaria"
                  label={t("governance_ti_cpi_source")}
                />
                <SourceItem
                  href="https://databank.worldbank.org/source/worldwide-governance-indicators"
                  label={t("governance_wb_wgi_source")}
                />
                <SourceItem
                  href="https://europa.eu/eurobarometer/surveys/browse/all/series/4961"
                  label={t("governance_eurobarometer_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("indicators_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.az.government.bg/stats/4/"
                  label={t("indicators_az_source")}
                />
                <SourceItem
                  href="https://data.egov.bg/data/view/066b4b04-d81d-444e-a61c-8ca0516079e4"
                  label={t("indicators_mon_dzi_source")}
                />
                <SourceItem
                  href="https://www.nsi.bg/bg/content/2975/население-по-области-общини-местоживеене-и-пол"
                  label={t("indicators_nsi_pop_source")}
                />
                <SourceItem
                  href="https://www.nsi.bg/en/content/2987"
                  label={t("indicators_nsi_vital_source")}
                />
                <SourceItem
                  href="https://www.grao.bg/tables.html"
                  label={t("indicators_grao_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("polls_data_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://bg.wikipedia.org/"
                  label={t("polls_wikipedia_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("procurement_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://data.egov.bg/organisation/about/aop"
                  label={t("procurement_aop_source")}
                />
                <SourceItem
                  href="https://www2.aop.bg/stopanski-subekti/stopanski-subekti-s-narusheniya/"
                  label={t("procurement_aop_debarred_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("eu_funds_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
                  label={t("eu_funds_isun_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("budget_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://data.egov.bg/"
                  label={t("budget_kfp_source")}
                />
                <SourceItem
                  href="https://dv.parliament.bg/"
                  label={t("budget_law_dv_source")}
                />
                <SourceItem
                  href="https://www.minfin.bg/"
                  label={t("budget_ministry_execution_source")}
                />
                <SourceItem
                  href="https://customs.bg/wps/portal/agency/media-center/customs-chronicle"
                  label={t("budget_customs_revenue_source")}
                />
                <SourceItem
                  href="https://nra.bg/wps/portal/nra/za-nap/osnovni-dokumenti/Godishni-otcheti-za-deynostta-na-NAP"
                  label={t("budget_nap_annual_source")}
                />
                <SourceItem
                  href="https://commission.europa.eu/strategy-and-policy/eu-budget/long-term-eu-budget/2021-2027/spending-and-revenue_en"
                  label={t("budget_ec_eu_funds_source")}
                />
                <SourceItem
                  href="https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table"
                  label={t("budget_cofog_source")}
                />
                <SourceItem
                  href="https://ec.europa.eu/eurostat/databrowser/view/gov_10a_main/default/table"
                  label={t("budget_eu_peers_source")}
                />
                <SourceItem
                  href="https://iisda.government.bg/annual_reports"
                  label={t("budget_iisda_doklad_source")}
                />
                <SourceItem
                  href="https://dv.parliament.bg/"
                  label={t("budget_municipal_transfers_source")}
                />
                <SourceItem
                  href="https://dv.parliament.bg/"
                  label={t("budget_investment_program_source")}
                />
                <SourceItem
                  href="https://www.nssi.bg/budjet-i-finansi/otkrito-upravlenie/otcheti-i-balansi/"
                  label={t("budget_noi_b1_source")}
                />
                <SourceItem
                  href="https://www.sofia.bg/"
                  label={t("budget_capital_sofia_source")}
                />
                <SourceItem
                  href="https://www.plovdiv.bg/proekt-budget-2025/"
                  label={t("budget_capital_plovdiv_source")}
                />
                <SourceItem
                  href="https://burgas.bg/bg/2025/proektobyudzhet-2025-g/"
                  label={t("budget_capital_burgas_source")}
                />
                <SourceItem
                  href="https://www.starazagora.bg/bg/obshtinski-byudzhet/byudzhet-za-2025-godina/"
                  label={t("budget_capital_stara_zagora_source")}
                />
                <SourceItem
                  href="https://obshtinaruse.bg/razchet-za-kapitalovi-razhodi"
                  label={t("budget_capital_ruse_source")}
                />
                <SourceItem
                  href="https://varnacouncil.bg/"
                  label={t("budget_capital_varna_source")}
                />
                <SourceItem
                  href="https://obs.pleven.bg/"
                  label={t("budget_capital_pleven_source")}
                />
                <SourceItem
                  href="https://mun.sliven.bg/"
                  label={t("budget_capital_sliven_source")}
                />
                <SourceItem
                  href="https://www.dobrich.bg/bg/kapitalovi-razhodi-na-obshtina-grad-dobrich-1/"
                  label={t("budget_capital_dobrich_source")}
                />
                <SourceItem
                  href="https://www.asenovgrad.bg/bg/kapitalovi-razhodi/"
                  label={t("budget_capital_asenovgrad_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("fiscal_reserve_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.minfin.bg/bg/statistics/4"
                  label={t("fiscal_reserve_minfin_xlsx_source")}
                />
                <SourceItem
                  href="https://www.minfin.bg/bg/statistics/5"
                  label={t("fiscal_reserve_minfin_mreport_source")}
                />
                <SourceItem
                  href="https://www.minfin.bg/bg/statistics/4"
                  label={t("fiscal_reserve_minfin_buletin_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("integrity_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://acf.bg/"
                  label={t("integrity_acf_source")}
                />
                <SourceItem
                  href="https://www.osce.org/odihr/elections/bulgaria"
                  label={t("integrity_osce_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("party_reports_section")}>
              <ul className="space-y-2">
                <SourceItem
                  href="https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/"
                  label={t("party_reports_bulnao_source")}
                />
                <SourceItem
                  href="https://gfopp.bulnao.government.bg/"
                  label={t("party_reports_gfopp_source")}
                />
              </ul>
            </DataGroup>

            <DataGroup title={t("election_results")}>
              <div className="flex flex-wrap gap-2">
                {electionResults.map((e) => (
                  <ElectionDateLink key={e.date} date={e.date} href={e.href} />
                ))}
              </div>
            </DataGroup>

            <DataGroup title={t("campaign_financing")}>
              <div className="flex flex-wrap gap-2">
                {campaignFinancing.map((e) => (
                  <ElectionDateLink key={e.date} date={e.date} href={e.href} />
                ))}
              </div>
            </DataGroup>
          </div>
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

const DataGroup: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Card>
    <CardContent className="p-5 md:p-6 pt-5 md:pt-6">
      <SubHeading>{title}</SubHeading>
      <div className="mt-4">{children}</div>
    </CardContent>
  </Card>
);

const SourceItem: React.FC<{ href: string; label: string }> = ({
  href,
  label,
}) => (
  <li className="flex items-start">
    <span
      aria-hidden
      className="mr-2 mt-2 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
    />
    <Anchor href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {label}
    </Anchor>
  </li>
);
