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
  distribution?: Array<{ url: string; format?: string; name?: string }>;
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
  ...(params.distribution && params.distribution.length
    ? {
        distribution: params.distribution.map((d) => ({
          "@type": "DataDownload",
          contentUrl: d.url,
          encodingFormat: d.format ?? "application/json",
          ...(d.name ? { name: d.name } : {}),
        })),
      }
    : {}),
});

export const buildPersonLd = (params: {
  name: string;
  url: string;
  affiliations?: string[];
  givenName?: string;
  familyName?: string;
  additionalName?: string;
  birthDate?: string;
  birthPlace?: { city?: string; country?: string };
  jobTitle?: string;
  knowsAbout?: string;
  knowsLanguage?: string[];
  image?: string;
  memberOf?: { name: string; url?: string };
  sameAs?: string[];
}) => ({
  "@context": "https://schema.org",
  "@type": "Person",
  name: params.name,
  url: params.url,
  ...(params.givenName ? { givenName: params.givenName } : {}),
  ...(params.familyName ? { familyName: params.familyName } : {}),
  ...(params.additionalName ? { additionalName: params.additionalName } : {}),
  ...(params.birthDate ? { birthDate: params.birthDate } : {}),
  ...(params.birthPlace && (params.birthPlace.city || params.birthPlace.country)
    ? {
        birthPlace: {
          "@type": "Place",
          ...(params.birthPlace.city ? { name: params.birthPlace.city } : {}),
          ...(params.birthPlace.country
            ? {
                address: {
                  "@type": "PostalAddress",
                  addressCountry: params.birthPlace.country,
                },
              }
            : {}),
        },
      }
    : {}),
  ...(params.jobTitle ? { jobTitle: params.jobTitle } : {}),
  ...(params.knowsAbout ? { knowsAbout: params.knowsAbout } : {}),
  ...(params.knowsLanguage && params.knowsLanguage.length
    ? { knowsLanguage: params.knowsLanguage }
    : {}),
  ...(params.image ? { image: params.image } : {}),
  ...(params.memberOf
    ? {
        memberOf: {
          "@type": "GovernmentOrganization",
          name: params.memberOf.name,
          ...(params.memberOf.url ? { url: params.memberOf.url } : {}),
        },
      }
    : {}),
  ...(params.sameAs && params.sameAs.length ? { sameAs: params.sameAs } : {}),
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
