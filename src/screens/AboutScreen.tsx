import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Title } from "@/ux/Title";
import { Anchor } from "@/ux/Anchor";
import { useTranslation } from "react-i18next";

export const AboutScreen = () => {
  const { t } = useTranslation();
  return (
    <div className="text-secondary-foreground w-full px-2 sm:px-20 md:px-32 lg:px-40 ">
      <Title description="About page">{t("about")}</Title>
      <p className="py-2 text-lg">{t("about_p_1")}</p>
      <blockquote className="py-2 border-l-2 pl-6 text-lg italic font-semibold">
        {t("about_p_2")}
      </blockquote>
      <blockquote className="py-2 border-l-2 pl-6 text-lg italic font-semibold">
        {t("about_p_3")}
      </blockquote>
      <p className="py-2 text-lg">{t("about_p_4")}</p>
      <Title>{t("whos_behind_the_project")}</Title>
      <p className="py-2 text-lg">{t("project_about")}</p>
      <div className="flex flex-col lg:flex-row justify-between">
        <Card className="my-8 mr-2">
          <CardHeader className="flex flex-col items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md md:text-2xl font-bold md:font-extrabold text-muted-foreground">
              {t("martin_stoyanov")}
            </CardTitle>
            <CardTitle className="text-md md:text-xl font-bold md:font-extrabold text-muted-foreground">
              {t("martin_location")}
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-4">
            <div className="flex flex-col sm:flex-row">
              <figure className="flex flex-col max-w-lg sm:pr-4 md:pr-8 items-center">
                <img
                  className="h-auto max-w-48 rounded-lg"
                  src="/images/IMG_2272.png"
                  alt="image description"
                />
              </figure>
              <div className="my-4 md:my-0 md:pl-4">
                <p className="max-w-64">{t("martin_about")}</p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  {t("experience")}
                </h4>
                <p className="max-w-64">{t("martin_experience")}</p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  {t("hobbies")}
                </h4>
                <p className="max-w-64">{t("martin_hobbies")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="my-8 ml-2">
          <CardHeader className="flex flex-col items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md md:text-2xl font-bold md:font-extrabold text-muted-foreground">
              {t("atanas_stoyanov")}
            </CardTitle>
            <CardTitle className="text-md md:text-xl font-bold md:font-extrabold text-muted-foreground">
              {t("atanas_location")}
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-4">
            <div className="flex flex-col sm:flex-row">
              <figure className="flex flex-col max-w-lg sm:pr-4 md:pr-8 items-center">
                <img
                  className="h-auto max-w-48 rounded-lg"
                  src="/images/IMG_4016.png"
                  alt="image description"
                />
              </figure>
              <div className="my-4 md:my-0 md:pl-4">
                <p className="max-w-72">
                  {t("atanas_about")}{" "}
                  <Anchor
                    className="mx-1"
                    target="_blank"
                    href="https://smartbear.com"
                  >
                    AutomatedQA.
                  </Anchor>
                </p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  {t("experience")}
                </h4>
                <p className="max-w-64">{t("atanas_experience")}</p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  {t("hobbies")}
                </h4>
                <p className="max-w-64">{t("atanas_hobbies")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Title>{t("the_data")}</Title>
      <p className="py-2 text-lg">{t("about_data")}</p>
      <div className="my-8">
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          {t("geojson_maps")}
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/yurukov/Bulgaria-geocoding/tree/master"
            >
              {t("regions_muni_settlements")}
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://sofiaplan.bg/api/"
            >
              {t("sofia_districts")}
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/johan/world.geo.json"
            >
              {t("world_countries")}
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/rapomon/geojson-places/tree/master"
            >
              {t("continents")}
            </Anchor>
          </li>
        </ul>
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          {t("settlements")}
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://www.nsi.bg/nrnm/ekatte/regions"
            >
              {t("settlements_from_EKATTE")}
            </Anchor>
          </li>
        </ul>
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          {t("settlement_locations")}
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/yurukov/Bulgaria-geocoding/blob/master/settlements_loc.csv"
            >
              {t("settlement_locations_bulgaria")}
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://gist.github.com/ofou/df09a6834a8421b4f376c875194915c9"
            >
              {t("country_capitals_locations")}
            </Anchor>
          </li>
        </ul>
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          {t("election_results")}
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pe202410/opendata/index.html"
            >
              27.10.2024
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/europe2024/opendata/index.html"
            >
              09.06.2024
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/ns2023/csv.html"
            >
              02.04.2023
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/ns2022/csv.html"
            >
              02.10.2022
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pvrns2021/tur1/csv.html"
            >
              14.11.2021
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2021_07/csv.html"
            >
              11.07.2021
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2021/csv.html"
            >
              04.04.2021
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2017/csv.html"
            >
              26.03.2017
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2014/csv.html"
            >
              05.10.2014
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2013/csv.html"
            >
              12.05.2013
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://pi2005.cik.bg/results/"
            >
              25.06.2005
            </Anchor>
          </li>

          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://pi2009.cik.bg/results/proportional/index.html"
            >
              05.07.2009
            </Anchor>
          </li>
        </ul>
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          {t("campaign_financing")}
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://erik.bulnao.government.bg/Reports/Index/83"
            >
              27.10.2024
            </Anchor>
          </li>
          <li>
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://erik.bulnao.government.bg/Reports/Index/80"
            >
              09.06.2024
            </Anchor>
          </li>
          https://pi2005.cik.bg/results/
        </ul>
      </div>
    </div>
  );
};
