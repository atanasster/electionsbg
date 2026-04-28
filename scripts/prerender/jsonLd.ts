const SITE_URL = "https://electionsbg.com";

const ORG = {
  "@type": "Organization",
  name: "Elections Bulgaria",
  alternateName: "electionsbg.com",
  url: SITE_URL,
  logo: `${SITE_URL}/images/og_image.png`,
};

export const buildOrganizationLd = () => ({
  "@context": "https://schema.org",
  ...ORG,
});

export const buildWebSiteLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Elections Bulgaria",
  alternateName: "electionsbg.com",
  url: SITE_URL,
  inLanguage: ["bg", "en"],
  publisher: ORG,
});

export const buildWebPageLd = (params: {
  title: string;
  description: string;
  url: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: params.title,
  description: params.description,
  url: params.url,
  inLanguage: "bg",
  isPartOf: {
    "@type": "WebSite",
    url: SITE_URL,
    name: "Elections Bulgaria",
  },
  publisher: ORG,
});

export const buildDatasetLd = (params: {
  name: string;
  description: string;
  url: string;
  spatialCoverage?: string;
  keywords?: string[];
}) => ({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: params.name,
  description: params.description,
  url: params.url,
  creator: ORG,
  publisher: ORG,
  isAccessibleForFree: true,
  inLanguage: ["bg", "en"],
  temporalCoverage: "2005-06-25/..",
  ...(params.spatialCoverage
    ? {
        spatialCoverage: {
          "@type": "Place",
          name: params.spatialCoverage,
        },
      }
    : {}),
  ...(params.keywords && params.keywords.length
    ? { keywords: params.keywords.join(", ") }
    : {}),
});

export const buildPersonLd = (params: {
  name: string;
  url: string;
  affiliations?: string[];
}) => ({
  "@context": "https://schema.org",
  "@type": "Person",
  name: params.name,
  url: params.url,
  ...(params.affiliations && params.affiliations.length
    ? {
        affiliation: params.affiliations.map((name) => ({
          "@type": "Organization",
          name,
        })),
      }
    : {}),
});

export const buildBreadcrumbLd = (
  items: Array<{ name: string; url: string }>,
) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: item.name,
    item: item.url,
  })),
});
