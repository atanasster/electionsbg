const SITE_URL = "https://electionsbg.com";

// Stable @id URIs so crawlers reconcile the WebSite + Organization nodes
// across every prerendered page — the schema graph is one node referenced
// many times, not 130k duplicate nodes. (Google's structured-data guidance
// recommends emitting these on every page, not stripping them; the fix is
// the @id, not the absence.)
const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

const ORG = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: "Elections Bulgaria",
  alternateName: "electionsbg.com",
  url: SITE_URL,
  logo: `${SITE_URL}/images/og_image.png`,
};

// Reference shape used wherever another schema entity needs to point at the
// Organization without inlining its full payload again.
const ORG_REF = { "@id": ORG_ID };

export const buildOrganizationLd = () => ({
  "@context": "https://schema.org",
  ...ORG,
});

export const buildWebSiteLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: "Elections Bulgaria",
  alternateName: "electionsbg.com",
  url: SITE_URL,
  inLanguage: ["bg", "en"],
  publisher: ORG_REF,
});

export const buildWebPageLd = (params: {
  title: string;
  description: string;
  url: string;
  inLanguage?: "bg" | "en";
}) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: params.title,
  description: params.description,
  url: params.url,
  inLanguage: params.inLanguage ?? "bg",
  isPartOf: { "@id": WEBSITE_ID },
  publisher: ORG_REF,
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
  license: "https://creativecommons.org/licenses/by/4.0/",
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

export const buildFaqLd = (
  items: Array<{ question: string; answer: string }>,
) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((it) => ({
    "@type": "Question",
    name: it.question,
    acceptedAnswer: { "@type": "Answer", text: it.answer },
  })),
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

export const buildArticleLd = (params: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  inLanguage: "bg" | "en";
  image?: string;
  keywords?: string[];
  articleSection?: string;
  // Override the @type — defaults to Article. Common alternatives:
  // NewsArticle, BlogPosting, Report. Set per-article via frontmatter.
  schemaType?: string;
  // Override the default Organization author with a named human. The string
  // is wrapped in a Person object; the Organization remains as the
  // publisher so the Google guidelines are still satisfied.
  author?: string;
}) => ({
  "@context": "https://schema.org",
  "@type": params.schemaType ?? "Article",
  headline: params.headline,
  description: params.description,
  url: params.url,
  mainEntityOfPage: { "@type": "WebPage", "@id": params.url },
  datePublished: params.datePublished,
  dateModified: params.dateModified ?? params.datePublished,
  inLanguage: params.inLanguage,
  author: params.author ? { "@type": "Person", name: params.author } : ORG,
  publisher: ORG,
  ...(params.image
    ? {
        image: params.image.startsWith("http")
          ? params.image
          : `${SITE_URL}${params.image}`,
      }
    : { image: `${SITE_URL}/images/og_image.png` }),
  ...(params.keywords && params.keywords.length
    ? { keywords: params.keywords.join(", ") }
    : {}),
  ...(params.articleSection ? { articleSection: params.articleSection } : {}),
  isAccessibleForFree: true,
});
