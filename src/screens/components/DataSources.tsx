import { Card, CardContent } from "@/ux/Card";
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

const DomainHeading: React.FC<{ id: string; children: React.ReactNode }> = ({
  id,
  children,
}) => (
  <h3
    id={id}
    className="scroll-mt-24 font-display text-xl md:text-2xl font-bold tracking-tight text-foreground border-b border-border pb-2"
  >
    {children}
  </h3>
);

const GroupTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-lg md:text-xl font-semibold tracking-tight text-foreground">
    {children}
  </h4>
);

const DataGroup: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Card>
    <CardContent className="p-5 md:p-6 pt-5 md:pt-6">
      <GroupTitle>{title}</GroupTitle>
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

const localElectionResults: { date: string; href: string }[] = [
  { date: "29.10.2023", href: "https://results.cik.bg/mi2023/tur1/index.html" },
  { date: "27.10.2019", href: "https://results.cik.bg/mi2019/tur1/index.html" },
  {
    date: "25.10.2015",
    href: "https://results.cik.bg/minr2015/tur1/mestni/index.html",
  },
  {
    date: "23.10.2011",
    href: "https://results.cik.bg/mipvr2011/tur1/mestni/index.html",
  },
  {
    date: "28.10.2007",
    href: "https://mi2007.cik.bg/results1/",
  },
  {
    date: "2024–2027",
    href: "https://results.cik.bg/chmi2024-2026/",
  },
];

const campaignFinancing: { date: string; href: string }[] = [
  {
    date: "19.04.2026",
    href: "https://erik.bulnao.government.bg/Reports?electionId=93",
  },
  {
    date: "27.10.2024",
    href: "https://erik.bulnao.government.bg/Reports/Index/83",
  },
  {
    date: "09.06.2024",
    href: "https://erik.bulnao.government.bg/Reports/Index/80",
  },
];

const gridClass = "mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3 items-start";

