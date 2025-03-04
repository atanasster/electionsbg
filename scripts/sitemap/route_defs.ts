export type RouteDef = { path: string; file?: string; children?: RouteDefs };
export type RouteDefs = RouteDef[];

export const routeDefs = (year: string): RouteDefs => [
  { path: "index", file: `public/${year}/region_votes.json` },
  { path: "sofia", file: `public/${year}/region_votes.json` },
  { path: "about", file: `src/screens/AboutScreen.tsx` },

  {
    path: "municipality/:id",
    file: `public/${year}/municipalities/by/:id`,
  },
  {
    path: "settlement/:id",
    file: `public/${year}/settlements/by/:id`,
  },
  { path: "sections/:id", file: `public/${year}/settlements/:id` },
  { path: "section/:id", file: `public/${year}/sections/:id` },
  { path: "financing", file: `public/${year}/parties/financing.json` },
  {
    path: "party/:id",
    file: `parties`,
  },
  {
    path: "candidate/:id",
    file: `public/${year}/candidates/:id/regions.json`,
  },
  {
    path: "reports",
    children: [
      {
        path: "municipality",
        children: [
          {
            path: "concentrated",
            file: `public/${year}/reports/municipality/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `public/${year}/reports/municipality/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `public/${year}/reports/municipality/top_losers.json`,
          },
          {
            path: "turnout",
            file: `public/${year}/reports/municipality/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `public/${year}/reports/municipality/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `public/${year}/reports/municipality/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `public/${year}/reports/municipality/supports_noone.json`,
          },
        ],
      },
      {
        path: "settlement",
        children: [
          {
            path: "concentrated",
            file: `public/${year}/reports/settlement/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `public/${year}/reports/settlement/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `public/${year}/reports/settlement/top_losers.json`,
          },
          {
            path: "turnout",
            file: `public/${year}/reports/settlement/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `public/${year}/reports/settlement/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `public/${year}/reports/settlement/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `public/${year}/reports/settlement/supports_noone.json`,
          },
        ],
      },
      {
        path: "section",
        children: [
          {
            path: "concentrated",
            file: `public/${year}/reports/section/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `public/${year}/reports/section/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `public/${year}/reports/section/top_losers.json`,
          },
          {
            path: "turnout",
            file: `public/${year}/reports/section/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `public/${year}/reports/section/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `public/${year}/reports/section/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `public/${year}/reports/section/supports_noone.json`,
          },
        ],
      },
    ],
  },
];
