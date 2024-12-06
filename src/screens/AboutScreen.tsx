import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Title } from "@/ux/Title";
import { Anchor } from "@/ux/Anchor";
import { useTranslation } from "react-i18next";

export const AboutScreen = () => {
  const { t } = useTranslation();
  return (
    <div className="w-full px-2 sm:px-20 md:px-32 lg:px-40 ">
      <Title description="About page">{t("about")}</Title>
      <p className="py-2 text-lg">
        In the last 4 years, Bulgaria has been the scene of a world-record
        setting 7 elections, with no visible outcome to create a working
        government.
      </p>
      <p className="py-2 text-lg">
        Voter fatigue and disillusionment with politicians have created an
        environment where radical political voices, aided by Moscow's widespread
        disinformation, are successfully undermining public support for the
        democratic process and boosting the popularity of pro-Russian and
        far-right groups.
      </p>
      <p className="py-2 text-lg">
        The never-ending election spiral has a serious impact on Bulgaria's
        economy and its foreign policy. The country risks losing billions of
        euros in EU recovery funds because of the lack of reforms. Full
        integration into the open-border Schengen area and joining the eurozone
        are likely to be delayed further.
      </p>
      <p className="py-2 text-lg">
        In this process, Bulgaria has become a fertile soil for all sorts of
        conspiracy theories and widespread distrust in the electoral system.
        This platform aims to give visibility to the actual data behind the
        elections and easy an way to analyze their results.
      </p>
      <Title>The team</Title>
      <p className="py-2 text-lg">
        The project was started by a father/son team and is released as
        open-source to encourage new members to join and contribute. The focus
        is on versatility and ease-of-use, so everyone can see the results of
        all elections in the last 10 years.
      </p>
      <div className="flex flex-col lg:flex-row justify-between">
        <Card className="my-8 mr-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md md:text-2xl font-bold md:font-extrabold text-muted-foreground">
              Martin Stoyanov
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-4">
            <div className="flex">
              <figure className="max-w-lg pr-8">
                <img
                  className="h-auto max-w-48 rounded-lg"
                  src="/images/IMG_2272.png"
                  alt="image description"
                />
              </figure>
              <div className="pl-4">
                <p className="max-w-64">
                  Graduated from Cornell and worked at Bandwidth and SentinelOne
                </p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  Experience
                </h4>
                <p className="max-w-64">
                  Frontend, design, testing and user experience
                </p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  Hobbies
                </h4>
                <p className="max-w-64">Travel, sports, girlfriends.</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="my-8 ml-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md md:text-2xl font-bold md:font-extrabold text-muted-foreground">
              Atanas Stoyanov
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-4">
            <div className="flex">
              <figure className="max-w-lg">
                <img
                  className="h-auto max-w-48 rounded-lg"
                  src="/images/IMG_7486.png"
                  alt="image description"
                />
              </figure>
              <div className="pl-4">
                <p className="max-w-72">
                  30+ years of experience, founder of{" "}
                  <Anchor
                    className="mx-1"
                    target="_blank"
                    href="https://smartbear.com"
                  >
                    AutomatedQA.
                  </Anchor>
                </p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  Experience
                </h4>
                <p className="max-w-64">
                  Designed and implemented software platforms in the accounting
                  and financial, software quality assurance industries.
                </p>
                <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mt-4">
                  Hobbies
                </h4>
                <p className="max-w-64">Travel, food and good time.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Title>The data</Title>
      <p className="py-2 text-lg">
        Under the hood, this platform uses a variety of data and geoJSON maps
        from multiple open or government sources.
      </p>
      <div className="my-8">
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          GeoJSON maps
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            Regions, Municipalities and Settlements
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/yurukov/Bulgaria-geocoding/tree/master"
            >
              https://github.com/yurukov/Bulgaria-geocoding/tree/master.
            </Anchor>
            The original files provide the administrative regions of Bulgaria,
            and have been modified to account for the 3 electoral regions in
            Sofia city, and the Plovdiv city region.
          </li>
          <li>
            Sofia city districts
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://sofiaplan.bg/api/"
            >
              https://sofiaplan.bg/api/.
            </Anchor>
            The original files have been optimized and incorporated into the
            administrative regions maps.
          </li>
          <li>
            World countries{" "}
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/johan/world.geo.json"
            >
              https://github.com/johan/world.geo.json.
            </Anchor>
            The original maps have been grouped into continents.
          </li>
          <li>
            Continents{" "}
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://github.com/rapomon/geojson-places/tree/master"
            >
              https://github.com/rapomon/geojson-places/tree/master.
            </Anchor>
            The original maps have been grouped into a world map and
            simplified/optimized with{" "}
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://mapshaper.org"
            >
              Mapshaper
            </Anchor>
            and
            <Anchor className="mx-1" target="_blank" href="https://geojson.io)">
              geojson.io .
            </Anchor>
          </li>
        </ul>
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          Settlements
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            Settlements names from EKATTE catalog{" "}
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://www.nsi.bg/nrnm/ekatte/regions"
            >
              https://www.nsi.bg/nrnm/ekatte/regions.
            </Anchor>
            The settlement names in English and Bulgarian.
          </li>
        </ul>
        <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
          Election Results
        </h4>
        <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
          <li>
            27.10.2024
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pe202410/opendata/index.html"
            >
              https://results.cik.bg/pe202410/opendata/index.html.
            </Anchor>
          </li>
          <li>
            09.06.2024
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/europe2024/opendata/index.html"
            >
              https://results.cik.bg/europe2024/opendata/index.html
            </Anchor>
          </li>
          <li>
            02.04.2023
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/ns2023/csv.html"
            >
              https://results.cik.bg/ns2023/csv.html
            </Anchor>
          </li>
          <li>
            02.10.2022
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/ns2022/csv.html"
            >
              https://results.cik.bg/ns2022/csv.html
            </Anchor>
          </li>
          <li>
            14.11.2021
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pvrns2021/tur1/csv.html"
            >
              https://results.cik.bg/pvrns2021/tur1/csv.html
            </Anchor>
          </li>
          <li>
            11.07.2021
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2021_07/csv.html"
            >
              https://results.cik.bg/pi2021_07/csv.html
            </Anchor>
          </li>
          <li>
            04.04.2021
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2021/csv.html"
            >
              https://results.cik.bg/pi2021/csv.html
            </Anchor>
          </li>
          <li>
            26.03.2017
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2017/csv.html"
            >
              https://results.cik.bg/pi2017/csv.html
            </Anchor>
          </li>
          <li>
            05.10.2014
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2014/csv.html"
            >
              https://results.cik.bg/pi2014/csv.html
            </Anchor>
          </li>
          <li>
            12.05.2013
            <Anchor
              className="mx-1"
              target="_blank"
              href="https://results.cik.bg/pi2013/csv.html"
            >
              https://results.cik.bg/pi2013/csv.html
            </Anchor>
          </li>
        </ul>
      </div>
    </div>
  );
};
