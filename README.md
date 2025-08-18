# Bulgaria Election Results Analysis

A platform to visualize and analyze the elections in Bulgaria since 2005.

## Live Website
[Live Web App](https://electionsbg.com)

## Architecture

This project is built upon a high-performance, modern web architecture that cleanly separates data processing from the frontend application. This ensures maximum scalability, performance, and maintainability.

### 1. Frontend Application (`src/`)

The user interface is a sophisticated Single-Page Application (SPA) built with **React** and **TypeScript**. It leverages **Vite** for an accelerated development experience and an optimized build process.

-   **Component-Based UI**: The `src/components`, `src/screens`, and `src/layout` directories enforce a modular and reusable component strategy.
-   **High-Performance Styling**: Styling is handled by **Tailwind CSS**, a utility-first framework that enables rapid development of custom designs without sacrificing performance.
-   **Routing**: The application's navigation and view management are controlled by a centralized routing system in `src/routes.tsx`.

### 2. Data Processing Pipeline (`scripts/`)

All election data is processed through a robust, offline pipeline built with **TypeScript**. This pipeline is the engine that transforms raw data into a structured, web-ready format.

-   **Automated Workflow**: The pipeline reads raw data from `raw_data/`, then parses, cleans, analyzes, and structures it into the JSON files consumed by the frontend.
-   **Modular Scripts**: The `parsers/`, `stats/`, and `reports/` directories contain specialized scripts for each stage of the data transformation process, orchestrated by `scripts/main.ts`.

### 3. Static Data API (`public/`)

The application does not rely on a traditional, dynamic backend server. Instead, it consumes data from a set of static JSON files located in the `public/` directory.

-   **Pre-built Data**: All data is pre-processed and organized by election date. The frontend fetches this data directly.
-   **JAMstack Principles**: This approach follows JAMstack (JavaScript, APIs, Markup) principles, eliminating the need for a database and resulting in superior performance, higher security, and simplified deployment.

### 4. Deployment (`firebase.json`)

The entire application is deployed to **Firebase Hosting**. This platform provides a global Content Delivery Network (CDN), ensuring fast, reliable access for all users by serving the static assets from edge locations around the world.

## Data

### GeoJSON

- [Regions, Municipalities and Settlements](https://github.com/yurukov/Bulgaria-geocoding/tree/master). The original files provide the administrative regions of Bulgaria, and have been modified to account for the 3 electoral regions in Sofia city, and the Plovdiv city region.

- [Sofia city districts](https://sofiaplan.bg/api/). The original files have been optimized and incorporated into the administrative regions maps.

- [World countries](https://github.com/johan/world.geo.json). The original maps have been grouped into continents.
- [Continents](https://github.com/rapomon/geojson-places/tree/master). The original maps have been grouped into a world map and simplified/optimized with [Mapshaper](https://mapshaper.org) and [geojson.io](https://geojson.io).


### Settlements names
- [EKATTE catalog](https://www.nsi.bg/nrnm/ekatte/regions). The settlement names in English and Bulgarian.

### Settlements locations
- [Settlement locations](https://github.com/yurukov/Bulgaria-geocoding/blob/master/settlements_loc.csv). The settlements geo locations in Bulgaria.
- [Country capitals locations](https://gist.github.com/ofou/df09a6834a8421b4f376c875194915c9). The capitals of the world geo locations.

### Election Results
- [27.10.2024](https://results.cik.bg/pe202410/opendata/index.html)<br />
- [09.06.2024](https://results.cik.bg/europe2024/opendata/index.html)<br />
- [02.04.2023](https://results.cik.bg/ns2023/csv.html)<br />
- [02.10.2022](https://results.cik.bg/ns2022/csv.html)<br />
- [14.11.2021](https://results.cik.bg/pvrns2021/tur1/csv.html)<br />
- [11.07.2021](https://results.cik.bg/pi2021_07/csv.html)<br />
- [04.04.2021](https://results.cik.bg/pi2021/csv.html)<br />
- [26.03.2017](https://results.cik.bg/pi2017/csv.html)<br />
- [05.10.2014](https://results.cik.bg/pi2014/csv.html)<br />
- [12.05.2013](https://results.cik.bg/pi2013/csv.html)<br />
- [05.07.2009](https://pi2009.cik.bg/results/proportional/index.html)<br />
- [25.06.2005](https://pi2005.cik.bg/results/)<br />

### Campaign Financing
- [27.10.2024](https://erik.bulnao.government.bg/Reports/Index/83)<br />
- [09.06.2024](https://erik.bulnao.government.bg/Reports/Index/80)<br />
