export type PresidentialCoverage = {
  reviewedAt: string;
  agencies: {
    agencyId: string;
    lastChecked: string | null;
    unavailable: boolean;
    accepted: number;
    from: string | null;
    to: string | null;
    reviewedPublications: number;
    missingMetadata: number;
    excluded: number;
    otherQuestions: number;
    cycles: { year: number; accepted: number }[];
  }[];
};
