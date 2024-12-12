export type MenuItem = {
  title: string;
  link?: string;
  subMenu?: MenuItem[];
};

export const reportsMenu: MenuItem[] = [
  {
    title: "reports",
    subMenu: [
      { title: "anomaly_reports" },
      { title: "-" },
      {
        title: "municipalities",
        subMenu: [
          {
            title: "concentrated_party_votes",
            link: "/reports/municipality/concentrated",
          },
          {
            title: "top_gainers",
            link: "/reports/municipality/top_gainers",
          },
          {
            title: "top_losers",
            link: "/reports/municipality/top_losers",
          },
          {
            title: "voter_turnout",
            link: "/reports/municipality/turnout",
          },
          {
            title: "invalid_ballots",
            link: "/reports/municipality/invalid_ballots",
          },
          {
            title: "additional_voters",
            link: "/reports/municipality/additional_voters",
          },
          {
            title: "support_no_one",
            link: "/reports/municipality/supports_no_one",
          },
        ],
      },
      {
        title: "settlements",
        subMenu: [
          {
            title: "concentrated_party_votes",
            link: "/reports/settlement/concentrated",
          },
          {
            title: "top_gainers",
            link: "/reports/settlement/top_gainers",
          },
          {
            title: "top_losers",
            link: "/reports/settlement/top_losers",
          },
          {
            title: "voter_turnout",
            link: "/reports/settlement/turnout",
          },
          {
            title: "invalid_ballots",
            link: "/reports/settlement/invalid_ballots",
          },
          {
            title: "additional_voters",
            link: "/reports/settlement/additional_voters",
          },
          {
            title: "support_no_one",
            link: "/reports/settlement/supports_no_one",
          },
        ],
      },
      {
        title: "sections",
        subMenu: [
          {
            title: "concentrated_party_votes",
            link: "/reports/section/concentrated",
          },
          {
            title: "top_gainers",
            link: "/reports/section/top_gainers",
          },
          {
            title: "top_losers",
            link: "/reports/section/top_losers",
          },
          {
            title: "voter_turnout",
            link: "/reports/section/turnout",
          },
          {
            title: "invalid_ballots",
            link: "/reports/section/invalid_ballots",
          },
          {
            title: "additional_voters",
            link: "/reports/section/additional_voters",
          },
          {
            title: "support_no_one",
            link: "/reports/section/supports_no_one",
          },
        ],
      },
    ],
  },
];