export const DataSources = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-12">
      {/* Elections & financing */}
      <div>
        <DomainHeading id="sources-elections">
          {t("data_domain_elections")}
        </DomainHeading>
        <div className={gridClass}>
          <DataGroup title={t("election_results")}>
            <div className="flex flex-wrap gap-2">
              {electionResults.map((e) => (
                <ElectionDateLink key={e.date} date={e.date} href={e.href} />
              ))}
            </div>
          </DataGroup>

          <DataGroup title={t("local_election_results")}>
            <p className="text-sm text-muted-foreground mb-3">
              {t("local_election_section_intro")}
            </p>
            <div className="flex flex-wrap gap-2">
              {localElectionResults.map((e) => (
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

          <DataGroup title={t("polls_data_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://bg.wikipedia.org/"
                label={t("polls_wikipedia_source")}
              />
            </ul>
          </DataGroup>
        </div>
      </div>

      {/* Parliament & officials */}
      <div>
        <DomainHeading id="sources-officials">
          {t("data_domain_officials")}
        </DomainHeading>
        <div className={gridClass}>
          <DataGroup title={t("mp_profiles")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://www.parliament.bg/"
                label={t("mp_profiles_source")}
              />
              <SourceItem
                href="https://www.parliament.bg/bg/plenaryst"
                label={t("rollcall_votes_source")}
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
              <SourceItem
                href="https://data.egov.bg/data/view/acb135ab-00a2-4aa7-b5e5-49c992385ef5"
                label={t("bgpost_postcodes_source")}
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
              <SourceItem
                href="https://sanctionssearch.ofac.treas.gov/"
                label={t("integrity_sanctions_source")}
              />
              <SourceItem
                href="https://comdos.bg/"
                label={t("integrity_ds_source")}
              />
            </ul>
          </DataGroup>
        </div>
      </div>

      {/* Local government */}
      <div>
        <DomainHeading id="sources-local">
          {t("data_domain_local")}
        </DomainHeading>
        <div className={gridClass}>
          <DataGroup title={t("local_government_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://register.cacbg.bg/"
                label={t("local_government_roster_source")}
              />
              <SourceItem
                href="https://savet.veliko-tarnovo.bg/bg/protokoli"
                label={t("council_minutes_source")}
              />
            </ul>
          </DataGroup>

          <DataGroup title={t("local_taxes_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://www.265obshtini.bg/"
                label={t("local_taxes_ipi_source")}
              />
              <SourceItem
                href="https://www.regionalprofiles.bg/bg/mestni-danyci-i-taksi/"
                label={t("local_taxes_regional_profiles_source")}
              />
              <SourceItem
                href="https://sofia.obshtini.bg/"
                label={t("local_taxes_naredba_source")}
              />
            </ul>
          </DataGroup>

          {/* My-Area dashboard sources. Each is silent-cutover: the
              corresponding tile auto-hides when the underlying data
              file is empty, so a partial deploy renders cleanly. */}
          <DataGroup title={t("my_area_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://iisda.government.bg/ras/governing_bodies/gb_municipality_administrations"
                label={t("my_area_iisda_mayors_source")}
              />
              <SourceItem
                href="https://iisda.government.bg/adm_services/services"
                label={t("admin_services_source")}
              />
              <SourceItem
                href="https://lisi.transparency.bg/"
                label={t("my_area_lisi_source")}
              />
              <SourceItem
                href="https://data.egov.bg/data/view/e3cccc25-6127-4b46-bc12-71ce068b35fe"
                label={t("my_area_iaos_air_source")}
              />
            </ul>
          </DataGroup>
        </div>
      </div>

      {/* Geography & demographics */}
      <div>
        <DomainHeading id="sources-geography">
          {t("data_domain_geography")}
        </DomainHeading>
        <div className={gridClass}>
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

          <DataGroup title={t("census_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://census2021.bg/"
                label={t("census_2021_source")}
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
                href="https://www.nsi.bg/bg/content/2536"
                label={t("indicators_nsi_landuse_source")}
              />
              <SourceItem
                href="https://data.egov.bg/organisation/13b6e23a-1888-4ad6-8f86-fceb71ca123c"
                label={t("indicators_nsi_opendata_source")}
              />
              <SourceItem
                href="https://www.grao.bg/tables.html"
                label={t("indicators_grao_source")}
              />
            </ul>
          </DataGroup>
        </div>
      </div>

      {/* Economy & EU */}
      <div>
        <DomainHeading id="sources-economy">
          {t("data_domain_economy")}
        </DomainHeading>
        <div className={gridClass}>
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
                href="https://ec.europa.eu/eurostat/databrowser/view/isoc_ciegi_ac/default/table"
                label={t("admin_egov_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/isoc_sk_dskl_i21/default/table"
                label={t("admin_digital_skills_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/web/income-and-living-conditions/database"
                label={t("eurostat_silc_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/demo_mlexpec/default/table"
                label={t("eurostat_life_expectancy_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/tour_occ_nim/default/table"
                label={t("eurostat_tourism_source")}
              />
              <SourceItem
                href="https://www.bnb.bg/Statistics/StExternalSector/StDirectInvestments/StDIBulgaria/index.htm"
                label={t("bnb_fdi_source")}
              />
            </ul>
          </DataGroup>

          <DataGroup title={t("social_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://asp.government.bg/bg/za-agentsiyata/misiya-i-tseli/otcheti-i-dokladi/"
                label={t("social_asp_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/ilc_li10/default/table"
                label={t("social_poverty_source")}
              />
            </ul>
          </DataGroup>

          <DataGroup title={t("prices_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://kolkostruva.bg/opendata"
                label={t("prices_kzp_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/product/view/prc_ppp_ind_1"
                label={t("prices_eurostat_pli_source")}
              />
              <SourceItem
                href="https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en"
                label={t("prices_oil_bulletin_source")}
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
              <SourceItem
                href="https://storage.eop.bg/"
                label={t("procurement_eop_source")}
              />
              <SourceItem
                href="https://reg.cpc.bg/AllComplaints.aspx?dt=2"
                label={
                  t("procurement_kzk_source") ||
                  "КЗК — public register of public-procurement appeals (reg.cpc.bg)"
                }
              />
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("about_procurement_by_settlement_note") ||
                'Procurement by settlement (/procurement/by-settlement) pins each contract to the buyer\'s headquarters. The classifier excludes central ministries, state agencies and nationally-operating state companies (Sofia HQ, national footprint) — they roll up into a separate "national procurement" card. The buyer-HQ → EKATTE resolver is postal-primary against the canonical NSI settlement catalog (5,267 entries with postal codes); 99.9% of buyers in the 2026 sample resolve to a single settlement. The tier classifier uses name heuristics plus a curated EIK override table for the long tail.'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("about_procurement_risk_note") ||
                "Each contract carries an explainable Corruption Risk Index — the share of the applicable red-flag checks that fired (debarred supplier, MP- or official-connected contractor, single bidder gated against the per-CPV competition baseline, non-open procedure, short tender window, post-award amendment, single-supplier concentration). The same signals drive the money-flow diagram on the dashboard (and per-entity), the connected MPs & officials rankings (/procurement/mps), the red-flag feed (/procurement/flags) and a per-oblast choropleth (total / per-capita / average contract). All derived from the same АОП / ЦАИС ЕОП open data — no new source."}
            </p>
          </DataGroup>

          <DataGroup title={t("eu_funds_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
                label={t("eu_funds_isun_source")}
              />
              <SourceItem
                href="https://2020.eufunds.bg/bg/0/0/Project"
                label={t("eu_funds_isun_projects_source")}
              />
              <SourceItem
                href="https://register.cacbg.bg/"
                label={t("eu_funds_political_join_source")}
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

          <DataGroup title={t("budget_section")}>
            <ul className="space-y-2">
              <SourceItem
                href="https://data.egov.bg/"
                label={t("budget_kfp_source")}
              />
              <SourceItem
                href="https://taxsummaries.pwc.com/quick-charts/value-added-tax-vat-rates"
                label={t("budget_pwc_rates_source")}
              />
              <SourceItem
                href="https://www.nato.int/cps/en/natohq/topics_49198.htm"
                label={t("budget_nato_defence_source")}
              />
              <SourceItem
                href="https://economy-finance.ec.europa.eu/economic-surveillance-eu-member-states/country-pages/bulgaria_en"
                label={t("budget_ec_forecast_source")}
              />
              <SourceItem
                href="https://www.nsi.bg/bg/content/2432/"
                label={t("budget_nsi_edp_source")}
              />
              <SourceItem
                href="https://taxation-customs.ec.europa.eu/taxation/vat/fight-against-vat-fraud/vat-gap_en"
                label={t("budget_ec_vat_gap_source")}
              />
              <SourceItem
                href="https://www.imf.org/external/datamapper/profile/BGR"
                label={t("budget_imf_weo_source")}
              />
              <SourceItem
                href="https://www.fiscal-council.bg/bg/publikacii"
                label={t("budget_fiscal_council_source")}
              />
              <SourceItem
                href="https://dv.parliament.bg/"
                label={t("budget_law_dv_source")}
              />
              <SourceItem
                href="https://dv.parliament.bg/"
                label={t("budget_interim_law_source")}
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
                href="https://ec.europa.eu/eurostat/databrowser/view/nama_10_co3_p3/default/table"
                label={t("budget_consumption_coicop_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/gov_10a_taxag/default/table"
                label={t("budget_taxag_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/earn_ses_hourly/default/table"
                label={t("budget_ses_source")}
              />
              <SourceItem
                href="https://nssi.bg/publikacii/analizi/sreden-osiguritelen-dohod/"
                label={t("budget_noi_sod_source")}
              />
              <SourceItem
                href="https://ec.europa.eu/eurostat/databrowser/view/educ_uoe_perp01/default/table"
                label={t("budget_teachers_source")}
              />
              <SourceItem
                href="https://nssi.bg/publikacii/statistika/pensii-statistika/"
                label={t("budget_noi_statb_source")}
              />
              <SourceItem
                href="https://nssi.bg/publikacii/statistika/pensii-statistika/"
                label={t("budget_noi_yearbook_source")}
              />
              <SourceItem
                href="https://www.fsc.bg/en/social-insurance-activity/statistics/"
                label={t("budget_kfn_source")}
              />
              <SourceItem
                href="https://www.nsi.bg/en/content/3953/employed-persons-and-average-annual-wages-and-salaries-economic-activities"
                label={t("budget_nsi_wages_source")}
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
                href="https://data.egov.bg/"
                label={t("budget_municipal_execution_source")}
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
              <SourceItem
                href="https://www.shumen.bg/bg/byudzhet/2025"
                label={t("budget_capital_shumen_source")}
              />
              <SourceItem
                href="https://vidin.bg/"
                label={t("budget_capital_vidin_source")}
              />
              <SourceItem
                href="https://www.veliko-tarnovo.bg/bg/byudzhet-i-finansi/byudzhet-2025/"
                label={t("budget_capital_veliko_tarnovo_source")}
              />
              <SourceItem
                href="https://www.pernik.bg/bg/byudzhet"
                label={t("budget_capital_pernik_source")}
              />
              <SourceItem
                href="https://www.haskovo.bg/bg/kapitalovi-razhodi"
                label={t("budget_capital_haskovo_source")}
              />
              <SourceItem
                href="https://gabrovo.bg/files/budjet2025/izmenenia/20.5.pdf"
                label={t("budget_capital_gabrovo_source")}
              />
              <SourceItem
                href="https://yambol.bg/byudzhet"
                label={t("budget_capital_yambol_source")}
              />
              <SourceItem
                href="https://kardjali.bg/"
                label={t("budget_capital_kardzhali_source")}
              />
              <SourceItem
                href="https://www.lovech.bg/bg/byudzhet"
                label={t("budget_capital_lovech_source")}
              />
              <SourceItem
                href="https://www.dupnitsa.bg/section-316-content.html"
                label={t("budget_capital_dupnitsa_source")}
              />
              <SourceItem
                href="https://m.velingrad.bg/wp-content/uploads/2025/04/ПРОЕКТ-ПКР-2025.pdf"
                label={t("budget_capital_velingrad_source")}
              />
              <SourceItem
                href="https://www.samokov.bg/documents/d/samokov/prilozenie-5"
                label={t("budget_capital_samokov_source")}
              />
              <SourceItem
                href="https://karlovo.bg/inc/service/service-download-file.php?identifier=6d56fbd5-f78b-4a49-a311-a0fff162c643"
                label={t("budget_capital_karlovo_source")}
              />
              <SourceItem
                href="https://www.kazanlak.bg/common/images/src/81/file/Приложения.pdf"
                label={t("budget_capital_kazanlak_source")}
              />
              <SourceItem
                href="https://obs.kyustendil.bg/Documents/DnevenRed/30/ДЗ 61-00-3216.pdf"
                label={t("budget_capital_kyustendil_source")}
              />
              <SourceItem
                href="https://www.montana.bg/свали/бюджет/32"
                label={t("budget_capital_montana_source")}
              />
              <SourceItem
                href="https://ipop.mrrb.bg/reports_projects_export.php"
                label={t("budget_ipop_source")}
              />
            </ul>
          </DataGroup>
        </div>
      </div>
    </div>
  );
};
